import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  MAX_PUSH_CONTENT_BYTES,
  MAX_PUSH_MESSAGE_LENGTH,
  MAX_PUSH_TARGETS,
  MAX_PUSH_TITLE_LENGTH,
  PUSH_ACTION_SETS,
  PUSH_DATA_KEYS,
  type JsonValue,
} from './contracts';

// 계약 drift 가드: 웹 사본(contracts.gen.ts)이 원본과 어긋나면 실패한다.
// 원본 수정 후에는 `pnpm sync:contracts`로 재생성할 것.
describe('contracts sync', () => {
  it('웹 contracts.gen.ts가 서버 원본과 일치한다', () => {
    const source = readFileSync(resolve(__dirname, 'contracts.ts'), 'utf8');
    const generated = readFileSync(
      resolve(__dirname, '../../../../../web/src/lib/contracts.gen.ts'),
      'utf8',
    );
    // 생성 헤더(GENERATED FILE 주석 블록)를 제외한 본문이 원본과 동일해야 한다.
    const body = generated.slice(generated.indexOf('\n\n') + 2);
    expect(body).toBe(source);
  });

  // 서비스 워커의 사본은 값만 뽑아 낸 것이라 통째 비교가 아니라 **값을** 비교한다 —
  // 워커가 그리는 알림의 data 키와 버튼 조합이 원본과 같아야 한다.
  it('서비스 워커의 push-contract.gen.js가 서버 원본과 일치한다', () => {
    const script = readFileSync(
      resolve(__dirname, '../../../../../web/public/push-contract.gen.js'),
      'utf8',
    );
    // 워커처럼 `self`에 매단다 — 격리된 컨텍스트에서 돌려 값만 꺼낸다.
    const scope: { PRISM_PUSH_CONTRACT?: JsonValue } = {};
    runInNewContext(script, { self: scope });
    expect(scope.PRISM_PUSH_CONTRACT).toEqual({
      dataKeys: PUSH_DATA_KEYS,
      actionSets: [...PUSH_ACTION_SETS],
    });
  });

  // 숫자 상한은 생성기가 옮기지 않아 네이티브가 손으로 든다 — 서버가 같은 값으로 400을 내므로
  // 어긋나면 화면은 통과시키고 서버는 거부한다. 손으로 든 값을 원천과 대조한다.
  it.each([
    [
      'iOS',
      '../../../../../ios/prism/Domain/Models/Auth/CallContracts.swift',
      'let',
    ],
    [
      'Android',
      '../../../../../android/app/src/main/java/kr/hs/jung/prism/domain/model/Contracts.kt',
      'const val',
    ],
  ])(
    '%s의 손으로 든 푸시 상한이 원천과 일치한다',
    (_platform, file, keyword) => {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      const valueOf = (name: string) =>
        Number(
          new RegExp(`${keyword} ${name} = (\\d+)`).exec(source)?.[1] ?? NaN,
        );
      expect(valueOf('MAX_PUSH_MESSAGE_LENGTH')).toBe(MAX_PUSH_MESSAGE_LENGTH);
      expect(valueOf('MAX_PUSH_TITLE_LENGTH')).toBe(MAX_PUSH_TITLE_LENGTH);
      expect(valueOf('MAX_PUSH_TARGETS')).toBe(MAX_PUSH_TARGETS);
      expect(valueOf('MAX_PUSH_CONTENT_BYTES')).toBe(MAX_PUSH_CONTENT_BYTES);
    },
  );
});
