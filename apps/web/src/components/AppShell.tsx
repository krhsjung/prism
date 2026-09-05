import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';
import { useAuth } from '../lib/auth-context';
import { useI18n } from '../lib/i18n/i18n-context';
import { useMediaQuery } from '../lib/useMediaQuery';

/** 사이드바가 아는 페이지. 라우트가 늘면 여기가 먼저 걸린다. */
export type ShellPage = 'dashboard' | 'webrtc';

const NAV: {
  page: ShellPage;
  to: string;
  key: 'dashboard.title' | 'webrtc.title';
}[] = [
  { page: 'dashboard', to: '/dashboard', key: 'dashboard.title' },
  { page: 'webrtc', to: '/webrtc', key: 'webrtc.title' },
];

/**
 * 앱 셸 — 사이드바 · 상단 바 · 드로어. 페이지는 `children`으로 본문만 넣는다.
 *
 * 통화 화면이 셸을 벗어나지 않는 것은 **결정**이다(plan/webrtc.md §4): 이 슬라이스가
 * 증명하려는 것은 "같은 앱이 네 플랫폼에서 같게 동작한다"이고, 셸이 곧 그 앱이다.
 * 통화만 전체화면이 되면 사이드바의 활성 항목이 사라져 지금 어디인지가 화면에서
 * 지워지고, 나가는 길을 컨트롤 바의 종료와 **둘** 설계해야 한다.
 *
 * 로그아웃이 여기 사는 이유: 컨트롤 한 벌(테마·언어·사용자·로그아웃)이 데스크톱에서는
 * 상단 바, 모바일에서는 드로어 바닥으로 **자리를 옮긴다**. 부모가 바뀌는 배치라 CSS로는
 * 표현할 수 없고, 양쪽에 두고 하나를 숨기면 같은 컨트롤이 DOM에 둘이 되어 초점 순서와
 * 메뉴 리스너가 이중이 된다.
 */
export function AppShell({
  page,
  children,
  headerExtra,
}: {
  page: ShellPage;
  children: ReactNode;
  /** 상단 바 오른쪽에 페이지가 얹는 것(지금은 쓰는 곳이 없다). */
  headerExtra?: ReactNode;
}) {
  const navigate = useNavigate();
  const { state, signOut } = useAuth();
  const { t } = useI18n();

  // 로그아웃은 서버가 쿠키를 지워야 성립한다 — 실패하면 세션이 살아 있다는 사실을
  // 그대로 알린다("로그아웃됐다"고 속이면 새로고침에서 되살아나 더 혼란스럽다).
  const [logoutFailed, setLogoutFailed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // 모바일 네비 드로어(사이드바 슬라이드인) — 데스크톱은 CSS로 항상 열린 사이드바.
  const [navOpen, setNavOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 720px)');

  // 드로어 열림 시 포커스를 옮길 닫기 버튼, 닫힐 때 되돌릴 햄버거 버튼.
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

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

  const title = t(page === 'webrtc' ? 'webrtc.title' : 'dashboard.title');

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
          {NAV.map((item) =>
            item.page === page ? (
              <span
                key={item.page}
                className="navitem navitem--active"
                aria-current="page"
              >
                {t(item.key)}
              </span>
            ) : (
              <Link
                key={item.page}
                className="navitem"
                to={item.to}
                // 드로어에서 옮겨 가면 드로어는 닫혀 있어야 한다 — 라우트만 바뀌고
                // 패널이 남으면 새 화면이 그 뒤에 가려진다.
                onClick={() => setNavOpen(false)}
              >
                {t(item.key)}
              </Link>
            ),
          )}
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
          <span className="topbar__title">{isMobile ? 'Prism' : title}</span>
          <div className="topbar__controls">
            {headerExtra}
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
          {children}
        </main>
      </div>
    </div>
  );
}
