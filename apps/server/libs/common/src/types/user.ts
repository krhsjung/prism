import {
  AUTH_PROVIDERS,
  decodeObject,
  decodeString,
  type AuthProvider,
  type JsonValue,
  type User,
} from './contracts';

// 서버 전용 세션 토큰 페이로드(웹 계약 아님 — 계약 타입은 contracts.ts).
export interface JwtPayload {
  sub: string;
  provider: AuthProvider;
  name: string;
  createdAt: string;
}

// jwt.verify가 돌려준 클레임을 검증하며 구성한다. 서명은 이미 검증됐지만
// 클레임 형태는 발급 시점 코드에 의존하므로(구버전 토큰 등) 경계에서 확인한다.
// 세션 토큰 클레임 → 클라이언트 계약 User 매핑(순수).
export function toSessionUser(payload: JwtPayload): User {
  return {
    id: payload.sub,
    provider: payload.provider,
    displayName: payload.name,
    createdAt: payload.createdAt,
  };
}

export function decodeJwtPayload(v: JsonValue): JwtPayload {
  const obj = decodeObject(v, 'JwtPayload');
  const provider = AUTH_PROVIDERS.find((p) => p === obj.provider);
  if (!provider) throw new Error('JwtPayload.provider: unknown provider');
  return {
    sub: decodeString(obj.sub, 'JwtPayload.sub'),
    provider,
    name: decodeString(obj.name, 'JwtPayload.name'),
    createdAt: decodeString(obj.createdAt, 'JwtPayload.createdAt'),
  };
}
