import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { AuthContext, type AuthContextValue } from '../lib/auth-context';
import { I18nContext } from '../lib/i18n/i18n-context';
import { englishI18n } from '../lib/i18n/test-i18n';
import { ThemeContext } from '../lib/theme/theme-context';
import { lightTheme } from '../lib/theme/test-theme';
import { OAUTH_MESSAGE_TYPE, type User } from '../lib/contracts.gen';

// 소셜 시작은 브라우저 이동이라 api 모듈만 대체하고 실제 이동은 스텁으로 막는다.
vi.mock('../lib/api', () => ({
  API_ORIGIN: 'https://api.test',
  ApiError: class ApiError extends Error {
    status = 0;
    code = '';
  },
  api: {
    socialLoginUrl: (provider: string, flow: string) =>
      `https://api.test/auth/${provider}?flow=${flow}`,
    demoLogin: vi.fn(),
  },
}));

const refresh = vi.fn(async () => true);

const auth: AuthContextValue = {
  state: { status: 'anonymous' },
  signIn: vi.fn(),
  refresh,
  signOut: vi.fn(async () => true),
};

// jsdom의 location.assign은 재정의가 막혀 있어 location 자체를 스텁으로 갈아끼운다.
const assign = vi.fn();

// 팝업 창 스텁 — 닫힘 폴링과 close() 호출을 관찰한다.
// 메시지의 source 대조 대상이기도 해서 마지막으로 연 창을 기억해 둔다.
type PopupStub = { closed: boolean; close: ReturnType<typeof vi.fn> };
let openedPopup: PopupStub;

function stubPopup(): PopupStub {
  openedPopup = { closed: false, close: vi.fn() };
  vi.stubGlobal(
    'open',
    vi.fn(() => openedPopup),
  );
  return openedPopup;
}

// prefersPopup()이 데스크톱으로 판정하도록 matchMedia를 심는다(미설정이면 redirect).
function useDesktop(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches })),
  );
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <I18nContext.Provider value={englishI18n()}>
        <ThemeContext.Provider value={lightTheme()}>
          <AuthContext.Provider value={auth}>
            <LoginPage />
          </AuthContext.Provider>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    </MemoryRouter>,
  );
}

// bfcache 복원 신호. jsdom에 PageTransitionEvent가 없을 수 있어 직접 만든다.
function firePageShow(persisted: boolean) {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted });
  act(() => {
    window.dispatchEvent(event);
  });
}

// 서버 콜백 페이지가 보내는 것과 같은 형태의 메시지.
interface PopupMessageData {
  type: string;
  ok: boolean;
  error?: string;
}

// source는 jsdom의 MessageEvent 생성자가 Window만 받아 거부하므로 직접 정의한다.
interface PopupMessageFrom {
  origin?: string;
  source?: object | null;
}

function firePopupMessage(
  data: PopupMessageData,
  { origin = 'https://api.test', source = openedPopup }: PopupMessageFrom = {},
) {
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: source });
  act(() => {
    window.dispatchEvent(event);
  });
}

const googleButton = () =>
  screen.getByRole<HTMLButtonElement>('button', {
    name: /Continue with Google|Connecting/,
  });

describe('LoginPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    assign.mockClear();
    refresh.mockClear();
    refresh.mockResolvedValue(true);
    vi.stubGlobal('location', { assign, href: 'https://web.test/login' });
    useDesktop(false); // 기본은 redirect 흐름
  });

  // vitest globals를 켜지 않아 testing-library의 자동 cleanup이 등록되지 않는다.
  // 직접 정리하지 않으면 이전 테스트의 DOM이 남아 role 조회가 중복 매칭된다.
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ──────────────── redirect 흐름 ────────────────

  it('모바일(팝업 부적합)에서는 redirect 흐름으로 시작한다', () => {
    renderLogin();
    fireEvent.click(googleButton());

    expect(googleButton().textContent).toContain('Connecting');
    expect(googleButton().disabled).toBe(true);
    expect(assign).toHaveBeenCalledWith(
      'https://api.test/auth/google?flow=redirect',
    );
  });

  // 회귀 방지: 뒤로 가기(bfcache 복원)는 컴포넌트를 다시 마운트하지 않으므로
  // pending이 남아 버튼이 Connecting…으로 굳고 재시도가 불가능했다.
  it('뒤로 가기로 bfcache 복원되면 대기 상태가 풀려 재시도할 수 있다', () => {
    renderLogin();
    fireEvent.click(googleButton());
    expect(googleButton().disabled).toBe(true);

    firePageShow(true);

    expect(googleButton().textContent).toContain('Continue with Google');
    expect(googleButton().disabled).toBe(false);

    assign.mockClear();
    fireEvent.click(googleButton());
    expect(assign).toHaveBeenCalledWith(
      'https://api.test/auth/google?flow=redirect',
    );
  });

  it('bfcache 복원이 아닌 pageshow는 대기 상태를 건드리지 않는다', () => {
    renderLogin();
    fireEvent.click(googleButton());
    firePageShow(false);
    expect(googleButton().disabled).toBe(true);
  });

  // 회귀 방지: 로그인 성공 후 /login이 history에 남아, 대시보드에서 뒤로 가기로
  // 로그인 폼이 다시 뜨며 흐름이 꼬였다. 이미 인증된 상태면 대시보드로 되돌린다.
  it('이미 인증된 상태로 도달하면 대시보드로 되돌린다', () => {
    const user: User = {
      id: 'u1',
      provider: 'google',
      displayName: 'Ada',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const authedCtx: AuthContextValue = {
      ...auth,
      state: { status: 'authenticated', user },
    };
    render(
      <MemoryRouter initialEntries={['/login']}>
        <I18nContext.Provider value={englishI18n()}>
          <ThemeContext.Provider value={lightTheme()}>
            <AuthContext.Provider value={authedCtx}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/dashboard" element={<div>DASHBOARD</div>} />
              </Routes>
            </AuthContext.Provider>
          </ThemeContext.Provider>
        </I18nContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByText('DASHBOARD')).toBeDefined();
    expect(
      screen.queryByRole('button', { name: /Continue with Google/ }),
    ).toBeNull();
  });

  // ──────────────── popup 흐름 ────────────────

  it('데스크톱에서는 팝업으로 시작한다', () => {
    useDesktop(true);
    stubPopup();

    renderLogin();
    fireEvent.click(googleButton());

    expect(window.open).toHaveBeenCalledWith(
      'https://api.test/auth/google?flow=popup',
      'prism-oauth',
      expect.stringContaining('width='),
    );
    expect(assign).not.toHaveBeenCalled(); // 페이지 이동 없음
  });

  it('팝업이 차단되면 redirect로 폴백한다', () => {
    useDesktop(true);
    vi.stubGlobal('open', vi.fn(() => null));

    renderLogin();
    fireEvent.click(googleButton());

    expect(assign).toHaveBeenCalledWith(
      'https://api.test/auth/google?flow=redirect',
    );
  });

  it('팝업 성공 메시지를 받으면 세션을 확인하고 대시보드로 간다', async () => {
    useDesktop(true);
    const popup = stubPopup();

    renderLogin();
    fireEvent.click(googleButton());
    firePopupMessage({ type: OAUTH_MESSAGE_TYPE, ok: true });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(popup.close).toHaveBeenCalled();
  });

  // 다른 출처가 보낸 메시지로 로그인 성공을 위조할 수 있으면 안 된다.
  it('다른 origin의 메시지는 무시한다', async () => {
    useDesktop(true);
    stubPopup();

    renderLogin();
    fireEvent.click(googleButton());
    firePopupMessage(
      { type: OAUTH_MESSAGE_TYPE, ok: true },
      { origin: 'https://evil.test' },
    );

    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    expect(googleButton().disabled).toBe(true); // 여전히 대기 중
  });

  // 같은 origin이라도 우리가 연 창이 아니면 받아들이지 않는다 — origin 검증만 남기면
  // 그 출처의 다른 프레임/창이 로그인 성공을 위조할 수 있다.
  it('우리가 연 창이 아닌 곳에서 온 메시지는 무시한다', async () => {
    useDesktop(true);
    stubPopup();

    renderLogin();
    fireEvent.click(googleButton());
    firePopupMessage(
      { type: OAUTH_MESSAGE_TYPE, ok: true },
      { source: { closed: false, close: vi.fn() } },
    );

    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    expect(googleButton().disabled).toBe(true); // 여전히 대기 중
  });

  // COOP 등으로 source가 비어 오는 경우도 예외로 두지 않는다.
  it('source가 없는 메시지는 무시한다', async () => {
    useDesktop(true);
    stubPopup();

    renderLogin();
    fireEvent.click(googleButton());
    firePopupMessage({ type: OAUTH_MESSAGE_TYPE, ok: true }, { source: null });

    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('형식이 다른 메시지는 무시한다', async () => {
    useDesktop(true);
    stubPopup();

    renderLogin();
    fireEvent.click(googleButton());
    firePopupMessage({ type: 'something:else', ok: true });

    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('팝업 실패 메시지는 오류 문구로 보여주고 재시도 가능 상태로 되돌린다', async () => {
    useDesktop(true);
    stubPopup();

    renderLogin();
    fireEvent.click(googleButton());
    firePopupMessage({
      type: OAUTH_MESSAGE_TYPE,
      ok: false,
      error: 'SIGNIN_FAILED',
    });

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toContain(
      'Couldn’t sign you in',
    );
    expect(googleButton().disabled).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('사용자가 팝업을 취소하면 알림 없이 원상 복귀한다', async () => {
    useDesktop(true);
    stubPopup();
    refresh.mockResolvedValue(false); // 세션 없음 = 진짜 취소

    renderLogin();
    fireEvent.click(googleButton());
    firePopupMessage({ type: OAUTH_MESSAGE_TYPE, ok: false });

    await waitFor(() => expect(googleButton().disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // 회귀 방지: 서버 콜백은 postMessage 직후 창을 닫는다. 닫힘이 메시지보다 먼저
  // 관측되면 로그인에 성공하고도 취소로 처리돼 로그인 화면에 남는 경합이 있었다.
  it('메시지 없이 창만 닫혀도 세션이 있으면 로그인으로 처리한다', async () => {
    useDesktop(true);
    const popup = stubPopup();
    refresh.mockResolvedValue(true); // 서버에는 세션이 만들어져 있다

    renderLogin();
    fireEvent.click(googleButton());

    // 메시지 없이 창만 닫는다.
    popup.closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // 아무 신호도 오지 않으면(멈춘 provider 페이지 등) 상한에서 풀려야 한다.
  it('전체 타임아웃이 지나면 대기 상태가 풀린다', async () => {
    useDesktop(true);
    stubPopup();
    refresh.mockResolvedValue(false);

    renderLogin();
    fireEvent.click(googleButton());
    expect(googleButton().disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1000);
    });

    expect(googleButton().disabled).toBe(false);
  });
});
