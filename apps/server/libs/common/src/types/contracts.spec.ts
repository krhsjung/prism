import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
});
