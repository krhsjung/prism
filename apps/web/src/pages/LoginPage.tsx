import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { API_ORIGIN, ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
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

// 오류 코드 → 사용자 메시지 단일 매핑 — redirect 오류(?error=…)와 API 오류가 공유한다.
// 키는 계약 상수에서만 가져오고, 없는 코드는 일반 메시지로 폴백.
const GENERIC_ERROR_MESSAGE =
  'Something went wrong. Please try again in a moment.';

const ERROR_MESSAGES: Record<string, string> = {
  [AUTH_ERROR_CODES.SIGNIN_FAILED]:
    'Couldn’t sign you in. Try again or use another method.',
  [AUTH_ERROR_CODES.DEMO_DISABLED]: 'Demo login is disabled right now.',
  [CLIENT_ERROR_CODES.NETWORK_ERROR]:
    'Connection lost. Check your network and try again.',
};

function messageFor(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? GENERIC_ERROR_MESSAGE;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn, refresh } = useAuth();
  const [searchParams] = useSearchParams();
  const [pending, setPending] = useState<Pending>(null);
  // 진행 중인 팝업 핸들 — 언마운트 시 정리해야 리스너·타이머가 남지 않는다.
  const popupRef = useRef<OAuthPopupHandle | null>(null);
  // 소셜 redirect 흐름이 실패 시 ?error=…로 돌아온다 (plan/auth.md 에러 경로).
  const [error, setError] = useState<string | null>(() =>
    messageFor(searchParams.get('error')),
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
    setError(null);
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
      if (result.ok) setError(messageFor(AUTH_ERROR_CODES.SIGNIN_FAILED));
    } else {
      setError(messageFor(result.error));
    }
    // 취소(오류 코드 없음 + 세션 없음)는 조용히 원상 복귀한다.
    setPending(null);
  }

  async function handleDemo() {
    setError(null);
    setPending('demo');
    try {
      // 세션 쿠키는 서버가 응답에 심는다 — 웹은 사용자 정보만 채택한다.
      const { user } = await api.demoLogin();
      signIn(user);
      navigate('/dashboard');
    } catch (e) {
      setError(
        e instanceof ApiError ? messageFor(e.code) : GENERIC_ERROR_MESSAGE,
      );
      setPending(null);
    }
  }

  return (
    <main className="auth">
      <div className="auth__brand">Prism</div>

      <section className="card">
        <header className="card__head">
          <h1>Welcome back</h1>
          <p>Sign in to continue</p>
        </header>

        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        <div className="actions">
          <Button variant="outline" disabled={busy} onClick={() => handleSocial('google')}>
            {pending === 'google' ? 'Connecting…' : 'Continue with Google'}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => handleSocial('apple')}>
            {pending === 'apple' ? 'Connecting…' : 'Continue with Apple'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={handleDemo}>
            {pending === 'demo' ? 'Connecting…' : 'Try the demo'}
          </Button>
        </div>

        <p className="card__note">This portfolio stores no personal data.</p>
      </section>
    </main>
  );
}
