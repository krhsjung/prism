import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DeviceIcon } from '../components/DeviceIcon';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { DEVICE_LABELS } from '../lib/devices';
import { useSessions } from '../lib/sessions-context';
import { useI18n } from '../lib/i18n/i18n-context';
import { useMediaQuery } from '../lib/useMediaQuery';
import type { SessionListItem } from '../lib/contracts.gen';
import type { MessageKey } from '../lib/i18n/messages.gen';

// 배지가 말하는 것은 **연결 여부**지 세션의 유효성이 아니다(목록에는 유효한 세션만 온다).
//
// ⚠️ `socketReady`가 false면 `isConnected`를 믿지 않고 두 갈래로 물러난다.
// 내 소켓이 붙어 있지 않으면 서버가 내려준 빈 presence가 "아무도 안 붙었다"인지
// "소켓 서비스가 죽었다"인지 구별할 수 없고, 후자를 전자로 읽으면 멀쩡한 기기들을
// 전부 "비활성"이라고 지어내게 된다 — 모를 때는 지어내지 않는 쪽으로 실패한다.
function statusOf(
  session: SessionListItem,
  socketReady: boolean,
): { variant: 'success' | 'info' | 'neutral'; key: MessageKey } {
  if (session.isCurrent)
    return { variant: 'success', key: 'dashboard.status_current' };
  if (!socketReady || session.isConnected)
    return { variant: 'info', key: 'dashboard.status_active' };
  return { variant: 'neutral', key: 'dashboard.status_inactive' };
}

export function DashboardPage() {
  const navigate = useNavigate();
  // 세션 목록의 `refresh`와 이름이 겹친다 — 이쪽은 **인증 상태**를 다시 확인하는 것이다.
  const { refresh: refreshAuth } = useAuth();
  const { t, locale } = useI18n();

  // 세션 목록은 서버만 안다(세션 id가 HttpOnly 쿠키 안에 있다). null=로딩 전/중.
  //
  // **이 화면이 들고 있지 않다.** 목록은 통화·푸시와 같은 것이고, 조회와 소켓 신호는
  // `SessionsProvider`가 한 자리에서 처리한다 — 화면마다 옮겨 적으면 화면마다 신선도가
  // 달라진다.
  const { sessions, loadFailed, socketReady, refresh, reload, notifyChanged } =
    useSessions();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [signingOutAll, setSigningOutAll] = useState(false);
  // 전체 로그아웃은 되돌릴 수 없다 — 누르면 바로 실행하지 않고 한 번 되묻는다.
  const [confirmingSignOutAll, setConfirmingSignOutAll] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  // "모두 로그아웃"은 모바일에서 카드 머리 대신 **목록 아래로 자리를 옮긴다**(시안
  // `Dashboard / Mobile`). 부모가 바뀌는 배치라 CSS로는 표현할 수 없어 폭을 상태로 읽는다.
  const isMobile = useMediaQuery('(max-width: 720px)');

  // 시각은 화면 언어를 따른다 — 언어를 바꾸면 날짜 표기도 함께 바뀐다.
  const dtf = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : dtf.format(d);
  };

  async function handleRevoke(id: string) {
    setActionFailed(false);
    setRevokingId(id);
    try {
      await api.revokeSession(id);
      // **끊긴 기기가 20초를 기다리지 않게 한다.** 폐기는 auth 서비스가 처리하고
      // socket 서비스는 그 사실을 전달받는 통로가 없어, 스윕이 돌 때까지(최대
      // PRESENCE_RENEW_MS) 상대 기기가 멀쩡히 앉아 있다. 소켓은 이미 붙어 있으니
      // 우리가 깨워 준다 — 서버는 이 말을 믿지 않고 세션 저장소를 다시 읽는다.
      notifyChanged();
      // 로컬에서 그 행만 지우지 않고 서버에 다시 묻는다 — 그사이 다른 기기에서 로그인·
      // 만료가 일어날 수 있다(앱도 같은 규칙). `reload`가 아니라 `refresh`인 것이
      // 중요하다: 목록을 비우면 카드가 "불러오는 중"으로 접혔다 펴져 화면이 흔들린다.
      await refresh();
    } catch {
      setActionFailed(true);
    } finally {
      setRevokingId(null);
    }
  }

  async function handleSignOutAll() {
    setActionFailed(false);
    setSigningOutAll(true);
    setConfirmingSignOutAll(false);
    try {
      await api.revokeAllSessions();
      // 전체 폐기도 같다 — 다만 이 요청은 **내 세션까지** 끝내므로, 아래에서 곧바로
      // 로그인 화면으로 간다. 그 전에 다른 기기들이 즉시 쫓겨나게 해 둔다.
      notifyChanged();
    } catch {
      setActionFailed(true);
      setSigningOutAll(false);
      return;
    }
    // 현재 세션 쿠키도 무효가 됐다 — 상태를 비우고(401→anonymous) 로그인으로 보낸다.
    await refreshAuth();
    navigate('/login', { replace: true });
  }

  const hasOthers = (sessions?.length ?? 0) > 1;

  // "모두 로그아웃"은 **한 번만** 만든다 — 데스크톱은 카드 머리, 모바일은
  // 목록 아래 푸터. 누르면 바로 실행하지 않고 확인 창을 연다(되돌릴 수 없다).
  const signOutAllButton = hasOthers ? (
    <Button
      variant="ghost"
      className="btn--compact"
      disabled={signingOutAll}
      onClick={() => setConfirmingSignOutAll(true)}
    >
      {signingOutAll
        ? t('dashboard.signing_out_all')
        : t('dashboard.sign_out_all')}
    </Button>
  ) : null;

  return (
    <AppShell page="dashboard">
          <section className="card sessions">
            <header className="sessions__head">
              <div>
                <h2 className="sessions__title">{t('dashboard.active_sessions')}</h2>
                <p className="sessions__desc">
                  {t('dashboard.active_sessions_desc')}
                </p>
              </div>
              {!isMobile && signOutAllButton}
            </header>

            {actionFailed && (
              <div className="alert alert--error" role="alert">
                {t('error.revoke_failed')}
              </div>
            )}

            {sessions === null && !loadFailed && (
              <p className="sessions__state">{t('common.loading')}</p>
            )}

            {loadFailed && (
              <div className="sessions__state">
                <div className="alert alert--error" role="alert">
                  {t('error.sessions_load_failed')}
                </div>
                <Button
                  variant="outline"
                  className="btn--compact"
                  onClick={() => void reload()}
                >
                  {t('common.retry')}
                </Button>
              </div>
            )}

            {sessions && sessions.length > 0 && (
              <>
                <div className="sessions__row sessions__row--head" aria-hidden="true">
                  <span>{t('dashboard.col_device')}</span>
                  <span>{t('dashboard.col_started')}</span>
                  <span>{t('dashboard.col_expires')}</span>
                  <span>{t('dashboard.col_status')}</span>
                  <span />
                </div>
                <ul className="sessions__list">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className={`sessions__row session${
                        revokingId === s.id ? ' session--revoking' : ''
                      }`}
                      // 시각적 흐림만으로는 스크린 리더에 아무것도 전해지지 않는다.
                      aria-busy={revokingId === s.id}
                    >
                      <div className="session__id">
                        <span className="session__icon">
                          <DeviceIcon device={s.device} />
                        </span>
                        <span className="session__label">
                          {t(DEVICE_LABELS[s.device])}
                          {/* 기기명·브라우저·위치는 저장하지 않으므로(§5) 시안의 부제
                              자리에는 짧은 세션 id만 둔다. "현재/로그인된 세션"은 바로
                              옆 배지가 이미 말하고 있어, 함께 적으면 같은 말이 두 번
                              나오고 좁은 폭에서 줄바꿈까지 만든다. */}
                          <span className="session__code">#{s.id.slice(0, 8)}</span>
                        </span>
                      </div>
                      <span className="session__when">
                        <span className="session__k">
                          {t('dashboard.col_started')}
                        </span>
                        {fmt(s.startedAt)}
                      </span>
                      <span className="session__when">
                        <span className="session__k">
                          {t('dashboard.col_expires')}
                        </span>
                        {fmt(s.expiresAt)}
                      </span>
                      <span className="session__status">
                        <span
                          className={`badge badge--${statusOf(s, socketReady).variant}`}
                        >
                          {t(statusOf(s, socketReady).key)}
                        </span>
                      </span>
                      <span className="session__action">
                        {!s.isCurrent && (
                          <Button
                            variant="ghost"
                            className="btn--compact"
                            // 하나가 도는 동안에는 목록 전체를 잠근다 — 연달아 누르면
                            // 어느 것이 끊겼는지 알 수 없게 된다(앱도 같은 규칙).
                            disabled={revokingId !== null || signingOutAll}
                            /* 목록에 "해제"가 여럿이라 버튼 글자만으로는 무엇을 끊는지
                               알 수 없다 — 어느 세션인지 이름에 담는다. 화면에서 뺀
                               "현재/로그인된 세션"이 여기서 제 몫을 한다. */
                            aria-label={`${t('dashboard.revoke')}: ${t(
                              DEVICE_LABELS[s.device],
                            )} · ${
                              s.isCurrent
                                ? t('dashboard.this_session')
                                : t('dashboard.a_session')
                            } · #${s.id.slice(0, 8)}`}
                            onClick={() => handleRevoke(s.id)}
                          >
                            {/* 진행 중이라고 **글자를 바꾸지 않는다.** 버튼이 글자만큼만
                                차지해 "해제" → "해제하는 중…"이면 폭이 두 배가 되고 행이
                                밀린다 — 요청이 짧아 그 흔들림만 깜빡임으로 남는다.
                                진행 표시는 행 전체를 흐리게 하는 쪽이 맡는다. */}
                            {t('dashboard.revoke')}
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {sessions.length === 1 && (
                  <p className="sessions__note">{t('dashboard.only_this_session')}</p>
                )}
              </>
            )}

            {/* 좁은 폭에서는 목록 **아래**가 이 버튼의 자리다 — 무엇이 끊기는지 다 본
                뒤에 전체에 대한 행동을 하게 된다. 구분선으로 마지막 행과 갈라 두고
                폭을 채워, 행마다 있는 "해제" 기둥에 이어 붙어 보이지 않게 한다. */}
            {isMobile && signOutAllButton && (
              <footer className="sessions__foot">{signOutAllButton}</footer>
            )}
      </section>

      {confirmingSignOutAll && (
        <ConfirmDialog
          title={t('dashboard.sign_out_all_confirm_title')}
          body={t('dashboard.sign_out_all_confirm_body')}
          confirmLabel={t('dashboard.sign_out_all')}
          cancelLabel={t('common.cancel')}
          isBusy={signingOutAll}
          onConfirm={() => void handleSignOutAll()}
          onCancel={() => setConfirmingSignOutAll(false)}
        />
      )}
    </AppShell>
  );
}
