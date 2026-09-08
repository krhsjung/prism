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
import { I18nContext } from '../lib/i18n/i18n-context';
import { englishI18n } from '../lib/i18n/test-i18n';
import { ThemeContext } from '../lib/theme/theme-context';
import { lightTheme } from '../lib/theme/test-theme';
import type { SessionListItem, User } from '../lib/contracts.gen';

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>(
    '../lib/api',
  );
  return {
    ...actual,
    api: { sessions: vi.fn(), sendPush: vi.fn() },
  };
});
import { api, ApiError } from '../lib/api';

// 권한 상태는 브라우저에 달려 있다 — 화면이 그 갈래마다 무엇을 말하는지가 관심사다.
vi.mock('../lib/push/registration', () => ({
  currentPermission: vi.fn(() => 'granted'),
  requestPermissionAndToken: vi.fn(),
}));
import {
  currentPermission,
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

function renderPush(sessions: SessionListItem[] = [registered, unregistered]) {
  vi.mocked(api.sessions).mockResolvedValue(sessions);
  const auth: AuthContextValue = {
    state: { status: 'authenticated', user },
    endedUnexpectedly: false,
    signIn: vi.fn(),
    refresh: vi.fn(async () => true),
    signOut: vi.fn(async () => true),
  };
  const socket: SessionSocketValue = {
    ready: true,
    changed: 0,
    send: () => false,
    subscribeCall: () => () => {},
  };
  render(
    <MemoryRouter initialEntries={['/push']}>
      <I18nContext.Provider value={englishI18n()}>
        <ThemeContext.Provider value={lightTheme()}>
          <AuthContext.Provider value={auth}>
            <SessionSocketContext.Provider value={socket}>
              <PushPage />
            </SessionSocketContext.Provider>
          </AuthContext.Provider>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    </MemoryRouter>,
  );
}

// 여럿 고를 수 있다는 것을 컨트롤의 모양이 먼저 말한다 — 버튼이 아니라 체크박스다.
const checkboxes = () => screen.queryAllByRole<HTMLInputElement>('checkbox');
const sendButton = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: 'Send' });
const messageBox = () => screen.getByLabelText<HTMLTextAreaElement>('Message');

beforeEach(() => {
  vi.mocked(currentPermission).mockReturnValue('granted');
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

  // 이미지·링크·버튼은 **셋 다 선택이다** — 없으면 문구만 있는 알림이다.
  it('이미지·링크·버튼을 함께 보낸다', async () => {
    renderPush();
    await waitFor(() => expect(checkboxes()).toHaveLength(1));
    fireEvent.click(checkboxes()[0]!);
    fireEvent.change(messageBox(), { target: { value: 'hi' } });
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
        imageUrl: 'https://cdn.example/a.png',
        link: 'https://example.com/x',
        actions: 'open-dismiss',
      }),
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

  it('전송이 실패하면 오류 한 줄을 보여 준다', async () => {
    vi.mocked(api.sendPush).mockRejectedValue(new ApiError(502, 'UNAUTHORIZED'));
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

  // 토큰은 로그인 시점에만 세션에 실린다 — 늦게 준 권한과 회전된 토큰이 여기서 드러난다.
  // 보낸 토큰이 남아 있는지로 가르지 않는다 — 이 화면에서 처음 허용한 사람은 로그인에
  // 토큰을 실어 본 적이 없어서, 그것으로 가르면 켜기 줄만 사라지고 아무 설명도 안 뜬다.
  it('권한은 켜졌는데 이 세션이 등록 전이면 다시 로그인하라고 말한다', async () => {
    renderPush([{ ...registered, pushRegistered: false }, unregistered]);

    await waitFor(() =>
      expect(screen.getByText(/Sign in again to turn them on/)).toBeTruthy(),
    );
  });
});
