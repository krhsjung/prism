import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { useAuth } from '../lib/auth-context';

// 로그아웃은 서버가 쿠키를 지워야 성립한다 — 실패하면 세션이 살아 있다는 사실을
// 그대로 알린다("로그아웃됐다"고 속이면 새로고침에서 되살아나 더 혼란스럽다).
const LOGOUT_FAILED_MESSAGE =
  'Couldn’t log you out. You’re still signed in — check your connection and try again.';

export function DashboardPage() {
  const navigate = useNavigate();
  const { state, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // RequireAuth가 authenticated를 보장한다 — 여기서는 타입 좁히기만.
  if (state.status !== 'authenticated') return null;
  const { user } = state;

  async function handleLogout() {
    setError(null);
    setLeaving(true);
    if (await signOut()) {
      navigate('/login', { replace: true });
      return;
    }
    setLeaving(false);
    setError(LOGOUT_FAILED_MESSAGE);
  }

  return (
    <main className="dash">
      <header className="dash__head">
        <div>
          <h1>Dashboard</h1>
          <p>
            Signed in as <strong>{user.displayName}</strong> · {user.provider}
          </p>
        </div>
        <Button variant="outline" disabled={leaving} onClick={handleLogout}>
          {leaving ? 'Logging out…' : 'Log out'}
        </Button>
      </header>

      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <section className="card">
        <p>
          You’re in. This is a placeholder dashboard for the authentication
          vertical slice — the demo login flow works end to end.
        </p>
      </section>
    </main>
  );
}
