import { type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { WebRtcPage } from "./pages/WebRtcPage";
import { IncomingCallDialog } from "./components/webrtc/IncomingCallDialog";
import { CallProvider } from "./lib/webrtc/CallProvider";
import { useCall } from "./lib/webrtc/call-context";
import { AuthProvider } from "./lib/AuthProvider";
import { SessionSocketProvider } from "./lib/SessionSocketProvider";
import { useAuth } from "./lib/auth-context";
import { useI18n } from "./lib/i18n/i18n-context";

// 보호 라우트: 검증 완료 전엔 대기, 익명이면 로그인으로.
// (실제 검증은 AuthProvider가 초기 1회 수행 — 페이지별 중복 검증 없음)
function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const { t } = useI18n();
  if (state.status === "loading") {
    return (
      <main className="auth">
        <p className="card__note">{t("common.loading")}</p>
      </main>
    );
  }
  return state.status === "authenticated" ? (
    <>{children}</>
  ) : (
    <Navigate to="/login" replace />
  );
}

// 걸려 온 통화는 **앱 위에** 뜬다 — 대시보드를 보고 있어도 마찬가지다(plan/webrtc.md §4).
// 소켓이 이미 앱 전역에 붙어 있으므로 벨을 놓칠 자리가 없다.
function IncomingCallGate() {
  const { incoming, acceptIncoming, declineIncoming } = useCall();
  if (!incoming) return null;
  return (
    <IncomingCallDialog
      from={incoming.from}
      onAccept={acceptIncoming}
      onDecline={declineIncoming}
    />
  );
}

// 그 외 경로: 인증 상태에 따라 홈 결정.
function HomeRedirect() {
  const { state } = useAuth();
  if (state.status === "loading") return null;
  return (
    <Navigate
      to={state.status === "authenticated" ? "/dashboard" : "/login"}
      replace
    />
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* 소켓은 로그인해 있는 동안 열려 있다 — 대시보드 밖에서도 내 기기는
            "붙어 있음"이어야 한다. AuthProvider 안이라 인증 상태를 볼 수 있다. */}
        <SessionSocketProvider>
          {/* 통화 상태도 소켓처럼 **화면이 아니라 앱**에 매단다 — 라우터 안이라
              수락이 곧 /webrtc로 옮겨 갈 수 있다. */}
          <CallProvider>
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
              <Route
                path="/webrtc"
                element={
                  <RequireAuth>
                    <WebRtcPage />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<HomeRedirect />} />
            </Routes>
            <IncomingCallGate />
          </CallProvider>
        </SessionSocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
