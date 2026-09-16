import {
  DEFAULT_LOCALE,
  localeFrom,
  type DeviceKind,
  type Locale,
} from '@app/common';
import { classifyDevice } from './device';

// 세션이 **어디서 왔는가.** 로그인 경로 여덟 개가 이 값 하나를 나른다.
//
// 원래는 `device` 하나만 흘렸는데 싣는 것이 늘었다. 인자를 계속 더하면 여덟 자리에서
// 순서를 맞춰야 하고, 그중 하나만 빠뜨려도 조용히 기본값이 된다.
//
// 푸시 토큰은 **여기 없다.** 한때 로그인 요청에 실렸지만(plan/push.md §5-2) 그 흐름은
// 뒤집혔다 — 등록은 살아 있는 세션에 `POST /auth/push/register`로 붙는다. 로그인은
// 로그인만 한다.
export interface SessionOrigin {
  // 이미 enum으로 접힌 값만 담는다 — UA 원문은 컨트롤러 밖으로 나가지 않는다.
  device: DeviceKind;
  // 로그인 요청의 표시 언어. 서버가 그리는 알림 문구(통화 알림·기본 제목)가 이 값을
  // 쓴다. 그 뒤로는 인증된 요청마다 가드가 다시 맞춘다 — 여기 값은 **첫 값**일 뿐이다.
  locale: Locale;
}

// 요청을 알 수 없는 자리의 기본값(테스트·내부 호출).
export const ANONYMOUS_ORIGIN: SessionOrigin = {
  device: 'unknown',
  locale: DEFAULT_LOCALE,
};

// 요청 하나에서 세션의 출신을 읽는다.
//
// 언어는 **`Accept-Language`가 나른다.** 계약에 필드를 더하지 않은 이유는 웹 소셜
// 로그인 때문이다 — 그 세션은 서버 콜백에서 만들어져 실을 body가 없는데, 브라우저는
// 이 헤더를 알아서 싣는다. 네이티브 앱은 앱 안에서 고른 언어를 이 헤더에 담아 보낸다.
export function originOf(headers: {
  'user-agent'?: string;
  'accept-language'?: string;
}): SessionOrigin {
  return {
    device: classifyDevice(headers['user-agent']),
    locale: localeFrom(headers['accept-language']),
  };
}
