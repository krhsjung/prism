import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Firebase는 이 테스트의 관심사가 아니다 — 워커·토큰 API를 통째로 가짜로 둔다.
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(async () => 'fcm-tok'),
  deleteToken: vi.fn(async () => true),
  isSupported: vi.fn(async () => true),
}));
import { deleteToken, getToken, isSupported } from 'firebase/messaging';
import {
  disablePending,
  ensureOwner,
  pushWanted,
  rememberDisablePending,
  rememberPushWanted,
  requestPermissionAndToken,
  rotationPending,
  syncWorkerLocale,
  beginIntent,
  intentIs,
  settleIntent,
} from './registration';

const CONFIG = {
  VITE_FIREBASE_API_KEY: 'k',
  VITE_FIREBASE_PROJECT_ID: 'p',
  VITE_FIREBASE_MESSAGING_SENDER_ID: 's',
  VITE_FIREBASE_APP_ID: 'a',
  VITE_FIREBASE_VAPID_KEY: 'v',
};

describe('push preference', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('저장한 선택을 읽는다', () => {
    rememberPushWanted(true);
    expect(pushWanted()).toBe(true);
    rememberPushWanted(false);
    expect(pushWanted()).toBe(false);
  });

  // 저장을 못 한 선택을 저장소의 옛 값으로 읽으면 켜기가 붙인 직후 코디네이터가 방금
  // 붙인 것을 뗀다 — 켜기가 스스로를 되돌리는 셈이다.
  it('저장이 막히면 마지막 선택이 저장소의 옛 값을 이긴다', () => {
    localStorage.setItem('prism.push.enabled', '0');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    rememberPushWanted(true);

    expect(pushWanted()).toBe(true);
  });

  it('다시 저장에 성공하면 저장소가 답한다', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    rememberPushWanted(true);
    setItem.mockRestore();

    rememberPushWanted(false);

    expect(pushWanted()).toBe(false);
  });
});

describe('push owner', () => {
  beforeEach(() => {
    Object.assign(import.meta.env, CONFIG);
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: async () => 'granted',
      },
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: async () => ({}), ready: Promise.resolve({}) },
    });
  });
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    for (const key of Object.keys(CONFIG)) delete import.meta.env[key];
  });

  it('처음 온 사람은 돌리지 않고 주인이 된다', async () => {
    await expect(ensureOwner('u-1')).resolves.toBe(true);

    expect(deleteToken).not.toHaveBeenCalled();
    expect(localStorage.getItem('prism.push.owner')).toBe('u-1');
  });

  it('같은 사람이면 돌리지 않는다', async () => {
    await ensureOwner('u-1');

    await ensureOwner('u-1');

    expect(deleteToken).not.toHaveBeenCalled();
  });

  // 앞 사람의 세션이 확인되지 않은 채 다른 계정이 들어왔다 — 앞 세션의 토큰은 이 브라우저를
  // 가리킨다. 돌려서 죽은 값으로 만든다. **우리 워커를 묶은 뒤에** 버린다.
  it('다른 사람이 오면 우리 워커로 토큰을 돌린 뒤 주인을 바꾼다', async () => {
    await ensureOwner('u-1');

    await expect(ensureOwner('u-2')).resolves.toBe(true);

    expect(getToken).toHaveBeenCalled();
    expect(deleteToken).toHaveBeenCalled();
    expect(localStorage.getItem('prism.push.owner')).toBe('u-2');
    expect(rotationPending()).toBe(false);
  });

  // 돌리지 못했으면 주인을 바꾸지 않는다 — 바꿔 두면 다음 로그인이 "같은 사람"으로 읽어 다시
  // 돌리지 않는다. 보류로 남기고, 토큰을 받는 자리가 먼저 다시 돌린다.
  // 저장소 쓰기가 막힌 브라우저 — 표식을 썼다가 되읽으면 "보류 없음"이 되어 앞 사람의 토큰을
  // 그대로 새 사람에게 붙인다. 판단은 어긋남 자체로 한다.
  it('저장이 막혀도 다른 사람이 오면 돌린다', async () => {
    localStorage.setItem('prism.push.owner', 'u-1');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.mocked(deleteToken).mockRejectedValueOnce(new Error('offline'));

    await expect(ensureOwner('u-2')).resolves.toBe(false);
    expect(rotationPending()).toBe(true);
    await expect(requestPermissionAndToken()).resolves.toBe('fcm-tok');
    expect(deleteToken).toHaveBeenCalledTimes(2);
  });

  // 저장소 쓰기가 막힌 브라우저 — 돌린 뒤 적은 주인이 저장소에 남지 않는다. 앞 사람이
  // 돌아왔을 때 저장소의 옛 값("같은 사람")만 보면 돌리지 않고 뒷사람의 토큰을 그대로 붙인다.
  // 이 페이지가 적은 주인은 기억이 답한다.
  it('저장이 막혀 주인을 남기지 못해도 돌아온 앞 사람에게 돌린다', async () => {
    localStorage.setItem('prism.push.owner', 'u-1');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    await expect(ensureOwner('u-2')).resolves.toBe(true);
    expect(deleteToken).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('prism.push.owner')).toBe('u-1');

    await expect(ensureOwner('u-1')).resolves.toBe(true);
    expect(deleteToken).toHaveBeenCalledTimes(2);

    // 저장소가 돌아오면 기억은 비운다 — 저장소가 답한다.
    setItem.mockRestore();
    await ensureOwner('u-1');
    expect(deleteToken).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('prism.push.owner')).toBe('u-1');
  });

  // SDK의 지원 확인(IndexedDB 열기)이 잠깐 실패했다 — 그것을 "돌렸다"로 읽으면 앞 사람의 토큰이
  // 산 채로 남고 주인만 바뀐다. 보류로 남기고, 지원이 돌아오면 그때 돌린다.
  it('지원 확인이 잠깐 실패하면 돌린 것으로 치지 않는다', async () => {
    await ensureOwner('u-1');
    vi.mocked(isSupported).mockResolvedValueOnce(false);

    await expect(ensureOwner('u-2')).resolves.toBe(false);
    expect(deleteToken).not.toHaveBeenCalled();
    expect(rotationPending()).toBe(true);
    expect(localStorage.getItem('prism.push.owner')).toBe('u-1');

    await expect(requestPermissionAndToken()).resolves.toBe('fcm-tok');
    expect(deleteToken).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('prism.push.owner')).toBe('u-2');
  });

  // 돌리기는 토큰을 한 번 만들어야 해서 권한이 없으면 SDK가 권한 창을 스스로 띄운다 —
  // 진입만으로 묻지 않는다. 권한이 없으면 미루고, 켜기가 권한을 받은 뒤에 돌린다.
  it('권한이 없으면 돌리기를 미루고 권한을 받은 뒤에 돌린다', async () => {
    await ensureOwner('u-1');
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission: async () => {
          Object.defineProperty(globalThis, 'Notification', {
            configurable: true,
            value: {
              permission: 'granted',
              requestPermission: async () => 'granted',
            },
          });
          return 'granted';
        },
      },
    });

    await expect(ensureOwner('u-2')).resolves.toBe(false);
    expect(deleteToken).not.toHaveBeenCalled();
    expect(rotationPending()).toBe(true);

    await expect(requestPermissionAndToken()).resolves.toBe('fcm-tok');
    expect(deleteToken).toHaveBeenCalledTimes(1);
    expect(rotationPending()).toBe(false);
  });

  // 미뤄진 돌리기가 나중에 끝났는데 주인이 앞 사람으로 남으면, 그 사람이 돌아왔을 때 "같은
  // 사람"으로 읽어 돌리지 않고 뒷사람의 토큰을 그대로 붙인다 — 돌린 뒤 주인이 바뀌어야 한다.
  it('미뤄진 돌리기가 끝나면 그때 주인이 바뀐다', async () => {
    await ensureOwner('u-1');
    const granted = {
      permission: 'granted',
      requestPermission: async () => 'granted',
    };
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission: async () => {
          Object.defineProperty(globalThis, 'Notification', {
            configurable: true,
            value: granted,
          });
          return 'granted';
        },
      },
    });
    await expect(ensureOwner('u-2')).resolves.toBe(false);

    await expect(requestPermissionAndToken()).resolves.toBe('fcm-tok');

    expect(localStorage.getItem('prism.push.owner')).toBe('u-2');
    // u-1이 돌아오면 다시 돌린다 — u-2의 토큰을 그대로 쓰지 않는다.
    await expect(ensureOwner('u-1')).resolves.toBe(true);
    expect(deleteToken).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('prism.push.owner')).toBe('u-1');
  });

  it('돌리지 못하면 보류로 남고 새 토큰을 받지 않는다', async () => {
    await ensureOwner('u-1');
    vi.mocked(deleteToken).mockRejectedValueOnce(new Error('offline'));

    await expect(ensureOwner('u-2')).resolves.toBe(false);

    expect(rotationPending()).toBe(true);
    expect(localStorage.getItem('prism.push.owner')).toBe('u-1');

    vi.mocked(deleteToken).mockRejectedValueOnce(new Error('still offline'));
    await expect(requestPermissionAndToken()).resolves.toBeNull();

    // 돌리기가 되면 그때 새 토큰이 나온다.
    await expect(requestPermissionAndToken()).resolves.toBe('fcm-tok');
    expect(rotationPending()).toBe(false);
  });
});

describe('worker locale', () => {
  beforeEach(() => {
    Object.assign(import.meta.env, CONFIG);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of Object.keys(CONFIG)) delete import.meta.env[key];
  });

  // 워커는 버튼 문구를 등록 주소의 `locale`로 그린다 — 언어를 바꾸면 그 주소로 다시 등록한다.
  it('권한이 있으면 지금 언어를 실은 주소로 워커를 다시 등록한다', async () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: async () => 'granted',
      },
    });
    const register = vi.fn<(url: string) => Promise<object>>(async () => ({}));
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, ready: Promise.resolve({}) },
    });

    await syncWorkerLocale();

    const url = register.mock.calls[0]?.[0];
    expect(typeof url).toBe('string');
    expect(new URLSearchParams(String(url).split('?')[1]).get('locale')).toBeTruthy();
  });

  it('권한이 없으면 등록하지 않는다 — 그릴 알림이 없다', async () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission: async () => 'default',
      },
    });
    const register = vi.fn(async () => ({}));
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register, ready: Promise.resolve({}) },
    });

    await syncWorkerLocale();

    expect(register).not.toHaveBeenCalled();
  });
});

describe('disable pending', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    rememberDisablePending(false);
  });

  // 기억이 저장소를 이기면, 다른 탭이 지운 표식(켜기 성공)을 이 탭이 계속 들고 있다가 방금
  // 붙인 것을 뗀다 — 저장이 되는 동안은 저장소가 답한다.
  it('다른 탭이 표식을 지우면 이 탭도 끄다 만 것이 아니다', () => {
    rememberDisablePending(true);
    expect(disablePending()).toBe(true);

    localStorage.removeItem('prism.push.disable_pending');

    expect(disablePending()).toBe(false);
  });

  it('저장이 막히면 기억이 답하고, 저장이 돌아오면 저장소가 답한다', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    rememberDisablePending(true);
    expect(disablePending()).toBe(true);

    setItem.mockRestore();
    rememberDisablePending(false);
    expect(disablePending()).toBe(false);
    localStorage.setItem('prism.push.disable_pending', '1');
    expect(disablePending()).toBe(true);
  });
});

describe('intent', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('뒤에 세운 뜻이 마지막이고, 매듭지으면 앞선 뜻은 마지막이 아니다', () => {
    const first = beginIntent('on');
    expect(intentIs(first)).toBe(true);

    const second = beginIntent('off');
    expect(intentIs(first)).toBe(false);
    expect(intentIs(second)).toBe(true);

    settleIntent('off');
    expect(intentIs(second)).toBe(false);
  });

  it('저장이 막히면 기억이 답한다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const id = beginIntent('on');
    expect(intentIs(id)).toBe(true);
  });
});
