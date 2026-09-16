import { initializeApp, type FirebaseApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseWebConfig, type FirebaseWebConfig } from './config';
import { currentLocale } from '../i18n/locale';
import { log } from '../log';

// 이 브라우저의 알림 상태. 화면이 그릴 수 있는 갈래가 그대로다.
//
//  - unsupported: 알림·서비스 워커·FCM 중 하나가 없다(비보안 출처 포함) 또는 미설정
//  - default:     아직 묻지 않았다 — 누를 수 있는 줄을 보여 준다
//  - granted:     토큰을 얻을 수 있다
//  - denied:      사용자가 막았다. **다시 물을 수 없다** — 설정으로 안내한다
export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';

// 이 기기가 **받기로 했는가**. 토큰이 아니라 사람의 선택을 남긴다.
//
// 등록은 세션에 붙으므로 로그아웃하면 함께 사라진다(§5-2). 그때마다 다시 누르게 하면
// 토글이 "켜 두는 것"이 아니라 "매번 켜는 것"이 된다 — 그래서 선택만 기기에 남기고,
// 로그인한 뒤 그 선택대로 조용히 다시 붙인다(§5-16).
//
// **토큰을 남기지 않는 것이 핵심이다.** 토큰은 회전하므로 저장하면 금세 거짓이 되고,
// 저장소에 남길 이유도 없다 — 필요할 때 FCM에서 지금 값을 받으면 된다.
export const PUSH_WANTED_KEY = 'prism.push.enabled';
// 마지막으로 이 브라우저에 로그인해 등록을 맞춘 사용자. 다른 사용자가 오면 토큰을 돌린다.
const OWNER_KEY = 'prism.push.owner';
// 앞 사람의 토큰을 아직 돌리지 못했다 — 돌리기 전에는 새 토큰을 받지 않는다.
const ROTATE_KEY = 'prism.push.rotate_pending';

// 저장하지 **못한** 선택 — 저장소가 막힌 브라우저(사생활 보호 모드·저장 차단·용량 초과)를
// 위한 이 페이지 안의 기억이다. 저장을 못 한 선택을 저장소의 옛 값이나 "꺼져 있다"로
// 읽으면, 켜기가 붙인 직후 코디네이터가 "선택이 꺼져 있는데 등록이 있다"고 보고 방금 붙인
// 것을 뗀다 — 켜기가 스스로를 되돌리는 셈이다. 저장에 성공하면 비운다(저장소가 답한다).
// 페이지를 떠나면 잊는다 — 그것은 기억하지 못하는 것이지 끈 것이 아니다.
let unsavedWanted: boolean | null = null;

// 끄기를 **시작했다**는 표식 — 선택은 떼기 전에 지우므로(다른 탭의 되살리기가 다시 붙이지 않게)
// 떼는 도중 창이 닫히면 "선택은 꺼짐 · 서버는 등록됨"이 남는다. 다음 맞추기는 이 탭이 붙인
// 기억이 없어 남의 등록으로 보고 건드리지 않는다 — 이 표식이 "내가 끄다 만 것"임을 말한다.
// 떼는 데 성공하면 지운다.
//
// 기억은 **저장하지 못했을 때만** 답한다(`unsavedWanted`와 같은 결). 저장이 되는 브라우저에서
// 기억이 저장소를 이기면, 다른 탭이 지운 표식(켜기 성공)을 이 탭이 계속 들고 있다가 방금
// 붙인 것을 뗀다.
const DISABLE_PENDING_KEY = 'prism.push.disable_pending';
let unsavedDisablePending: boolean | null = null;

export function rememberDisablePending(pending: boolean): void {
  unsavedDisablePending = writeFlag(DISABLE_PENDING_KEY, pending) ? null : pending;
}

export function disablePending(): boolean {
  return unsavedDisablePending ?? read(DISABLE_PENDING_KEY) === '1';
}

// 표식 하나를 저장한다. 저장소가 막혔으면 false — 부르는 쪽이 기억으로 답한다.
function writeFlag(key: string, on: boolean): boolean {
  return writeValue(key, on ? '1' : null);
}

function writeValue(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

// 마지막 **명시적 켜기·끄기**의 표식 — 실패한 켜기·끄기가 선택을 되돌릴 때, 그사이 다른 탭이
// 새 뜻을 세웠으면(그 탭의 켜기·끄기가 성공했을 수 있다) 되돌리지 않기 위해서다. 되돌리면
// 다른 탭의 성공을 이 탭의 실패가 뒤집는다: 둘 다 끄는데 한쪽이 실패해 선택을 켜 놓으면
// 다른 탭이 저장소 신호를 받아 다시 붙이고, 둘 다 켜는데 한쪽이 실패해 선택을 꺼 놓으면 다른
// 탭이 방금 붙인 것을 뗀다. 값은 탭이 만든 난수라 어느 뜻이 마지막인지만 가른다.
const INTENT_KEY = 'prism.push.intent';
let unsavedIntent: string | null = null;

/** 뜻의 방향 — 켜기(`on`)인가 끄기(`off`)인가. 표식은 방향을 앞에 단다(`on:…`). */
export type PushIntent = 'on' | 'off';

/** 켜기·끄기를 시작한다 — 이 뜻의 표식을 남기고 돌려준다. */
export function beginIntent(direction: PushIntent): string {
  const id = `${direction}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  unsavedIntent = writeValue(INTENT_KEY, id) ? null : id;
  return id;
}

/**
 * 지금 마지막 뜻의 방향. 표식이 없거나 방향을 모르면 null. 성공이 선택을 다시 남길지 가를 때
 * 본다 — 그사이 **같은 방향**의 새 뜻이 섰다면(그 뜻이 실패해 선택을 되돌렸을 수 있다) 다시
 * 남기고, **반대 방향**이면 그쪽이 더 최근이라 남기지 않는다.
 */
export function currentIntentDirection(): PushIntent | null {
  const current = currentIntent();
  if (current?.startsWith('on:')) return 'on';
  if (current?.startsWith('off:')) return 'off';
  return null;
}

/** 지금 마지막 뜻의 표식. 아무도 세운 적 없으면 null. */
export function currentIntent(): string | null {
  return unsavedIntent ?? read(INTENT_KEY);
}

/** 이 뜻이 아직 마지막 뜻인가 — 다른 탭이 그 뒤에 켜기·끄기를 시작했거나 매듭지었으면 아니다. */
export function intentIs(id: string): boolean {
  return currentIntent() === id;
}

/**
 * 켜기·끄기가 **성공했다** — 뜻을 매듭짓는다(새 표식을 남긴다). 그래야 이 성공보다 **늦게
 * 시작했다가 실패한** 다른 탭의 같은 뜻이(그쪽 표식이 마지막이었으므로) 되돌리기로 이 성공을
 * 뒤집지 않는다. 표식이 마지막인 것은 "아직 아무도 매듭짓지 않았다"는 뜻이어야 한다.
 */
export function settleIntent(direction: PushIntent): void {
  beginIntent(direction);
}

export function pushWanted(): boolean {
  if (unsavedWanted !== null) return unsavedWanted;
  try {
    return localStorage.getItem(PUSH_WANTED_KEY) === '1';
  } catch {
    // 저장소가 막혔고 기억도 없다 — 선택한 적이 없는 것과 같다.
    return false;
  }
}

export function rememberPushWanted(wanted: boolean): void {
  try {
    localStorage.setItem(PUSH_WANTED_KEY, wanted ? '1' : '0');
    unsavedWanted = null;
  } catch {
    // 저장소가 막혔다 — 이 페이지 안에서는 위의 기억이 답한다.
    unsavedWanted = wanted;
  }
}

/**
 * 이 브라우저의 등록을 마지막으로 맞춘 사용자를 남긴다. **다른 사용자가 오면 토큰을 돌리기
 * 위해서다**: 앞 사람의 세션이 확인되지 않은 채(오프라인·일시적 실패) 로그인 화면이 떴고
 * 거기서 다른 계정으로 로그인하면, 앞 사람의 세션은 서버에 살아 있고 그 토큰은 이
 * 브라우저를 가리킨다 — 로그아웃이 없었으니 토큰도 버려지지 않았다. 사용자가 바뀐 것을
 * 여기서 알아채고 토큰을 돌리면 그 세션의 토큰은 죽은 값이 된다(plan/push.md §5-21).
 * 같은 사용자의 새로고침·재로그인은 돌리지 않는다.
 *
 * @returns 주인이 맞춰졌는가 — 돌릴 것이 없었거나 돌렸다. false면 돌리기가 미뤄졌거나
 *   실패한 것이고, 그동안 새 토큰은 나오지 않는다(`requestPermissionAndToken`이 먼저 끝낸다).
 */
export async function ensureOwner(userId: string): Promise<boolean> {
  // 주인은 **저장소와 기억 둘 다** 본다 — 저장소 쓰기가 막힌 브라우저에서는 돌린 뒤 적은
  // 주인이 저장소에 남지 않아, 앞 사람이 돌아오면 저장소의 옛 값("같은 사람")만 보고 돌리지
  // 않는다. 둘 중 하나라도 다른 사람이면 돌린다 — 한 번 더 돌리는 것은 무해하다.
  const known = [unsavedOwner, read(OWNER_KEY)];
  // 보류는 **기억에도** 남긴다 — 저장소 쓰기가 막힌 브라우저에서 표식을 썼다가 되읽으면
  // "보류 없음"이 되어 앞 사람의 토큰을 그대로 새 사람에게 붙인다. 판단은 어긋남 자체로 한다.
  if (known.some((owner) => owner !== null && owner !== userId)) {
    rememberRotationPending(true);
  }
  if (!rotationPending()) {
    commitOwner(userId);
    return true;
  }
  // **돌려야 하는 동안은 주인을 바꾸지 않는다.** 바꿔 두면 돌리기가 실패해도 다음 로그인이
  // "같은 사람"으로 읽어 다시 돌리지 않는다 — 앞 세션의 토큰이 산 채로 남는다. 대신 돌린
  // 뒤 주인이 될 사람을 적어 둔다 — 지금 로그인한 사람이 언제나 그 사람이다.
  pendingOwnerInMemory = userId;
  write(PENDING_OWNER_KEY, userId);
  return completeRotation();
}

// 저장하지 못한 보류 — 저장소가 막힌 브라우저를 위한 이 페이지 안의 기억이다. 저장이 되면
// 저장소가 답한다: 다른 탭이 돌리기를 끝내고 지운 보류를 이 탭이 계속 들고 있으면, 그 탭이
// 방금 붙인 토큰을 한 번 더 버린다.
let unsavedRotationPending: boolean | null = null;

function rememberRotationPending(pending: boolean): void {
  unsavedRotationPending = writeFlag(ROTATE_KEY, pending) ? null : pending;
}
// 저장하지 **못한** 주인 — 저장소 쓰기가 막힌 브라우저를 위한 이 페이지 안의 기억이다
// (`unsavedWanted`와 같은 결). 저장에 성공하면 비운다(저장소가 답한다).
let unsavedOwner: string | null = null;

function commitOwner(userId: string): void {
  try {
    localStorage.setItem(OWNER_KEY, userId);
    unsavedOwner = null;
  } catch {
    unsavedOwner = userId;
  }
}
// 돌린 뒤 주인이 될 사람 — 돌리기가 미뤄지는 동안(권한 없음·실패) 기억해 두었다가 성공하면
// 그때 주인으로 적는다. 저장소가 막힌 브라우저를 위해 기억에도 든다.
const PENDING_OWNER_KEY = 'prism.push.pending_owner';
let pendingOwnerInMemory: string | null = null;

/** 아직 돌리지 못한 앞 사람의 토큰이 있는가 — 있으면 새 토큰을 받지 않는다. */
export function rotationPending(): boolean {
  return unsavedRotationPending ?? read(ROTATE_KEY) === '1';
}

// 보류된 돌리기를 끝낸다. 성공해야 보류가 풀리고, **그때 주인이 바뀐다** — 미뤄진 돌리기가
// 나중에 끝났는데 주인이 앞 사람으로 남으면, 그 사람이 돌아왔을 때 "같은 사람"으로 읽어
// 돌리지 않고 뒷사람의 토큰을 그대로 붙인다.
async function completeRotation(): Promise<boolean> {
  if (!(await rotateToken())) return false;
  const owner = pendingOwnerInMemory ?? read(PENDING_OWNER_KEY);
  if (owner !== null) commitOwner(owner);
  rememberRotationPending(false);
  pendingOwnerInMemory = null;
  write(PENDING_OWNER_KEY, null);
  return true;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 저장소가 막혔다 — 이 페이지 안에서만 유효한 판단이 된다 */
  }
}

/**
 * 이 설치의 토큰을 **버린다** — 다음 `getToken`이 새 값을 만든다.
 *
 * ⚠️ **우리 워커를 먼저 붙인다.** `deleteToken`은 messaging 인스턴스에 워커가 아직 없으면
 * 기본 경로(`/firebase-messaging-sw.js`, 쿼리 없음)를 스스로 등록하는데, 우리 워커는
 * 쿼리로 설정을 받으므로 그 등록은 실패하고 버리기도 실패한다. `getToken`이 워커를
 * 인스턴스에 묶는 유일한 문이라 먼저 한 번 부른다(그 토큰은 곧 버려진다).
 *
 * @returns 버렸는가. 실패하면 false — 부르는 쪽이 보류로 남긴다.
 */
export async function rotateToken(): Promise<boolean> {
  const config = firebaseWebConfig();
  // 이 배포에 푸시가 없거나 브라우저에 알림 API가 없다 — 토큰이 있었던 적이 없으니 돌릴 것도
  // 없다. **일시적으로** 못 돌리는 것(아래 `isSupported`)과 다르다.
  if (!config || currentPermission() === 'unsupported') return true;
  // 권한이 없으면 **미룬다** — 아래 `getToken`이 권한 창을 스스로 띄운다("진입만으로 묻지
  // 않는다", plan/webrtc.md §7). 권한을 주는 자리(켜기)가 받은 뒤에 이어서 돌린다. 그동안
  // 새 토큰도 받지 않으므로 앞 사람의 토큰이 새 사람에게 붙는 일은 없다.
  if (currentPermission() !== 'granted') return false;
  try {
    // SDK의 지원 확인은 IndexedDB를 열어 보는 것이라 **잠깐 실패할 수 있다.** 그것을 "돌렸다"로
    // 읽으면 앞 사람의 토큰이 산 채로 남고 주인만 바뀐다 — 돌리지 못한 것은 보류로 남긴다.
    if (!(await isSupported())) return false;
    const registration = await navigator.serviceWorker.register(serviceWorkerUrl(config), {
      scope: '/',
    });
    await navigator.serviceWorker.ready;
    const messaging = getMessaging(appOf(config));
    await getToken(messaging, {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    });
    await deleteToken(messaging);
    return true;
  } catch {
    log.error('push.token_rotate_failed');
    return false;
  }
}

/**
 * FCM이 이 브라우저를 지원하는가.
 *
 * **`currentPermission()`이 이것까지 보지 못한다** — 비동기이기 때문이다. 그래서 알림·
 * 서비스워커 API는 있는데 FCM이 `isSupported()`로 거절하는 브라우저에서는 권한이
 * `default`/`granted`로 분류되고, **켜기 버튼이 서지만 눌러도 아무 일이 없었다**
 * (`requestPermissionAndToken`이 같은 검사로 조용히 null을 돌려준다).
 *
 * 화면이 마운트할 때 한 번 물어 그 값을 `unsupported`로 접는다(§5-19).
 */
export async function pushSupported(): Promise<boolean> {
  if (currentPermission() === 'unsupported') return false;
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

export function currentPermission(): PushPermission {
  if (!firebaseWebConfig()) return 'unsupported';
  if (typeof Notification === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const permission = Notification.permission;
  return permission === 'granted' || permission === 'denied' ? permission : 'default';
}

// 권한을 묻고 등록 토큰을 받는다.
//
// **진입만으로 부르지 않는다.** 자동 프롬프트는 브라우저가 벌주는 패턴이고, 이 저장소가
// 카메라에 세운 규칙("명시적 제스처 뒤에만", plan/webrtc.md §7)과도 같은 줄이다.
// 푸시 화면의 `알림 켜기`에서만 부른다(로그인 화면은 로그인만 한다).
export async function requestPermissionAndToken(): Promise<string | null> {
  const config = firebaseWebConfig();
  if (!config || currentPermission() === 'unsupported') return null;
  if (!(await isSupported())) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  // 앞 사람의 토큰을 아직 못 돌렸다 — 그 값이 앞 계정의 세션에 붙어 있을 수 있어, 먼저
  // 돌리기 전에는 새 등록을 시작하지 않는다(plan/push.md §5-21). 권한을 받은 **뒤**에 한다:
  // 돌리기는 토큰을 한 번 만들어야 해서 권한이 없으면 SDK가 스스로 묻는다.
  if (rotationPending() && !(await completeRotation())) return null;

  try {
    // 서비스 워커를 **우리가 등록한다** — 배포 설정을 쿼리로 넘겨야 하기 때문이다
    // (classic 워커는 번들의 env를 읽지 못한다).
    const registration = await navigator.serviceWorker.register(serviceWorkerUrl(config), {
      scope: '/',
    });
    // ⚠️ **활성화까지 기다린다.** `register()`는 등록을 시작한 시점에 이미 돌아오므로,
    // 갓 등록한(또는 방금 해제했다 다시 등록한) 워커는 아직 `active`가 아니다. 그 상태로
    // `getToken`을 부르면 실패하고, 그 세션은 영영 `Notifications off`가 된다 —
    // 개발자 도구에서 워커를 Unregister한 뒤 정확히 이 일이 벌어졌다.
    await navigator.serviceWorker.ready;
    return await getToken(getMessaging(appOf(config)), {
      vapidKey: config.vapidKey,
      serviceWorkerRegistration: registration,
    });
  } catch (e) {
    // 토큰 발급은 네트워크·푸시 서비스에 달려 있다. 실패해도 로그인은 계속돼야 한다 —
    // 그 세션이 `Notifications off`가 될 뿐이고, 화면이 그 사실을 말한다.
    //
    // 다만 **조용히 삼키지는 않는다.** 사유가 없으면 "왜 계속 꺼져 있지"를 화면만 보고
    // 알 수 없다. 개발 빌드에서만 남고 배포에는 아무것도 남지 않는다(lib/log.ts).
    log.error('push.token_failed', {
      reason: e instanceof Error ? e.name : 'unknown',
    });
    return null;
  }
}

/**
 * 언어를 바꿨다 — 워커를 그 언어의 주소로 다시 등록한다. 워커는 버튼 문구를 등록 주소의
 * `locale`로 그리므로(localStorage를 못 읽는다), 다시 등록하지 않으면 다음 등록 계기까지
 * 옛 언어로 남는다. 권한이 없으면 그릴 알림도 없으니 하지 않는다 — 등록은 권한을 묻지 않는다.
 */
export async function syncWorkerLocale(): Promise<void> {
  const config = firebaseWebConfig();
  if (!config || currentPermission() !== 'granted') return;
  try {
    if (!(await isSupported())) return;
    await navigator.serviceWorker.register(serviceWorkerUrl(config), {
      scope: '/',
    });
  } catch (e) {
    log.error('push worker locale sync failed', { error: String(e) });
  }
}

function serviceWorkerUrl(config: FirebaseWebConfig): string {
  const params = new URLSearchParams({
    apiKey: config.apiKey,
    projectId: config.projectId,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
    // 워커가 버튼 문구를 그릴 언어 — **앱에서 고른 언어**다. 워커는 localStorage를 읽을 수
    // 없어 등록 주소로 받는다. 언어를 바꾸면 주소가 달라져 워커가 갱신된다(드물다).
    locale: currentLocale(),
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

// 앱은 한 번만 만든다 — `initializeApp`을 두 번 부르면 던진다.
let app: FirebaseApp | null = null;
function appOf(config: FirebaseWebConfig): FirebaseApp {
  app ??= initializeApp({
    apiKey: config.apiKey,
    projectId: config.projectId,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
  });
  return app;
}
