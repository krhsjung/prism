import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage";
import { AuthContext, type AuthContextValue } from "../lib/auth-context";
import {
  SessionSocketContext,
  type SessionSocketValue,
} from "../lib/session-socket-context";
import type { SocketUpstreamMessage } from "../lib/contracts.gen";
import { I18nContext } from "../lib/i18n/i18n-context";
import { englishI18n } from "../lib/i18n/test-i18n";
import { ThemeContext } from "../lib/theme/theme-context";
import { lightTheme } from "../lib/theme/test-theme";
import type { SessionListItem, User } from "../lib/contracts.gen";

// 대시보드는 마운트 시 세션을 불러오고 revoke/sign-out-all을 호출한다 — 네트워크 대신
// 계약 형태의 값을 돌려주는 가짜 api로 대체한다(테스트가 서버에 의존하지 않게).
vi.mock("../lib/api", () => ({
  api: {
    sessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeAllSessions: vi.fn(),
  },
}));
import { api } from "../lib/api";

const user: User = {
  id: "u-1",
  provider: "google",
  displayName: "Alice",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const currentSession: SessionListItem = {
  id: "sess-current-1",
  startedAt: "2026-01-01T09:00:00.000Z",
  expiresAt: "2026-01-01T17:00:00.000Z",
  isCurrent: true,
  isConnected: true,
  pushRegistered: true,
  device: "mac",
};
const otherSession: SessionListItem = {
  id: "sess-other-2",
  startedAt: "2026-01-02T09:00:00.000Z",
  expiresAt: "2026-01-03T09:00:00.000Z",
  isCurrent: false,
  // 기본 픽스처는 **붙어 있지 않다** — 소켓이 ready일 때만 그 사실이 배지에 드러난다.
  isConnected: false,
  pushRegistered: false,
  device: "iphone",
};

// 소켓 컨텍스트 한 벌. 통화 시그널링(send·subscribeCall)은 이 화면의 관심사가 아니라
// 계약을 채우기만 한다 — 대시보드는 보내지도 듣지도 않는다.
const socketValue = (ready: boolean, changed = 0): SessionSocketValue => ({
  ready,
  changed,
  send: () => false,
  subscribeCall: () => () => {},
});

function renderDashboard(
  signOut: () => Promise<boolean> = async () => true,
  // 소켓이 붙어 있지 않은 것이 **기본값**이다 — 대부분의 테스트는 배지의 연결 여부에
  // 관심이 없고, 그 경우 화면은 이 기능 이전의 두 갈래로 물러난다.
  socket: SessionSocketValue = socketValue(false, 0),
): { rerenderSocket: (next: SessionSocketValue) => void } {
  const auth: AuthContextValue = {
    state: { status: "authenticated", user },
    endedUnexpectedly: false,
    signIn: vi.fn(),
    refresh: vi.fn(async () => true),
    signOut,
  };
  const tree = (value: SessionSocketValue) => (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <I18nContext.Provider value={englishI18n()}>
        <ThemeContext.Provider value={lightTheme()}>
          <AuthContext.Provider value={auth}>
            <SessionSocketContext.Provider value={value}>
              <DashboardPage />
            </SessionSocketContext.Provider>
          </AuthContext.Provider>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    </MemoryRouter>
  );
  const { rerender } = render(tree(socket));
  return { rerenderSocket: (next) => rerender(tree(next)) };
}

/** 해제 버튼들. 접근성 이름에 세션 설명이 붙으므로 이름 전체가 아니라 앞부분으로 찾는다. */
const revokeButtons = () =>
  screen.queryAllByRole<HTMLButtonElement>("button", { name: /^Revoke/ });

const logoutButton = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: /Log out|Logging out/,
  });

/**
 * 좁은 폭을 흉내 낸다 — jsdom에는 `matchMedia`가 없어 기본은 데스크톱 배치로 떨어진다.
 * 폭이 바뀌는 시나리오는 없으므로 `change` 구독은 빈 구현으로 둔다.
 */
function stubNarrowViewport(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 720px"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe("DashboardPage", () => {
  // 가짜 서버는 **해제를 기억한다.** 화면이 해제 뒤 목록을 다시 묻기 때문에(로컬에서 행만
  // 지우면 그사이 달라진 목록과 어긋난다), 기억하지 않는 가짜는 지운 세션을 되살려
  // 테스트를 거짓으로 실패시킨다.
  let serverSessions: SessionListItem[] = [];

  beforeEach(() => {
    serverSessions = [currentSession, otherSession];
    vi.mocked(api.sessions).mockImplementation(async () => serverSessions);
    vi.mocked(api.revokeSession).mockImplementation(async (id: string) => {
      serverSessions = serverSessions.filter((s) => s.id !== id);
    });
    vi.mocked(api.revokeAllSessions).mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // ── 반응형 셸 ──

  it("좁은 폭에서는 상단 바 컨트롤이 드로어 안으로 옮겨간다", async () => {
    stubNarrowViewport();
    renderDashboard();

    // 로그아웃·테마·언어는 화면에 그대로 있되(잃어버리지 않는다) 상단 바가 아니라
    // 내비게이션 드로어(aside) 안에 있다 — 시안의 모바일 상단 바는 워드마크·아바타·
    // 햄버거뿐이라, 여기 남겨두면 한 줄에 밀려 글자가 세로로 쪼개진다.
    const drawer = document.querySelector("#dashboard-nav");
    expect(drawer).not.toBeNull();
    expect(drawer?.contains(logoutButton())).toBe(true);

    const topbar = document.querySelector(".topbar");
    expect(topbar?.contains(logoutButton())).toBe(false);
    // 상단 바에는 아바타가 대신 선다.
    expect(topbar?.querySelector(".avatar")?.textContent).toBe("A");

    await waitFor(() => expect(api.sessions).toHaveBeenCalled());
  });

  it("넓은 폭에서는 컨트롤이 상단 바에 남는다", async () => {
    renderDashboard(); // matchMedia 없음 → 데스크톱 배치

    const topbar = document.querySelector(".topbar");
    expect(topbar?.contains(logoutButton())).toBe(true);
    expect(topbar?.querySelector(".avatar")).toBeNull();

    await waitFor(() => expect(api.sessions).toHaveBeenCalled());
  });

  // ── 로그아웃(상단 바) ──

  it("로그아웃 중에는 버튼이 잠긴다(중복 요청 방지)", () => {
    renderDashboard(() => new Promise<boolean>(() => undefined)); // 응답 없음
    fireEvent.click(logoutButton());

    expect(logoutButton().textContent).toContain("Logging out");
    expect(logoutButton().disabled).toBe(true);
  });

  // 회귀 방지: 쿠키를 못 지웠으면 세션이 살아 있다 — 조용히 성공처럼 넘어가면 안 된다.
  it("로그아웃이 실패하면 세션이 남아 있음을 알리고 재시도할 수 있다", async () => {
    renderDashboard(async () => false);
    fireEvent.click(logoutButton());

    await waitFor(() =>
      expect(screen.getByText(/still signed in/)).toBeDefined(),
    );
    expect(logoutButton().disabled).toBe(false); // 다시 시도할 수 있다
  });

  it("로그아웃이 성공하면 오류를 띄우지 않는다", async () => {
    const signOut = vi.fn(async () => true);
    renderDashboard(signOut);
    fireEvent.click(logoutButton());

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(screen.queryByText(/still signed in/)).toBeNull();
  });

  // ── 활성 세션 ──

  it("세션 종류를 라벨로 보여준다", async () => {
    renderDashboard();

    // 모델·버전·위치는 저장하지 않으므로(§5) 표시는 브랜드 한 단계에서 끝난다.
    expect(await screen.findByText("Mac")).toBeTruthy();
    expect(screen.getByText("iPhone")).toBeTruthy();
  });

  it("세션 목록을 불러와 현재/다른 세션을 구분해 보여준다", async () => {
    renderDashboard();

    // 화면에서 현재/다른 세션을 가르는 것은 배지다 — 같은 말을 부제에 또 적지 않는다.
    await waitFor(() => expect(screen.getByText("Current")).toBeDefined());
    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.getByText("#sess-cur")).toBeDefined();
    expect(screen.getByText("#sess-oth")).toBeDefined();
    // Revoke는 현재 세션이 아닌 행에만 있다(현재 세션은 상단 바 Log out으로 끊는다).
    expect(revokeButtons()).toHaveLength(1);
  });

  // 목록에 Revoke가 여럿일 수 있다 — 버튼 글자만으로는 무엇을 끊는지 알 수 없다.
  it("Revoke 버튼의 이름이 어느 세션인지 말해 준다", async () => {
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Current")).toBeDefined());
    const name = revokeButtons()[0]?.getAttribute("aria-label") ?? "";
    expect(name).toContain("Revoke");
    expect(name).toContain("iPhone"); // 기기 종류
    expect(name).toContain("Signed-in session"); // 현재 세션이 아님
    expect(name).toContain("#sess-oth");
  });

  it("세션을 Revoke하면 목록에서 사라진다", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("#sess-oth")).toBeDefined());

    fireEvent.click(revokeButtons()[0]!);

    await waitFor(() =>
      expect(vi.mocked(api.revokeSession)).toHaveBeenCalledWith("sess-other-2"),
    );
    await waitFor(() => expect(screen.queryByText("#sess-oth")).toBeNull());
  });

  // 폐기는 auth 서비스가 처리하고 socket 서비스는 그 사실을 전달받는 통로가 없다 —
  // 스윕을 기다리면 끊긴 기기가 최대 20초를 멀쩡히 앉아 있는다. 소켓이 이미 붙어
  // 있으니 우리가 깨워 준다(서버는 믿지 않고 세션 저장소를 다시 읽는다).
  it("세션을 Revoke하면 소켓으로 재검증을 청한다", async () => {
    const sent: SocketUpstreamMessage[] = [];
    renderDashboard(undefined, {
      ...socketValue(true, 0),
      send: (message) => {
        sent.push(message);
        return true;
      },
    });
    await waitFor(() => expect(screen.getByText("#sess-oth")).toBeDefined());

    fireEvent.click(revokeButtons()[0]!);

    await waitFor(() =>
      expect(sent).toContainEqual({ type: "sessionsRevoked" }),
    );
  });

  it("세션을 못 불러오면 오류와 재시도를 보여준다", async () => {
    vi.mocked(api.sessions).mockRejectedValueOnce(new Error("network"));
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(/load your sessions/)).toBeDefined(),
    );
    // 재시도하면 다시 불러온다.
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("#sess-cur")).toBeDefined());
  });

  // ── 모바일 네비 드로어 ──
  // 모바일에선 사이드바가 숨겨져 기능 이동 수단이 없었다 — 햄버거로 여는 드로어를 추가했다.

  it("햄버거로 네비 드로어를 열고 Esc로 닫는다", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("#sess-cur")).toBeDefined());

    const menu = screen.getByRole("button", { name: "Open menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".scrim")).toBeNull();

    fireEvent.click(menu);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".scrim")).not.toBeNull();
    expect(document.querySelector(".sidebar")?.className).toContain(
      "sidebar--open",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".scrim")).toBeNull();
  });

  it("스크림을 누르면 드로어가 닫힌다", async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText("#sess-cur")).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const scrim = document.querySelector(".scrim");
    expect(scrim).not.toBeNull();

    fireEvent.click(scrim as HTMLElement);
    expect(
      screen
        .getByRole("button", { name: "Open menu" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  // ── 연결 상태 배지 ──

  // 소켓이 붙어 있어야 presence를 믿는다. 그때 비로소 세 갈래가 드러난다.
  it("소켓이 붙어 있으면 연결되지 않은 세션을 Inactive로 보여준다", async () => {
    vi.mocked(api.sessions).mockResolvedValue([currentSession, otherSession]);

    renderDashboard(undefined, socketValue(true, 0));

    expect(await screen.findByText("Current")).toBeTruthy();
    expect(screen.getByText("Inactive")).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("소켓이 붙어 있으면 연결된 세션을 Active로 보여준다", async () => {
    vi.mocked(api.sessions).mockResolvedValue([
      currentSession,
      { ...otherSession, isConnected: true },
    ]);

    renderDashboard(undefined, socketValue(true, 0));

    expect(await screen.findByText("Current")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Inactive")).toBeNull();
  });

  // ⚠️ 회귀 방지: 소켓 서비스가 죽으면 presence가 통째로 비어 모든 세션이 "연결 없음"으로
  // 보인다. 그것을 그대로 그리면 멀쩡한 기기들을 전부 "비활성"이라고 **지어내게** 된다.
  // 모를 때는 이 기능 이전의 두 갈래로 물러난다.
  it("소켓이 붙어 있지 않으면 Inactive를 지어내지 않고 두 갈래로 물러난다", async () => {
    vi.mocked(api.sessions).mockResolvedValue([currentSession, otherSession]);

    renderDashboard(undefined, socketValue(false, 0));

    expect(await screen.findByText("Current")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Inactive")).toBeNull();
  });

  // 소켓은 목록을 나르지 않는다 — 신호만 주고 목록은 이 화면이 다시 가져온다.
  it("sessionsChanged 신호가 오면 목록을 다시 가져온다", async () => {
    vi.mocked(api.sessions).mockResolvedValue([currentSession, otherSession]);
    const { rerenderSocket } = renderDashboard(undefined, socketValue(true, 0));
    await screen.findByText("Current");
    expect(api.sessions).toHaveBeenCalledTimes(1);

    vi.mocked(api.sessions).mockResolvedValue([
      currentSession,
      { ...otherSession, isConnected: true },
    ]);
    rerenderSocket(socketValue(true, 1));

    expect(await screen.findByText("Active")).toBeTruthy();
    expect(api.sessions).toHaveBeenCalledTimes(2);
  });

  // 갱신은 목록을 비우지 않는다 — 다른 기기가 하나 붙었다고 카드가 "불러오는 중"으로
  // 접혔다 펴지면 목록 전체가 깜빡인다(plan/dashboard.md §4).
  it("신호로 갱신할 때 목록을 비우지 않는다", async () => {
    vi.mocked(api.sessions).mockResolvedValue([currentSession, otherSession]);
    const { rerenderSocket } = renderDashboard(undefined, socketValue(true, 0));
    await screen.findByText("Current");

    let resolve: (v: SessionListItem[]) => void = () => undefined;
    vi.mocked(api.sessions).mockReturnValue(
      new Promise<SessionListItem[]>((r) => {
        resolve = r;
      }),
    );
    rerenderSocket(socketValue(true, 1));

    // 재조회가 도는 동안에도 예전 목록이 그대로 보인다.
    expect(screen.getByText("Current")).toBeTruthy();
    resolve([currentSession, otherSession]);
  });

  describe("소켓 신호와 재조회", () => {
    // ⚠️ 회귀 방지: 소켓은 화면보다 오래 산다(앱 전역). 대시보드에 **다시** 들어왔을 때
    // 이미 지나간 신호 번호를 새 신호로 읽으면, 마운트의 전경 조회 옆에 얻는 것 없는
    // 배경 재조회가 하나 더 붙어 같은 순간의 회전을 두고 경합한다.
    it("이미 지나간 신호 번호로는 다시 가져오지 않는다", async () => {
      renderDashboard(async () => true, socketValue(true, 7));

      await waitFor(() => expect(vi.mocked(api.sessions)).toHaveBeenCalled());
      expect(vi.mocked(api.sessions)).toHaveBeenCalledTimes(1);
      // 그 한 번은 화면 진입이므로 **활동**이다(배경 표시가 없어야 서버가 유휴 창을 민다).
      expect(vi.mocked(api.sessions)).toHaveBeenCalledWith(false);
    });

    // 반대로 **새** 신호는 배경 재조회를 부른다 — 그게 이 소켓의 존재 이유다.
    it("새 신호가 오면 배경으로 다시 가져온다", async () => {
      const { rerenderSocket } = renderDashboard(async () => true, socketValue(true, 7));
      await waitFor(() => expect(vi.mocked(api.sessions)).toHaveBeenCalledTimes(1));

      rerenderSocket(socketValue(true, 8));

      await waitFor(() => expect(vi.mocked(api.sessions)).toHaveBeenCalledTimes(2));
      expect(vi.mocked(api.sessions)).toHaveBeenLastCalledWith(true);
    });
  });
});
