import { decodeObject, parseJsonValue } from '@app/common';

// Apple이 최초 로그인에만 주는 사용자 이름 조각.
// (웹 form_post의 body.user JSON · 네이티브 SDK의 user.name — 두 경로가 같은 형태)
export interface AppleUserName {
  firstName?: string;
  lastName?: string;
}

// 웹 form_post의 user 필드(JSON 문자열)에서 이름을 추출한다.
// JSON이 아니면 throw — 로깅 여부는 호출부가 결정한다(순수 함수).
export function parseAppleUserName(
  appleUserData: string,
): AppleUserName | undefined {
  const name = decodeObject(parseJsonValue(appleUserData), 'apple user').name;
  if (name === null || typeof name !== 'object' || Array.isArray(name)) {
    return undefined;
  }
  return {
    firstName: typeof name.firstName === 'string' ? name.firstName : undefined,
    lastName: typeof name.lastName === 'string' ? name.lastName : undefined,
  };
}

// "First Last" 결합 — 빈 조각은 제거하고, 결과가 비면 undefined.
export function joinPersonName(name?: AppleUserName): string | undefined {
  const joined = [name?.firstName, name?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return joined || undefined;
}
