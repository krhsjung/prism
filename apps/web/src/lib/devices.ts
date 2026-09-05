import type { DeviceKind } from './contracts.gen';
import type { MessageKey } from './i18n/messages.gen';

/** 기기 종류가 어떤 실루엣으로 그려지는가. 브랜드가 달라도 생김새는 셋뿐이다. */
export type DeviceShape = 'phone' | 'tablet' | 'monitor';

/**
 * 계약의 기기 종류 → 번역 키. 계약이 유니온이라 갈래가 늘면 컴파일에서 걸린다.
 *
 * 대시보드의 세션 목록과 통화 화면의 기기 목록·타일 이름표가 **같은 표를 본다** —
 * 같은 `GET /auth/sessions`에서 온 값이라 라벨이 갈라지면 안 된다(plan/webrtc.md §4).
 */
export const DEVICE_LABELS: Record<DeviceKind, MessageKey> = {
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

export const DEVICE_SHAPES: Record<DeviceKind, DeviceShape> = {
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
