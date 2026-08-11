import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { LocaleSwitcher } from '../components/LocaleSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useI18n } from '../lib/i18n/i18n-context';
import type { SessionListItem } from '../lib/contracts.gen';

function DeviceIcon() {
  return (
    <svg className="icon session__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1" />
      <path d="M12 16v4" />
      <path d="M8 20h8" />
    </svg>
  );
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
  const [actionFailed, setActionFailed] = useState(false);
  // 모바일 네비 드로어(사이드바 슬라이드인) — 데스크톱은 CSS로 항상 열린 사이드바.
  const [navOpen, setNavOpen] = useState(false);

  // 언마운트 뒤 도착한 응답이 상태를 건드리지 않게 한다(경합·누수 방지). 이 가드가
  // await 뒤 setState를 조건부로 만들어, 효과에서의 동기 setState 경고도 함께 없앤다
  // (AuthProvider가 generation으로 하는 것과 같은 방식).
  const alive = useRef(true);
  const started = useRef(false);
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
    // 마운트당 한 번만 불러온다(StrictMode 이중 호출·재실행 방지). 이 가드는
    // AuthProvider의 generation 가드와 같은 역할이며, 효과의 setState를 조건부로 만든다.
    if (started.current) return;
    started.current = true;
    void fetchSessions();
    return () => {
      alive.current = false;
    };
  }, [fetchSessions]);

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
      // 서버가 지웠다고 확인된 뒤에만 목록에서 뺀다.
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    } catch {
      setActionFailed(true);
    } finally {
      setRevokingId(null);
    }
  }

  async function handleSignOutAll() {
    setActionFailed(false);
    setSigningOutAll(true);
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
          <span className="topbar__title">{t('dashboard.title')}</span>
          <div className="topbar__controls">
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
              {hasOthers && (
                <Button
                  variant="ghost"
                  className="btn--compact"
                  disabled={signingOutAll}
                  onClick={handleSignOutAll}
                >
                  {signingOutAll
                    ? t('dashboard.signing_out_all')
                    : t('dashboard.sign_out_all')}
                </Button>
              )}
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
                  <span>{t('dashboard.col_session')}</span>
                  <span>{t('dashboard.col_started')}</span>
                  <span>{t('dashboard.col_expires')}</span>
                  <span>{t('dashboard.col_status')}</span>
                  <span />
                </div>
                <ul className="sessions__list">
                  {sessions.map((s) => (
                    <li key={s.id} className="sessions__row session">
                      <div className="session__id">
                        <span className="session__icon">
                          <DeviceIcon />
                        </span>
                        <span className="session__label">
                          {s.isCurrent
                            ? t('dashboard.this_session')
                            : t('dashboard.a_session')}
                          <span className="session__code">
                            #{s.id.slice(0, 8)}
                          </span>
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
                          className={`badge badge--${s.isCurrent ? 'success' : 'info'}`}
                        >
                          {s.isCurrent
                            ? t('dashboard.status_current')
                            : t('dashboard.status_active')}
                        </span>
                      </span>
                      <span className="session__action">
                        {!s.isCurrent && (
                          <Button
                            variant="ghost"
                            className="btn--compact"
                            disabled={revokingId === s.id}
                            onClick={() => handleRevoke(s.id)}
                          >
                            {revokingId === s.id
                              ? t('dashboard.revoking')
                              : t('dashboard.revoke')}
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
          </section>
        </main>
      </div>
    </div>
  );
}
