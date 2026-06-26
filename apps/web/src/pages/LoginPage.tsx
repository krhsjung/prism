import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { ApiError, api } from '../lib/api';
import { tokenStore } from '../lib/auth';

type Pending = 'google' | 'apple' | 'demo' | null;

export function LoginPage() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = pending !== null;

  async function handleDemo() {
    setError(null);
    setPending('demo');
    try {
      const { accessToken } = await api.demoLogin();
      tokenStore.set(accessToken);
      navigate('/dashboard');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DEMO_DISABLED') {
        setError('Demo login is disabled right now.');
      } else if (e instanceof ApiError && e.code === 'NETWORK_ERROR') {
        setError('Connection lost. Check your network and try again.');
      } else {
        setError('Something went wrong. Please try again in a moment.');
      }
      setPending(null);
    }
  }

  function handleSocialStub() {
    setError('Social sign-in isn’t wired up in this demo yet — use “Try the demo”.');
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
          <Button variant="outline" disabled={busy} onClick={handleSocialStub}>
            {pending === 'google' ? 'Connecting…' : 'Continue with Google'}
          </Button>
          <Button variant="primary" disabled={busy} onClick={handleSocialStub}>
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
