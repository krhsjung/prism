import { JwtService } from '@nestjs/jwt';
import { decodeObject, parseJsonValue, type JsonValue } from '@app/common';
import { SessionTokenService } from './session-token.service';

// 세션 토큰 계약: 세션 참조 왕복 · 클레임에 신원을 담지 않음 · 만료 무시 로그아웃 경로.
describe('SessionTokenService', () => {
  const svc = new SessionTokenService(
    new JwtService({ secret: 'test-secret' }),
  );

  it('signSession ↔ verifySession 왕복', () => {
    expect(svc.verifySession(svc.signSession('u-1', 'sess-1'))).toEqual({
      sub: 'u-1',
      jti: 'sess-1',
    });
  });

  // 회귀 방지: 토큰은 서명일 뿐 암호화가 아니다. 표시 이름 같은 값이 클레임에 있으면
  // 쿠키를 얻은 사람이 base64 디코드만으로 읽는다 — 신원은 서버 세션에만 둔다.
  it('토큰 클레임에 사용자 정보가 담기지 않는다', () => {
    const token = svc.signSession('u-1', 'sess-1');
    const decoded: JsonValue = parseJsonValue(
      Buffer.from(token.split('.')[1] ?? '', 'base64').toString(),
    );
    const claims = decodeObject(decoded, 'claims');

    // 세션을 가리키는 값 외에는 아무것도 없어야 한다.
    expect(claims.name).toBeUndefined();
    expect(claims.provider).toBeUndefined();
    expect(claims.createdAt).toBeUndefined();
    expect(Object.keys(claims).sort()).toEqual(['iat', 'jti', 'sub']);
  });

  // 로그아웃은 인증이 아니라 정리다 — 만료를 이유로 막으면 서버 세션이 idle 만료까지 남는다.
  it('readSessionIdForLogout: 만료된 토큰이어도 서명이 맞으면 세션 id를 준다', () => {
    const expired = new JwtService({ secret: 'test-secret' }).sign(
      { sub: 'u-1', jti: 'sess-1' },
      { expiresIn: '-1s' },
    );
    expect(svc.readSessionIdForLogout(expired)).toBe('sess-1');
  });

  // 서명까지 무시하면 남의 세션 id를 넣어 강제 폐기시킬 수 있다.
  it('readSessionIdForLogout: 다른 키로 서명한 토큰은 null', () => {
    const forged = new JwtService({ secret: 'attacker' }).sign({
      sub: 'u-1',
      jti: 'victim-session',
    });
    expect(svc.readSessionIdForLogout(forged)).toBeNull();
  });
});
