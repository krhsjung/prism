import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LocaleSwitcher } from '../components/LocaleSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useSessionSocket } from '../lib/session-socket-context';
import { useI18n } from '../lib/i18n/i18n-context';
import { useMediaQuery } from '../lib/useMediaQuery';
import type { DeviceKind, SessionListItem } from '../lib/contracts.gen';
import type { MessageKey } from '../lib/i18n/messages.gen';

/** 기기 종류가 어떤 실루엣으로 그려지는가. 브랜드가 달라도 생김새는 셋뿐이다. */
type DeviceShape = 'phone' | 'tablet' | 'monitor';

/**
 * 기기 종류별 아이콘. 브랜드 로고를 쓰지 않는다 — 상표를 앱에 심는 일이고, 목록에서
 * 필요한 것은 "폰인가 태블릿인가 데스크톱인가"라는 형태 구분뿐이다. `unknown`은 모니터를
 * 재사용한다: 모르는 것에 특별한 그림을 주면 그 자체가 하나의 상태처럼 읽힌다.
 */
function DeviceIcon({ device }: { device: DeviceKind }) {
  const shape = DEVICE_SHAPES[device];
  return (
    <svg className="icon session__glyph" viewBox="0 0 24 24" aria-hidden="true">
      {shape === 'phone' ? (
        <>
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <path d="M11 18h2" />
        </>
      ) : shape === 'tablet' ? (
        <>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <path d="M11 18h2" />
        </>
      ) : (
        <>
          <path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1" />
          <path d="M12 16v4" />
          <path d="M8 20h8" />
        </>
      )}
    </svg>
  );
}

/** 계약의 기기 종류 → 번역 키. 계약이 유니온이라 갈래가 늘면 컴파일에서 걸린다. */
const DEVICE_LABELS: Record<DeviceKind, MessageKey> = {
  iphone: 'dashboard.device_iphone',
  ipad: 'dashboard.device_ipad',
  galaxy: 'dashboard.device_galaxy',
  pixel: 'dashboard.device_pixel',
  android: 'dashboard.device_android',
  mac: 'dashboard.device_mac',
  windows: 'dashboard.device_windows',
  desktop: 'dashboard.device_desktop',
  unknown: 'dashboard.device_unknown',
};

const DEVICE_SHAPES: Record<DeviceKind, DeviceShape> = {
  iphone: 'phone',
  galaxy: 'phone',
  pixel: 'phone',
  android: 'phone',
  ipad: 'tablet',
  mac: 'monitor',
  windows: 'monitor',
  desktop: 'monitor',
  unknown: 'monitor',
};

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
  const { state, signOut, refresh } = useAuth();
  const { t, locale } = useI18n();

  // 로그아웃은 서버가 쿠키를 지워야 성립한다 — 실패하면 세션이 살아 있다는 사실을
  // 그대로 알린다("로그아웃됐다"고 속이면 새로고침에서 되살아나 더 혼란스럽다).
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // 세션 목록은 서버만 안다(세션 id가 HttpOnly 쿠키 안에 있다). null=로딩 전/중.
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [signingOutAll, setSigningOutAll] = useState(false);
  // 전체 로그아웃은 되돌릴 수 없다 — 누르면 바로 실행하지 않고 한 번 되묻는다.
  const [confirmingSignOutAll, setConfirmingSignOutAll] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  // 모바일 네비 드로어(사이드바 슬라이드인) — 데스크톱은 CSS로 항상 열린 사이드바.
  const [navOpen, setNavOpen] = useState(false);
  // 상단 바의 컨트롤은 모바일에서 **드로어 안으로 자리를 옮긴다**(시안 `Dashboard /
  // Mobile`). 부모가 바뀌는 배치라 CSS로는 표현할 수 없어 폭을 상태로 읽는다.
  const isMobile = useMediaQuery('(max-width: 720px)');

  // 언마운트 뒤 도착한 응답이 상태를 건드리지 않게 한다(경합·누수 방지). 이 가드가
  // await 뒤 setState를 조건부로 만들어, 효과에서의 동기 setState 경고도 함께 없앤다
  // (AuthProvider가 generation으로 하는 것과 같은 방식).
  // 소켓은 **신호만** 준다 — 목록은 아래 fetchSessions가 기존 HTTP 경로로 다시 가져온다.
  const { ready: socketReady, changed } = useSessionSocket();
  const alive = useRef(true);
  const started = useRef(false);
  // 이미 반영한 신호 번호. 0에서 시작하므로 마운트 시의 첫 조회와 겹치지 않고,
  // 같은 신호로 두 번 가져오지도 않는다(started ref와 같은 역할이다).
  const handled = useRef(0);
  // 드로어 열림 시 포커스를 옮길 닫기 버튼, 닫힐 때 되돌릴 햄버거 버튼.
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const list = await api.sessions();
      if (alive.current) setSessions(list);
    } catch {
      if (alive.current) setLoadFailed(true);
    }
  }, []);

  // 재시도는 사용자 액션 — 여기서는 로딩 상태로 되돌린 뒤 다시 불러온다.
  const reload = useCallback(async () => {
    setLoadFailed(false);
    setSessions(null);
    await fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    // **다시 살아났음을 먼저 표시한다.** StrictMode는 개발에서 마운트→정리→마운트를
    // 한 번 더 돌리는데, 정리가 alive를 끈 뒤 두 번째 마운트가 started에 막히면
    // 첫 요청의 응답이 영영 버려져 화면이 로딩에 멈춘다(운영 빌드에서는 이중 마운트가
    // 없어 드러나지 않는다).
    alive.current = true;
    // 요청 자체는 마운트당 한 번만 보낸다. 이 가드는 AuthProvider의 generation 가드와
    // 같은 역할이며, 효과의 setState를 조건부로 만든다.
    if (!started.current) {
      started.current = true;
      void fetchSessions();
    }
    return () => {
      alive.current = false;
    };
  }, [fetchSessions]);

  // 소켓이 "바뀌었다"고 하면 다시 가져온다.
  //
  // **비우지 않는다**(load가 아니라 fetchSessions) — 다른 기기가 하나 붙었다고 카드가
  // "불러오는 중"으로 접혔다 펴지면 목록 전체가 깜빡인다(plan/dashboard.md §4).
  // changed는 0에서 시작하고 소켓의 첫 ready가 1로 올리므로, 마운트 시의 첫 조회와
  // 겹치지 않는다.
  useEffect(() => {
    if (changed === handled.current) return;
    handled.current = changed;
    void fetchSessions();
  }, [changed, fetchSessions]);

  // 드로어가 열리면: 포커스를 안으로 옮기고, Esc로 닫고, 배경 스크롤을 잠근다.
  // 닫힐 때(cleanup) 포커스를 햄버거로 되돌린다 — 키보드 사용자가 위치를 잃지 않는다.
  useEffect(() => {
    if (!navOpen) return;
    const menuBtn = menuBtnRef.current; // 닫힐 때 되돌릴 대상을 지금 잡아둔다
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('nav-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('nav-open');
      menuBtn?.focus();
    };
  }, [navOpen]);

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

  // RequireAuth가 authenticated를 보장한다 — 여기서는 타입 좁히기만.
  if (state.status !== 'authenticated') return null;
  const { user } = state;

  async function handleLogout() {
    setLogoutFailed(false);
    setLeaving(true);
    if (await signOut()) {
      navigate('/login', { replace: true });
      return;
    }
    setLeaving(false);
    setLogoutFailed(true);
  }

  async function handleRevoke(id: string) {
    setActionFailed(false);
    setRevokingId(id);
    try {
      await api.revokeSession(id);
      // 로컬에서 그 행만 지우지 않고 서버에 다시 묻는다 — 그사이 다른 기기에서 로그인·
      // 만료가 일어날 수 있다(앱도 같은 규칙). `reload`가 아니라 `fetchSessions`인 것이
      // 중요하다: 목록을 비우면 카드가 "불러오는 중"으로 접혔다 펴져 화면이 흔들린다.
      await fetchSessions();
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
    } catch {
      setActionFailed(true);
      setSigningOutAll(false);
      return;
    }
    // 현재 세션 쿠키도 무효가 됐다 — 상태를 비우고(401→anonymous) 로그인으로 보낸다.
    await refresh();
    navigate('/login', { replace: true });
  }

  const hasOthers = (sessions?.length ?? 0) > 1;

  // 테마·언어·사용자·로그아웃 한 벌. **한 번만** 만들어 데스크톱에서는 상단 바에,
  // 모바일에서는 드로어 바닥에 꽂는다 — 양쪽에 두고 하나를 숨기면 같은 컨트롤이 DOM에
  // 둘이 되어 초점 순서와 메뉴 리스너가 이중이 된다.
  const controls = (
    <>
      <ThemeSwitcher align="end" />
      <LocaleSwitcher align="end" />
      <div className="topbar__user">
        <span className="topbar__user-name">{user.displayName}</span>
        <span className="topbar__user-provider">{user.provider}</span>
      </div>
      <Button
        variant="outline"
        className="btn--compact"
        disabled={leaving}
        onClick={handleLogout}
      >
        {leaving ? t('dashboard.logging_out') : t('dashboard.log_out')}
      </Button>
    </>
  );

  // 같은 이유로 "모두 로그아웃"도 **한 번만** 만든다 — 데스크톱은 카드 머리, 모바일은
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
    <div className="shell">
      <aside
        id="dashboard-nav"
        className={`sidebar${navOpen ? ' sidebar--open' : ''}`}
      >
        <div className="sidebar__head">
          <div className="sidebar__brand">Prism</div>
          {/* 닫기는 모바일 드로어에서만 보인다(CSS) — 데스크톱 사이드바엔 없다. */}
          <button
            ref={closeBtnRef}
            type="button"
            className="sidebar__close"
            aria-label={t('dashboard.close_menu')}
            onClick={() => setNavOpen(false)}
          >
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <nav className="sidebar__nav" aria-label={t('dashboard.navigation')}>
          <span className="navitem navitem--active" aria-current="page">
            {t('dashboard.title')}
          </span>
          {/* WebRTC는 다음 슬라이스 — 자리만 잡아두고 비활성으로 둔다(plan/dashboard.md). */}
          <span className="navitem navitem--soon" aria-disabled="true">
            {t('dashboard.nav_webrtc')}
            <span className="navitem__badge">{t('dashboard.coming_soon')}</span>
          </span>
        </nav>
        {/* 시안의 드로어는 내비게이션만 그리지만, 모바일 상단 바에서 밀려난 컨트롤이
            갈 곳이 여기뿐이다 — 로그아웃을 잃어버리지 않도록 바닥에 붙인다. */}
        {isMobile && <div className="sidebar__footer">{controls}</div>}
      </aside>
      {/* 스크림 — 모바일 드로어 열림 시에만 렌더. 탭하면 닫힌다. */}
      {navOpen && (
        <div
          className="scrim"
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className="shell__main">
        <header className="topbar">
          {/* 모바일 상단 바는 워드마크를 단다(시안) — 지금 페이지가 어디인지는 드로어의
              활성 항목이 말한다. 데스크톱은 사이드바가 늘 보이므로 페이지 라벨을 쓴다. */}
          <span className="topbar__title">
            {isMobile ? 'Prism' : t('dashboard.title')}
          </span>
          <div className="topbar__controls">
            {isMobile ? <Avatar name={user.displayName} /> : controls}
            {/* 햄버거 — 모바일에서만 보인다(CSS). 드로어를 연다. */}
            <button
              ref={menuBtnRef}
              type="button"
              className="topbar__menu"
              aria-label={t('dashboard.open_menu')}
              aria-controls="dashboard-nav"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </div>
        </header>

        <main className="content">
          {logoutFailed && (
            <div className="alert alert--error" role="alert">
              {t('error.logout_failed')}
            </div>
          )}

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
                  {t('dashboard.retry')}
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
        </main>
      </div>

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
    </div>
  );
}
