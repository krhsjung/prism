import { DeviceKind } from '@app/common';

// User-Agent를 **정해진 갈래 하나로 줄인다.**
//
// 이 파일이 존재하는 이유는 반대로 읽어야 한다: UA를 저장하지 않기 위해서다. 세션을
// 만드는 그 순간에 아래 목록 중 하나로 접고 원문은 버린다 — 저장소에 남는 것은 enum
// 하나뿐이라, 저장소가 통째로 유출돼도 모델명·OS 버전·브라우저 버전이 새어 나가지
// 않는다(plan/dashboard.md §5).
//
// 정확도보다 **되돌릴 수 없음**이 목적이다. 알아볼 수 있으면 브랜드까지 좁히고,
// 애매하면 넓은 쪽에 둔다 — 목록의 라벨이 조금 덜 친절한 것이, 없는 정보를 지어내는
// 것보다 낫다.

// 순서가 규칙이다. 위에서부터 처음 맞는 것이 답이므로, **좁은 것을 먼저** 둔다.
// (iPad·Galaxy Tab의 UA에는 `Mobile`이 함께 들어 있어, 폰을 먼저 보면 전부 폰이 된다)
const RULES: readonly [RegExp, DeviceKind][] = [
  // ── Apple ──
  // iPadOS Safari는 기본이 "데스크톱급"이라 스스로를 `Macintosh`로 소개한다 — 그런 iPad는
  // 아래 `mac`으로 접힌다. UA만으로는 구분할 수 없고, 구분하려고 다른 신호를 더 모으면
  // 이 파일의 목적과 어긋난다. (우리 앱은 `Prism (iPad)`를 보내므로 앱에서는 정확하다)
  [/\biPad\b/i, 'ipad'],
  [/\b(iPhone|iPod)\b/i, 'iphone'],

  // ── Android 브랜드 ──
  // 삼성은 모델 코드가 `SM-`으로 시작한다(SM-G988N·SM-X910…). 태블릿(SM-T·SM-X)도
  // 같은 접두어라 여기서는 브랜드로만 묶는다 — 모델 자리를 더 파면 좁은 값이 된다.
  [/\b(SM-[A-Z0-9]+|Galaxy)\b/i, 'galaxy'],
  [/\bPixel\b/i, 'pixel'],
  // 브랜드를 모르는 안드로이드. Chrome의 UA 축약은 모델을 `K`로 지우므로 이 자리로 온다.
  [/\bAndroid\b/i, 'android'],

  // ── 데스크톱 ──
  [/\b(Macintosh|Mac OS X)\b/i, 'mac'],
  [/\bWindows NT\b/i, 'windows'],
  [/\b(X11|CrOS|Linux)\b/i, 'desktop'],
];

/**
 * @param userAgent 요청 헤더의 값. 없거나 빈 값이면 `unknown`.
 */
export function classifyDevice(userAgent: string | undefined): DeviceKind {
  if (!userAgent?.trim()) return 'unknown';
  for (const [pattern, kind] of RULES) {
    if (pattern.test(userAgent)) return kind;
  }
  return 'unknown';
}
