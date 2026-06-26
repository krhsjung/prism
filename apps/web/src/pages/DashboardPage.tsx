import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { api } from '../lib/api';
import { tokenStore } from '../lib/auth';
import type { User } from '../lib/types';

export function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    api
      .me(token)
      .then(setUser)
      .catch(() => {
        tokenStore.clear();
        navigate('/login', { replace: true });
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  async function handleLogout() {
    const token = tokenStore.get();
    if (token) {
      try {
        await api.logout(token);
      } catch {
        /* best-effort — token is cleared regardless */
      }
    }
    tokenStore.clear();
    navigate('/login', { replace: true });
  }

  if (loading) {
    return (
      <main className="dash">
        <p className="dash__loading">Loading…</p>
      </main>
    );
  }

  return (
    <main className="dash">
      <header className="dash__head">
        <div>
          <h1>Dashboard</h1>
          <p>
            Signed in as <strong>{user?.displayName}</strong> · {user?.provider}
          </p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          Log out
        </Button>
      </header>

      <section className="card">
        <p>
          You’re in. This is a placeholder dashboard for the authentication
          vertical slice — the demo login flow works end to end.
        </p>
      </section>
    </main>
  );
}
