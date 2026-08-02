import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { LocaleSwitcher } from '../components/LocaleSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { useAuth } from '../lib/auth-context';
import { useI18n } from '../lib/i18n/i18n-context';

export function DashboardPage() {
  const navigate = useNavigate();
  const { state, signOut } = useAuth();
  const { t } = useI18n();
  // 로그아웃은 서버가 쿠키를 지워야 성립한다 — 실패하면 세션이 살아 있다는 사실을
  // 그대로 알린다("로그아웃됐다"고 속이면 새로고침에서 되살아나 더 혼란스럽다).
  const [failed, setFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // RequireAuth가 authenticated를 보장한다 — 여기서는 타입 좁히기만.
  if (state.status !== 'authenticated') return null;
  const { user } = state;

  async function handleLogout() {
    setFailed(false);
    setLeaving(true);
    if (await signOut()) {
      navigate('/login', { replace: true });
      return;
    }
    setLeaving(false);
    setFailed(true);
  }

  return (
    <main className="dash">
      <header className="dash__head">
        <div>
          <h1>{t('dashboard.title')}</h1>
          {/* 이름을 문장에서 떼어내지 않는다 — 언어마다 이름이 놓이는 자리가 달라
              앞뒤로 쪼개면 번역이 불가능해진다(interpolate.ts). */}
          <p>
            {t('dashboard.signed_in_as', { name: user.displayName })} ·{' '}
            {user.provider}
          </p>
        </div>
        <div className="dash__actions">
          <ThemeSwitcher align="end" />
          <LocaleSwitcher align="end" />
          <Button variant="outline" disabled={leaving} onClick={handleLogout}>
            {leaving ? t('dashboard.logging_out') : t('dashboard.log_out')}
          </Button>
        </div>
      </header>

      {failed && (
        <div className="alert alert--error" role="alert">
          {t('error.logout_failed')}
        </div>
      )}

      <section className="card">
        <p>{t('dashboard.placeholder_body')}</p>
      </section>
    </main>
  );
}
