import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { LocaleSwitcher } from '../components/LocaleSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { API_ORIGIN, ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useI18n } from '../lib/i18n/i18n-context';
import type { MessageKey } from '../lib/i18n/messages.gen';
import {
  openOAuthPopup,
  prefersPopup,
  type OAuthPopupHandle,
} from '../lib/oauth-popup';
import {
  AUTH_ERROR_CODES,
  CLIENT_ERROR_CODES,
  type AuthProvider,
  type SocialProvider,
} from '../lib/contracts.gen';

type Pending = AuthProvider | null;

// 오류 코드 → 메시지 키 단일 매핑 — redirect 오류(?error=…)와 API 오류가 공유한다.
// 키는 계약 상수에서만 가져오고, 없는 코드는 일반 메시지로 폴백.
// 문구 자체는 번역 마스터(i18n/client.csv)에만 있다.
const GENERIC_ERROR_KEY: MessageKey = 'error.generic';

const ERROR_KEYS: Record<string, MessageKey> = {
  [AUTH_ERROR_CODES.SIGNIN_FAILED]: 'error.signin_failed',
  [AUTH_ERROR_CODES.DEMO_DISABLED]: 'error.demo_disabled',
  [CLIENT_ERROR_CODES.NETWORK_ERROR]: 'error.network_error',
};

function keyFor(code: string | null): MessageKey | null {
  if (!code) return null;
  return ERROR_KEYS[code] ?? GENERIC_ERROR_KEY;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn, refresh } = useAuth();
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [pending, setPending] = useState<Pending>(null);
  // 진행 중인 팝업 핸들 — 언마운트 시 정리해야 리스너·타이머가 남지 않는다.
  const popupRef = useRef<OAuthPopupHandle | null>(null);
  // 오류는 문구가 아니라 키로 들고 있다가 그릴 때 번역한다 — 언어를 바꾸면 화면에 떠
  // 있는 오류도 함께 바뀐다(문구를 담아두면 그 오류만 이전 언어로 남는다).
  // 소셜 redirect 흐름이 실패 시 ?error=…로 돌아온다 (plan/auth.md 에러 경로).
  const [errorKey, setErrorKey] = useState<MessageKey | null>(() =>
    keyFor(searchParams.get('error')),
  );
  const busy = pending !== null;

  // 소셜 로그인은 전체 페이지 이동이라, 뒤로 가기로 돌아오면 브라우저가 bfcache에서
  // 이 페이지를 "그대로" 복원한다 — 컴포넌트가 다시 마운트되지 않으므로 pending이
  // 남아 모든 버튼이 Connecting… 상태로 굳고 재시도가 불가능해진다.
  // pageshow(persisted=true)가 bfcache 복원의 유일한 신호라 여기서 대기 상태를 푼다.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setPending(null);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // 화면을 떠날 때 진행 중인 팝업을 정리한다(리스너·타이머 누수 방지).
  useEffect(() => () => popupRef.current?.cancel(), []);

  // 전체 페이지 이동 — 서버가 OAuth 제공자로 redirect한다.
  function startRedirect(provider: SocialProvider) {
    window.location.assign(api.socialLoginUrl(provider, 'redirect'));
  }

  async function handleSocial(provider: SocialProvider) {
    setErrorKey(null);
    setPending(provider);

    // 데스크톱은 팝업 — 로그인 화면이 살아있으니 뒤로 가기 복원 문제 자체가 없고,
    // 취소해도 페이지 상태가 그대로다. 모바일·팝업 차단 시에는 redirect로 폴백한다.
    if (!prefersPopup()) return startRedirect(provider);

    const popup = openOAuthPopup(
      api.socialLoginUrl(provider, 'popup'),
      API_ORIGIN,
    );
    if (!popup) return startRedirect(provider);

    popupRef.current = popup;
    const result = await popup.result;
    popupRef.current = null;

    // 명시적 오류가 아니면 세션이 실제로 생겼는지 서버에 확인한다.
    // 창이 닫힌 것만 보고 취소로 단정하면 안 된다 — 서버 콜백은 postMessage 직후
    // 창을 닫으므로, 메시지 배달보다 닫힘이 먼저 관측되면 로그인에 성공하고도
    // 로그인 화면에 남는다. 쿠키는 이미 심겼으니 서버에 물어보면 확실하다.
    if (!result.error) {
      if (await refresh()) return navigate('/dashboard');
      // 성공 메시지를 받았는데 세션이 없다면 진짜 실패다.
      if (result.ok) setErrorKey(keyFor(AUTH_ERROR_CODES.SIGNIN_FAILED));
    } else {
      setErrorKey(keyFor(result.error));
    }
    // 취소(오류 코드 없음 + 세션 없음)는 조용히 원상 복귀한다.
    setPending(null);
  }

  async function handleDemo() {
    setErrorKey(null);
    setPending('demo');
    try {
      // 세션 쿠키는 서버가 응답에 심는다 — 웹은 사용자 정보만 채택한다.
      const { user } = await api.demoLogin();
      signIn(user);
      navigate('/dashboard');
    } catch (e) {
      setErrorKey(e instanceof ApiError ? keyFor(e.code) : GENERIC_ERROR_KEY);
      setPending(null);
    }
  }

  return (
    <main className="auth">
      {/* 워드마크는 번역하지 않는다 — 로고 텍스트는 언어와 무관한 고유명사다. */}
      <div className="auth__brand">Prism</div>

      <section className="card">
        <header className="card__head">
          <h1>{t('auth.welcome_back')}</h1>
          <p>{t('auth.sign_in_to_continue')}</p>
        </header>

        {errorKey && (
          <div className="alert alert--error" role="alert">
            {t(errorKey)}
          </div>
        )}

        <div className="actions">
          <Button variant="outline" disabled={busy} onClick={() => handleSocial('google')}>
            {pending === 'google'
              ? t('auth.connecting')
              : t('auth.continue_with_google')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => handleSocial('apple')}>
            {pending === 'apple'
              ? t('auth.connecting')
              : t('auth.continue_with_apple')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={handleDemo}>
            {pending === 'demo' ? t('auth.connecting') : t('auth.try_the_demo')}
          </Button>
        </div>

        <p className="card__note">{t('auth.no_personal_data')}</p>
      </section>

      <div className="auth__prefs">
        <ThemeSwitcher />
        <LocaleSwitcher />
      </div>
    </main>
  );
}
