import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { useI18n } from '../lib/i18n/i18n-context';
import { AUTH_ERROR_CODES } from '../lib/contracts.gen';

// 소셜 로그인 redirect 흐름의 착지점. 서버가 세션을 HttpOnly 쿠키로 심어두고
// 이 라우트로 돌려보낸다 — URL에는 토큰이 없다(주소창·히스토리에 남을 것이 없다).
// 쿠키는 JS가 읽을 수 없으므로 서버에 확인(refresh)한 뒤 이동한다.
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { t } = useI18n();
  // StrictMode 이중 실행에서 확인 요청이 두 번 나가지 않게 한 번만 처리한다.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    void refresh().then((ok) =>
      navigate(
        ok ? '/dashboard' : `/login?error=${AUTH_ERROR_CODES.SIGNIN_FAILED}`,
        { replace: true },
      ),
    );
  }, [navigate, refresh]);

  return (
    <main className="auth">
      <p className="card__note">{t('auth.signing_you_in')}</p>
    </main>
  );
}
