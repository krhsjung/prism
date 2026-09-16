import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PushPage } from './PushPage';
import { AuthContext, type AuthContextValue } from '../lib/auth-context';
import {
  SessionSocketContext,
  type SessionSocketValue,
} from '../lib/session-socket-context';
import { SessionsProvider } from '../lib/SessionsProvider';
import { PushRegistrationProvider } from '../lib/push/PushRegistrationProvider';
import { I18nContext } from '../lib/i18n/i18n-context';
import { englishI18n } from '../lib/i18n/test-i18n';
import { ThemeContext } from '../lib/theme/theme-context';
import { lightTheme } from '../lib/theme/test-theme';
import type {
  SessionListItem,
  SocketUpstreamMessage,
  User,
} from '../lib/contracts.gen';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>(
    '../lib/api',
  );
  return {
    ...actual,
    // 여기만 부분이면 같은 구멍이 남는다 — 완전한 가짜 위에 덮는다(lib/test-api.ts).
    api: (await import('../lib/test-api')).fakeApi(),
  };
});
import { api, ApiError } from '../lib/api';

// 권한 상태는 브라우저에 달려 있다 — 화면이 그 갈래마다 무엇을 말하는지가 관심사다.
// ⚠️ **원본을 펼친 위에 덮어쓴다.** 팩토리로 모듈을 통째로 대체하면, 대상이 나중에
// 새 export를 쓰기 시작했을 때 그 값이 조용히 `undefined`가 된다 — 화면의 catch가 삼키면
// 몇 달을 지나가고(`rememberPushWanted`가 그랬다), 안 삼키면 렌더가 터진다
// (`pushSupported`가 그랬다). 펼쳐 두면 덮어쓰지 않은 것은 진짜가 남고,
// `satisfies`가 덮어쓴 것의 **시그니처까지** 검사한다.
vi.mock('../lib/push/registration', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/push/registration')>(
      '../lib/push/registration',
    );
  return {
    ...actual,
    currentPermission: vi.fn<typeof actual.currentPermission>(() => 'granted'),
    requestPermissionAndToken: vi.fn(),
    pushSupported: vi.fn(async () => true),
    rememberPushWanted: vi.fn(),
  } satisfies typeof actual;
});
import {
  currentPermission,
  pushSupported,
  rememberPushWanted,
  requestPermissionAndToken,
} from '../lib/push/registration';

const user: User = {
  id: 'u-1',
  provider: 'demo',
  displayName: 'Demo User',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const registered: SessionListItem = {
  id: 'sess-registered-1',
  startedAt: '2026-01-01T09:00:00.000Z',
  expiresAt: '2026-01-01T17:00:00.000Z',
  isCurrent: true,
  isConnected: true,
  pushRegistered: true,
  device: 'mac',
};

// 권한을 안 준 기기. **누를 수 없는 버튼을 두지 않는다** — 배지가 이유를 말한다.
const unregistered: SessionListItem = {
  ...registered,
  id: 'sess-plain-2',
  isCurrent: false,
  pushRegistered: false,
  device: 'iphone',
};

function renderPush(
  sessions: SessionListItem[] = [registered, unregistered],
  // 소켓으로 나간 메시지를 받아 둘 곳 — 알림을 껐다 켜면 다른 기기에도 알려야 한다.
  sent: SocketUpstreamMessage[] = [],
) {
  vi.mocked(api.sessions).mockResolvedValue(sessions);
  const auth: AuthContextValue = {
    state: { status: 'authenticated', user },
    endedUnexpectedly: false,
    signIn: vi.fn(),
    refresh: vi.fn(async () => true),
    signOut: vi.fn(async () => true),
  };
  const socketValue = (changed: number): SessionSocketValue => ({
    ready: true,
    changed,
    send: (message) => {
      sent.push(message);
      return true;
    },
    subscribeCall: () => () => {},
  });
  const tree = (value: SessionSocketValue) => (
    <MemoryRouter initialEntries={['/push']}>
      <I18nContext.Provider value={englishI18n()}>
        <ThemeContext.Provider value={lightTheme()}>
          <AuthContext.Provider value={auth}>
            <SessionSocketContext.Provider value={value}>
              {/* 목록을 쥐는 자리는 **진짜 Provider**다 — 이 화면은 이제 목록을
                  직접 부르지 않고 거기서 받아 쓴다(lib/SessionsProvider.tsx). */}
              <SessionsProvider>
                {/* 등록의 수명도 **진짜 Provider**가 쥔다 — 권한 재확인·되살리기·해제는
                    화면이 아니라 그쪽의 일이다(lib/push/PushRegistrationProvider.tsx). */}
                <PushRegistrationProvider>
                  <PushPage />
                </PushRegistrationProvider>
              </SessionsProvider>
            </SessionSocketContext.Provider>
          </AuthContext.Provider>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    </MemoryRouter>
  );
  const { rerender } = render(tree(socketValue(0)));
  return {
    // 다른 기기가 목록을 바꿨다 — 서버가 내려줄 값을 갈아 끼우고 소켓 신호를 한 칸 올린다.
    signalChange: (next: SessionListItem[]) => {
      vi.mocked(api.sessions).mockResolvedValue(next);
      rerender(tree(socketValue(1)));
    },
  };
}

// 여럿 고를 수 있다는 것을 컨트롤의 모양이 먼저 말한다 — 버튼이 아니라 체크박스다.
const checkboxes = () => screen.queryAllByRole<HTMLInputElement>('checkbox');
const sendButton = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: 'Send' });
const messageBox = () => screen.getByLabelText<HTMLTextAreaElement>('Message');

beforeEach(() => {
  vi.mocked(currentPermission).mockReturnValue('granted');
  vi.mocked(pushSupported).mockResolvedValue(true);
  // 서버가 "붙였다"고 답하는 것이 기본값이다 — 화면은 이제 그 값을 보고 갈린다.
  // 타입만으로는 이것이 채워지지 않는다(가짜는 모양만 맞고 행동은 비어 있다).
  vi.mocked(api.registerPush).mockResolvedValue({ registered: true });
  vi.mocked(api.sendPush).mockResolvedValue({
    results: [{ sessionId: 'sess-registered-1', result: 'accepted' }],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PushPage', () => {
  // 등록되지 않은 줄은 **버튼을 잃는다.** 회색 버튼을 남기면 눌러 볼 수 있는 것처럼
  // 보이고, 아무 일도 없는 이유를 알 수 없다(plan/push.md §4).
  it('등록된 기기만 고를 수 있고 나머지는 이유를 보여 준다', async () => {
    renderPush();

    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    expect(screen.getByText('Notifications off')).toBeTruthy();
  });

  // **여럿 고를 수 있다**(§5-10). 같은 설치가 여러 세션에 걸리면 서버가 합쳐 보낸다.
  it('여러 대상을 함께 고르고 한 요청으로 보낸다', async () => {
    renderPush([
      registered,
      { ...registered, id: 'sess-registered-2', isCurrent: false, device: 'iphone' },
    ]);
    await waitFor(() => expect(checkboxes()).toHaveLength(2));

    fireEvent.click(checkboxes()[0]!);
    fireEvent.click(checkboxes()[1]!);
    fireEvent.change(messageBox(), { target: { value: 'hi' } });
    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(api.sendPush).toHaveBeenCalledWith({
        sessionIds: ['sess-registered-1', 'sess-registered-2'],
        message: 'hi',
        actions: 'none',
      }),
    );
  });

  // 보이지 않는 옛 선택이 상한을 차지하면 남은 기기를 고를 수 없다 — 고치는 순간에 걷어낸다.
  it('상한까지 고른 기기들이 사라진 뒤에도 남은 기기를 고를 수 있다', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...registered,
      id: `sess-${i}`,
      isCurrent: i === 0,
    }));
    const { signalChange } = renderPush(many);
    await waitFor(() => expect(checkboxes()).toHaveLength(20));
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(checkboxes().every((box) => box.checked)).toBe(true);

    const survivor = { ...registered, id: 'sess-new', isCurrent: true };
    signalChange([survivor]);
    await waitFor(() => expect(checkboxes()).toHaveLength(1));

    fireEvent.click(checkboxes()[0]!);

    expect(checkboxes()[0]!.checked).toBe(true);
  });

  // 등록 기기가 상한보다 많으면 "모두"는 상한까지다 — 전체 수와 견주면 버튼이 영영 "모두
  // 선택"으로 남아 해제할 길이 없다.
  it('상한보다 많이 등록돼 있어도 모두 선택은 상한까지 고르고 해제로 바뀐다', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      ...registered,
      id: `sess-${i}`,
      isCurrent: i === 0,
    }));
    renderPush(many);
    await waitFor(() => expect(checkboxes()).toHaveLength(21));

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(checkboxes().filter((box) => box.checked)).toHaveLength(20);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(checkboxes().filter((box) => box.checked)).toHaveLength(0);
  });

  it('모두 선택과 해제가 한 번에 바꾼다', async () => {
    renderPush([
      registered,
      { ...registered, id: 'sess-registered-2', isCurrent: false, device: 'iphone' },
    ]);
    await waitFor(() => expect(checkboxes()).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(checkboxes().every((box) => box.checked)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(checkboxes().some((box) => box.checked)).toBe(false);
  });

  // 결과는 **고른 줄 옆에** 그린다 — 목록 밖에서 다시 짝지어 읽게 하지 않는다.
  it('대상마다 결과를 그 줄에 그린다', async () => {
    vi.mocked(api.sendPush).mockResolvedValue({
      results: [
        { sessionId: 'sess-registered-1', result: 'accepted' },
        { sessionId: 'sess-registered-2', result: 'duplicate' },
      ],
    });
    renderPush([
      registered,
      { ...registered, id: 'sess-registered-2', isCurrent: false, device: 'iphone' },
    ]);
    await waitFor(() => expect(checkboxes()).toHaveLength(2));
    fireEvent.click(checkboxes()[0]!);
    fireEvent.change(messageBox(), { target: { value: 'hi' } });

    fireEvent.click(sendButton());

    await waitFor(() => expect(screen.getByText(/^Sent\./)).toBeTruthy());
    expect(screen.getByText(/Same device as another line/)).toBeTruthy();
  });

  // FCM의 일시적 실패는 **그 줄의** 결과다 — 요청 전체가 접히면 이미 접수된 나머지의
  // 결과를 화면이 잃는다. 실패로 읽히되(다시 눌러 보면 된다) 다른 줄은 그대로다.
  it('한 대상만 지금 못 보냈으면 그 줄만 실패로 그린다', async () => {
    vi.mocked(api.sendPush).mockResolvedValue({
      results: [
        { sessionId: 'sess-registered-1', result: 'accepted' },
        { sessionId: 'sess-registered-2', result: 'failed' },
      ],
    });
    renderPush([
      registered,
      { ...registered, id: 'sess-registered-2', isCurrent: false, device: 'iphone' },
    ]);
    await waitFor(() => expect(checkboxes()).toHaveLength(2));
    fireEvent.click(checkboxes()[0]!);
    fireEvent.change(messageBox(), { target: { value: 'hi' } });

    fireEvent.click(sendButton());

    await waitFor(() => expect(screen.getByText(/^Sent\./)).toBeTruthy());
    expect(screen.getByText(/Couldn't reach Firebase/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // 거부된 토큰은 서버가 그 세션에서 뗀다 — 그 줄은 이제 `Notifications off`이고, 다른
  // 기기의 목록·로비도 그것을 알아야 한다(스윕은 이 변화를 못 잡는다).
  it('토큰이 거부된 줄이 있으면 목록을 다시 받고 다른 기기에도 알린다', async () => {
    vi.mocked(api.sendPush).mockResolvedValue({
      results: [{ sessionId: 'sess-registered-2', result: 'rejected' }],
    });
    const sent: SocketUpstreamMessage[] = [];
    renderPush(
      [
        registered,
        { ...registered, id: 'sess-registered-2', isCurrent: false, device: 'iphone' },
      ],
      sent,
    );
    await waitFor(() => expect(checkboxes()).toHaveLength(2));
    fireEvent.click(checkboxes()[1]!);
    fireEvent.change(messageBox(), { target: { value: 'hi' } });
    vi.mocked(api.sessions).mockResolvedValue([
      registered,
      { ...registered, id: 'sess-registered-2', isCurrent: false, pushRegistered: false },
    ]);

    fireEvent.click(sendButton());

    await waitFor(() => expect(sent).toContainEqual({ type: 'sessionsStale' }));
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
  });

  // 이미지·링크·버튼은 **셋 다 선택이다** — 없으면 문구만 있는 알림이다.
  it('이미지·링크·버튼을 함께 보낸다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.click(checkboxes()[0]!);
    fireEvent.change(messageBox(), { target: { value: 'hi' } });
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Deploy done' },
    });
    fireEvent.change(screen.getByLabelText('Image'), {
      target: { value: 'https://cdn.example/a.png' },
    });
    fireEvent.change(screen.getByLabelText('Link'), {
      target: { value: 'https://example.com/x' },
    });
    // 조합은 드롭다운이 아니라 눈에 보이는 세 선택지다(plan/push.md §4).
    fireEvent.click(screen.getByRole('button', { name: 'Open and Dismiss' }));

    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(api.sendPush).toHaveBeenCalledWith({
        sessionIds: ['sess-registered-1'],
        message: 'hi',
        title: 'Deploy done',
        imageUrl: 'https://cdn.example/a.png',
        link: 'https://example.com/x',
        actions: 'open-dismiss',
      }),
    );
  });

  // 비우면 서버가 받는 기기의 언어로 그린다 — 빈 문자열을 실어 보내면 그 말이 거짓이 된다.
  it('제목을 비우면 요청에 싣지 않는다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.click(checkboxes()[0]!);
    fireEvent.change(messageBox(), { target: { value: 'hi' } });

    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(api.sendPush).toHaveBeenCalledWith(
        expect.not.objectContaining({ title: expect.anything() }),
      ),
    );
  });

  // 샘플은 이 사이트가 서빙한다 — 리뷰어가 주소를 구해 오지 않아도 시연할 수 있게.
  it('샘플을 누르면 이 사이트의 절대 주소가 채워진다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));

    fireEvent.click(screen.getByLabelText('/push-samples/deep.png'));

    expect(screen.getByLabelText<HTMLInputElement>('Image').value).toContain(
      '/push-samples/deep.png',
    );
  });

  // 현재 세션도 대상이다 — 기기 두 대를 준비하지 못한 리뷰어가 자기 자신에게 보내
  // 알림이 실제로 뜨는 것을 확인할 수 있어야 한다(통화의 루프백과 같은 자리).
  it('현재 세션에도 보낼 수 있다', async () => {
    renderPush([registered]);

    await waitFor(() => expect(checkboxes()).toHaveLength(1));
  });

  it('대상과 문구가 다 있어야 보낼 수 있다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));

    expect(sendButton().disabled).toBe(true);

    fireEvent.click(checkboxes()[0]!);
    expect(sendButton().disabled).toBe(true);

    fireEvent.change(messageBox(), { target: { value: 'hello' } });
    expect(sendButton().disabled).toBe(false);
  });

  // 문구만 있고 **고른 기기가 없으면** 보낼 곳이 없다. 서버도 같은 판단을 한다
  // (`decodePushRequest`가 빈 `sessionIds`를 400으로 접는다) — 화면이 먼저 막아
  // 왕복을 아낀다. 고르기를 물렀을 때도 그대로 돌아가야 한다.
  it('고른 기기가 없으면 문구가 있어도 보낼 수 없다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));

    fireEvent.change(messageBox(), { target: { value: 'hello' } });
    expect(sendButton().disabled).toBe(true);

    fireEvent.click(checkboxes()[0]!);
    expect(sendButton().disabled).toBe(false);

    fireEvent.click(checkboxes()[0]!);
    expect(sendButton().disabled).toBe(true);
  });

  // 공백만 적은 것은 문구가 아니다 — 서버도 같은 판단을 한다(400).
  it('공백만 적으면 보내지 않는다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.click(checkboxes()[0]!);

    fireEvent.change(messageBox(), { target: { value: '   ' } });

    expect(sendButton().disabled).toBe(true);
  });

  it('토큰이 아니라 세션 id와 문구만 보낸다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.click(checkboxes()[0]!);
    fireEvent.change(messageBox(), { target: { value: '  hello  ' } });

    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(api.sendPush).toHaveBeenCalledWith({
        sessionIds: ['sess-registered-1'],
        message: 'hello',
        actions: 'none',
      }),
    );
  });

  // 요청 전체가 실패하는 것은 형식(400)과 전송기가 없는 배포(502 PUSH_UNAVAILABLE)뿐이다.
  it('전송이 실패하면 오류 한 줄을 보여 준다', async () => {
    vi.mocked(api.sendPush).mockRejectedValue(
      new ApiError(502, 'PUSH_UNAVAILABLE'),
    );
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.click(checkboxes()[0]!);
    fireEvent.change(messageBox(), { target: { value: 'hi' } });

    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBeTruthy(),
    );
  });

  // 진입만으로 권한을 묻지 않는다 — 명시적 제스처 뒤에만 연다(plan/webrtc.md §7).
  it('아직 안 물었으면 누를 수 있는 줄을 보여 주고 진입만으로 묻지 않는다', async () => {
    vi.mocked(currentPermission).mockReturnValue('default');
    renderPush();

    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    expect(requestPermissionAndToken).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Turn on notifications' }),
    );
    await waitFor(() => expect(requestPermissionAndToken).toHaveBeenCalled());
  });

  it('막혀 있으면 설정으로 안내한다', async () => {
    vi.mocked(currentPermission).mockReturnValue('denied');
    renderPush();

    await waitFor(() =>
      expect(screen.getByText(/Notifications are blocked/)).toBeTruthy(),
    );
  });

  // 켜져 있으면 **끄는 길**이 같은 자리에 선다. 끄는 것은 등록이지 권한이 아니다(§5-15).
  it('이 세션이 등록돼 있으면 끄기를 내놓는다', async () => {
    renderPush();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Turn off notifications' }),
      ).toBeTruthy(),
    );
  });

  it('끄기를 누르면 등록을 떼고 목록을 다시 부른다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));

    // 서버가 다음 조회에서 내려줄 값 — 끈 결과가 목록에 반영된 모습이다.
    vi.mocked(api.sessions).mockResolvedValue([
      { ...registered, pushRegistered: false },
      unregistered,
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: 'Turn off notifications' }),
    );

    await waitFor(() => expect(api.unregisterPush).toHaveBeenCalled());
    // **호출만으로는 부족하다** — 이 테스트가 약속하는 것은 "목록을 다시 부른다"이고,
    // 그 결말은 화면이 바뀌는 것이다. 끈 줄은 더 이상 고를 수 없어야 한다.
    await waitFor(() => expect(checkboxes()).toHaveLength(0));
  });

  // 서버는 그사이 세션이 사라졌으면 **던지지 않고** `registered: false`를 돌려준다.
  // 그것을 성공으로 읽으면 선택을 기억하고 남까지 깨운다 — 안 일어난 일을 알리는 셈이다.
  it('서버가 붙이지 못했다고 답하면 선택도 기억하지 않는다', async () => {
    vi.mocked(api.registerPush).mockResolvedValue({ registered: false });
    vi.mocked(requestPermissionAndToken).mockResolvedValue('fcm-tok-9');
    const sent: SocketUpstreamMessage[] = [];
    renderPush([{ ...registered, pushRegistered: false }, unregistered], sent);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Turn on notifications' }),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Turn on notifications' }));

    await waitFor(() => expect(api.registerPush).toHaveBeenCalled());
    // 선택은 붙이기 전에 남겼다가 붙이지 못하면 되돌린다 — **켜진 채로 남지 않는다.**
    await waitFor(() =>
      expect(vi.mocked(rememberPushWanted).mock.calls.at(-1)).toEqual([false]),
    );
    expect(sent).toEqual([]);
  });

  // 사람은 이 화면 밖(브라우저·OS 설정)에서 권한을 끌 수 있다. 진입할 때 한 번만
  // 읽으면 화면은 계속 "받는다"고 말하고, 다른 기기의 로비는 이 기기를 깨울 수 있다고
  // 그린다 — 없는 사실을 지어내지 않는다는 §5-17의 규칙이 그 자리에서 깨진다.
  it('탭으로 돌아오면 권한을 다시 읽는다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));

    vi.mocked(currentPermission).mockReturnValue('denied');
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() =>
      expect(screen.getByText(/Notifications are blocked\./)).toBeTruthy(),
    );
  });

  // 알림·서비스워커 API는 있는데 FCM이 거절하는 브라우저가 있다. 그때 권한만 보면
  // `default`/`granted`로 분류돼 **켜기 버튼이 서고 눌러도 아무 일이 없다** — 이 화면이
  // 없애려던 막다른 길이다(§5-19).
  it('FCM이 지원하지 않는 브라우저는 unsupported로 접는다', async () => {
    vi.mocked(pushSupported).mockResolvedValue(false);
    vi.mocked(currentPermission).mockReturnValue('default');

    renderPush();

    await waitFor(() =>
      expect(screen.getByText(/Notifications aren't available here\./)).toBeTruthy(),
    );
    expect(
      screen.queryByRole('button', { name: 'Turn on notifications' }),
    ).toBeNull();
  });

  // 권한을 꺼도 세션 레코드의 토큰은 남아 `pushRegistered`가 true다 — 그러면 안내는
  // "차단돼 있습니다"인데 내 줄은 고를 수 있는 대상이고, 남의 로비는 울리지 않을 기기를
  // `Will notify`로 그린다. 받을 수 없다는 것을 아는 쪽은 이 기기뿐이고, **스윕은 이
  // 변화를 못 잡으므로**(세션 id 목록만 대조한다) 알리지 않으면 영영 낡은 채로 남는다.
  it('권한이 사라지면 등록을 떼어 내고 다른 기기에도 알린다', async () => {
    const sent: SocketUpstreamMessage[] = [];
    renderPush([registered, unregistered], sent);
    await waitFor(() => expect(checkboxes()).toHaveLength(1));

    vi.mocked(currentPermission).mockReturnValue('denied');
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(api.unregisterPush).toHaveBeenCalled());
    expect(sent).toContainEqual({ type: 'sessionsStale' });
  });

  // 사람이 끈 것이 아니라 받을 수 없게 된 것이다 — 권한이 돌아오면 그대로 살아나야 한다.
  it('권한이 사라져도 기기에 남긴 선택은 건드리지 않는다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));

    vi.mocked(currentPermission).mockReturnValue('denied');
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(api.unregisterPush).toHaveBeenCalled());
    expect(rememberPushWanted).not.toHaveBeenCalled();
  });

  // 끄는 것은 등록이지 권한이 아니다(§5-15). 권한이 막혔다고 끄기를 가리면, 서버는
  // 이 기기를 계속 푸시 대상으로 들고 있는데 그것을 지울 길이 화면에서 사라진다.
  it('권한이 막혀 있어도 등록돼 있으면 끄기가 남는다', async () => {
    vi.mocked(currentPermission).mockReturnValue('denied');
    renderPush();

    await waitFor(() =>
      expect(screen.getByText(/Notifications are blocked\./)).toBeTruthy(),
    );
    expect(
      screen.getByRole('button', { name: 'Turn off notifications' }),
    ).toBeTruthy();
  });

  // 체크박스는 사라지는데 전송 목록에는 남으면, 보이는 선택과 보내는 선택이 어긋난다 —
  // 고른 것이 그것 하나뿐이면 줄에서 끌 방법도 없다.
  it('고른 기기가 알림을 끄면 대상에서 빠진다', async () => {
    const { signalChange } = renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.click(checkboxes()[0]!);
    fireEvent.change(messageBox(), { target: { value: 'hello' } });
    expect(sendButton().disabled).toBe(false);

    signalChange([
      { ...registered, pushRegistered: false },
      unregistered,
    ]);

    await waitFor(() => expect(sendButton().disabled).toBe(true));
  });

  // 내 줄의 `pushRegistered`는 **남의 목록에도 있다**(대시보드·통화 로비). 알리지
  // 않으면 상대가 "이 기기는 알림으로 깨울 수 있다"는 낡은 값을 계속 그린다 — 끄는
  // 쪽에서는 그 값이 거짓이고, **스윕이 메워 주지도 않는다**(세션 id 목록만 대조한다).
  it('끄면 다른 기기에도 알린다', async () => {
    const sent: SocketUpstreamMessage[] = [];
    renderPush([registered, unregistered], sent);
    await waitFor(() => expect(checkboxes()).toHaveLength(1));

    fireEvent.click(
      screen.getByRole('button', { name: 'Turn off notifications' }),
    );

    await waitFor(() =>
      expect(sent).toContainEqual({ type: 'sessionsStale' }),
    );
  });

  it('켜면 다른 기기에도 알린다', async () => {
    vi.mocked(requestPermissionAndToken).mockResolvedValue('fcm-tok-9');
    const sent: SocketUpstreamMessage[] = [];
    renderPush([{ ...registered, pushRegistered: false }, unregistered], sent);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Turn on notifications' }),
      ).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Turn on notifications' }),
    );

    await waitFor(() =>
      expect(sent).toContainEqual({ type: 'sessionsStale' }),
    );
  });

  // 권한은 켜졌는데 이 세션이 등록 전이면, **여기서 바로 켤 수 있다**(§5-2를 뒤집었다).
  // 예전에는 재로그인 말고 길이 없어 안내만 띄웠다.
  it('권한은 켜졌는데 등록 전이면 켜기 버튼을 다시 내놓는다', async () => {
    renderPush([{ ...registered, pushRegistered: false }, unregistered]);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Turn on notifications' }),
      ).toBeTruthy(),
    );
  });

  it('켜기를 누르면 지금 세션에 토큰을 붙이고 목록을 다시 부른다', async () => {
    vi.mocked(requestPermissionAndToken).mockResolvedValue('fcm-tok-9');
    renderPush([{ ...registered, pushRegistered: false }, unregistered]);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Turn on notifications' }),
      ).toBeTruthy(),
    );
    // 붙인 뒤 서버가 내려줄 값 — 이 세션이 대상이 된 모습이다.
    vi.mocked(api.sessions).mockResolvedValue([registered, unregistered]);

    fireEvent.click(screen.getByRole('button', { name: 'Turn on notifications' }));

    await waitFor(() =>
      expect(api.registerPush).toHaveBeenCalledWith('fcm-tok-9'),
    );
    // 목록을 다시 받아 왔으면 켜기 안내가 사라지고 그 줄을 고를 수 있어야 한다.
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    expect(
      screen.queryByRole('button', { name: 'Turn on notifications' }),
    ).toBeNull();
  });
});
