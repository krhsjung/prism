// 카메라·마이크를 여는 자리. `RTCPeerConnection`은 여기를 지나지 않는다 —
// 미디어를 얻는 일과 그것을 나르는 일을 갈라 두면, 권한 실패가 통화 실패와 섞이지 않는다.

/** 선택 메뉴 한 줄. 라벨은 권한을 받은 뒤에야 브라우저가 채워 준다. */
export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export interface MediaDevices {
  cameras: MediaDeviceOption[];
  microphones: MediaDeviceOption[];
}

/**
 * 미디어를 얻지 못한 이유. 화면이 갈라 그려야 하는 것은 이것들뿐이다.
 *  - denied:    사용자가 거부했다 → 화면의 **목적이** 통화 시작에서 권한 고치기로 바뀐다
 *  - not-found: 카메라·마이크가 없다 → 고칠 수 있는 것은 기기 쪽이다
 *  - unavailable: 다른 앱이 쥐고 있거나 하드웨어가 답하지 않는다 → 다시 시도가 뜻이 있다
 *  - insecure:  브라우저가 미디어 API 자체를 주지 않는다 → 고칠 곳은 **주소창**이다
 *
 * `insecure`는 **웹에만 있다**(네이티브 셋은 위 셋뿐이다). 브라우저는 안전한 컨텍스트가
 * 아니면 `navigator.mediaDevices`를 아예 만들지 않는데, 그 실패가 `unavailable`로 접히면
 * 화면이 "다른 앱이 카메라를 쓰고 있습니다"라고 말한다 — 있지도 않은 앱을 찾게 만드는,
 * 가장 나쁜 종류의 오답이다.
 */
export type MediaErrorKind =
  | 'denied'
  | 'not-found'
  | 'unavailable'
  | 'insecure';

/**
 * 이 페이지에서 카메라·마이크를 **쓸 수 있기는 한가.**
 *
 * 브라우저는 안전한 컨텍스트(https · localhost)에서만 `navigator.mediaDevices`를 준다.
 * 없으면 `getUserMedia`를 부르는 순간 `TypeError`가 나고, 그것은 DOMException이 아니라
 * `classifyMediaError`가 이름을 읽지 못한다 — 그래서 **부르기 전에** 여기서 가른다.
 *
 * 흔한 걸림돌이다: 개발 서버를 `http://192.168.x.x:5173`처럼 LAN 주소로 열면 그 순간
 * 안전한 컨텍스트가 아니게 되고(localhost만 예외다), 권한 창이 아예 뜨지 않는다.
 */
export function isMediaSupported(): boolean {
  return typeof navigator !== 'undefined' && navigator.mediaDevices != null;
}

// 해상도를 **고르게 하지 않는다**(plan/webrtc.md §4). ideal만 주고 실제로 무엇이
// 잡혔는지는 진단의 `Video` 지표가 말한다 — 고르게 하면 기기가 지원하지 않는 조합에서
// 조용히 실패하고, 그 실패를 설명하는 화면을 또 만들어야 한다.
const VIDEO_IDEAL = { width: { ideal: 1280 }, height: { ideal: 720 } };

export async function openLocalMedia(options: {
  cameraId?: string;
  microphoneId?: string;
}): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: options.cameraId
      ? { ...VIDEO_IDEAL, deviceId: { exact: options.cameraId } }
      : VIDEO_IDEAL,
    audio: options.microphoneId
      ? { deviceId: { exact: options.microphoneId } }
      : true,
  });
}

/**
 * 고를 수 있는 장치들.
 *
 * ⚠️ **권한 전에는 라벨이 빈 문자열이다.** 그래서 이 함수는 `openLocalMedia` 뒤에
 * 부른다 — 먼저 부르면 메뉴에 이름 없는 줄이 늘어서고, 사용자가 무엇을 고르는지 알 수 없다.
 */
export async function listMediaDevices(): Promise<MediaDevices> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind: MediaDeviceKind): MediaDeviceOption[] =>
    devices
      .filter((device) => device.kind === kind && device.deviceId)
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  return {
    cameras: pick('videoinput'),
    microphones: pick('audioinput'),
  };
}

/**
 * 이 기기에 카메라도 마이크도 **하나도 없는가.**
 *
 * `enumerateDevices`는 권한 없이도 **장치의 존재**를 알려 준다(이름만 비어 있다) —
 * 그래서 이 판정은 `getUserMedia`를 부르지 않고, 표시등도 켜지 않는다.
 *
 * 미리 아는 것이 중요한 이유: 장치가 없으면 브라우저는 **권한 창을 띄우지도 않고**
 * 곧바로 `NotFoundError`로 거절한다. 그대로 두면 사용자는 "카메라 켜기"를 눌러도
 * 아무 일도 일어나지 않는 화면을 보게 되고, 원인을 짐작할 단서가 없다.
 *
 * ⚠️ **빈 목록이 언제나 "없다"는 뜻은 아니다.** 지문 방지를 강하게 켠 브라우저는
 * 권한 전에 목록을 감춘다. 그래서 이 판정은 안내를 띄우는 데까지만 쓰고 **켜는 길을
 * 막지는 않는다** — 화면에는 다시 시도할 버튼이 그대로 남는다.
 */
export function hasNoDevices(devices: MediaDevices): boolean {
  return devices.cameras.length === 0 && devices.microphones.length === 0;
}

/**
 * 이 오리진이 **이미 권한을 받았는가.**
 *
 * 브라우저는 허용한 뒤에야 장치 이름을 준다 — 그 사실 자체가 신호다. `permissions.query`
 * 대신 이것을 쓰는 이유: Firefox·Safari의 지원이 고르지 않고, 우리가 정말 알고 싶은 것은
 * "권한 상태"가 아니라 **"메뉴에 그릴 이름이 있는가"**이기 때문이다.
 *
 * ⚠️ 이 판정은 `getUserMedia`를 부르지 않는다 — 카메라가 켜지지 않고 표시등도 꺼져 있다.
 */
export function hasDeviceLabels(devices: MediaDevices): boolean {
  return [...devices.cameras, ...devices.microphones].some(
    (device) => device.label !== '',
  );
}

/**
 * 브라우저마다 이름이 다른 예외를 갈래로 접는다.
 *
 * `insecure`는 여기서 나오지 않는다 — 그건 예외가 아니라 **부르기 전에** 아는 사실이라,
 * `isMediaSupported`가 가른다.
 *
 * 이름으로 가르는 이유: 메시지는 브라우저·언어마다 다르지만 `DOMException.name`은
 * 규격이다. 모르는 이름은 `unavailable`로 접는다 — 다시 시도를 권하는 쪽이, 고칠 수
 * 없는 것처럼 말하는 쪽보다 덜 틀린다.
 */
export function classifyMediaError(
  error: DOMException | Error,
): MediaErrorKind {
  // `instanceof`를 그대로 두는 이유: 던져진 것이 정말 예외 객체인지는 타입이 보장하지
  // 못한다(catch가 잡는 것은 무엇이든 될 수 있다). 아니면 이름이 없는 셈으로 접는다.
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'not-found';
  }
  return 'unavailable';
}

/** 트랙을 **멈추지 않고 끄기만** 한다 — 다시 켤 때 권한을 새로 묻지 않는다. */
export function setTracksEnabled(
  stream: MediaStream | null,
  kind: 'audio' | 'video',
  enabled: boolean,
): void {
  const tracks =
    kind === 'audio' ? stream?.getAudioTracks() : stream?.getVideoTracks();
  for (const track of tracks ?? []) track.enabled = enabled;
}

/** 스트림을 완전히 놓는다. 이것을 빠뜨리면 카메라 표시등이 계속 켜져 있다. */
export function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
