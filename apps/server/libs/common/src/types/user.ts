import { decodeObject, decodeString, type JsonValue } from './contracts';

// 서버 전용 세션 토큰 페이로드(웹 계약 아님 — 계약 타입은 contracts.ts).
//
// 클레임은 **세션을 가리키는 최소한**만 담는다. 이전에는 provider·표시 이름·가입일이
// 그대로 들어 있었는데, JWT는 서명일 뿐 암호화가 아니라서 쿠키를 얻은 사람이
// base64 디코드만으로 표시 이름을 읽을 수 있었다. 이제 그 값들은 서버 세션 저장소에
// 있고 토큰은 어느 세션인지만 말한다.
export interface JwtPayload {
  sub: string; // 사용자 id
  jti: string; // 세션 id — 저장소의 prism:session:<jti>
}

// jwt.verify가 돌려준 클레임을 검증하며 구성한다. 서명은 이미 검증됐지만
// 클레임 형태는 발급 시점 코드에 의존하므로(구버전 토큰 등) 경계에서 확인한다.
export function decodeJwtPayload(v: JsonValue): JwtPayload {
  const obj = decodeObject(v, 'JwtPayload');
  return {
    sub: decodeString(obj.sub, 'JwtPayload.sub'),
    jti: decodeString(obj.jti, 'JwtPayload.jti'),
  };
}
