import { DeviceKind } from '@app/common';

// User-Agent를 **기기 종류 하나로 줄인다.**
//
// 이 파일이 존재하는 이유는 반대로 읽어야 한다: UA를 저장하지 않기 위해서다. 세션을
// 만드는 그 순간에 네 갈래 중 하나로 접고 원문은 버린다 — 저장소에 남는 것은 enum
// 하나뿐이라, 저장소가 통째로 유출돼도 브라우저·OS 버전·기기 모델이 새어 나가지 않는다
// (plan/dashboard.md §5).
//
// 정확도보다 **되돌릴 수 없음**이 목적이다. 애매하면 좁히지 않고 `unknown`으로 둔다 —
// 목록의 라벨이 조금 덜 친절한 것이, 없는 정보를 지어내는 것보다 낫다.

// 태블릿을 **먼저** 본다. iPad·Android 태블릿의 UA에는 `Mobile`이 함께 들어 있어
// 순서를 바꾸면 태블릿이 전부 폰으로 접힌다.
const TABLET = /\b(iPad|Tablet|PlayBook|Silk)\b|Android(?!.*\bMobile\b)/i;
const PHONE = /\b(iPhone|iPod|Mobile|Windows Phone)\b/i;
const DESKTOP = /\b(Macintosh|Windows NT|X11|CrOS)\b/i;

/**
 * @param userAgent 요청 헤더의 값. 없거나 빈 값이면 `unknown`.
 *
 * > iPadOS Safari는 기본이 "데스크톱급"이라 스스로를 `Macintosh`로 소개한다 — 그 경우
 * > `desktop`으로 접힌다. UA만으로는 구분할 수 없고, 구분하려고 다른 신호를 더 모으면
 * > 이 파일의 목적과 어긋난다.
 */
export function classifyDevice(userAgent: string | undefined): DeviceKind {
  if (!userAgent?.trim()) return 'unknown';
  if (TABLET.test(userAgent)) return 'tablet';
  if (PHONE.test(userAgent)) return 'phone';
  if (DESKTOP.test(userAgent)) return 'desktop';
  return 'unknown';
}
