import { type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { AuthProvider } from './lib/AuthProvider';
import { useAuth } from './lib/auth-context';

// 보호 라우트: 검증 완료 전엔 대기, 익명이면 로그인으로.
// (실제 검증은 AuthProvider가 초기 1회 수행 — 페이지별 중복 검증 없음)
function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status === 'loading') {
    return (
      <main className="auth">
        <p className="card__note">Loading…</p>
      </main>
    );
  }
  return state.status === 'authenticated' ? (
    <>{children}</>
  ) : (
    <Navigate to="/login" replace />
  );
}

// 그 외 경로: 인증 상태에 따라 홈 결정.
function HomeRedirect() {
  const { state } = useAuth();
  if (state.status === 'loading') return null;
  return (
    <Navigate
      to={state.status === 'authenticated' ? '/dashboard' : '/login'}
      replace
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
