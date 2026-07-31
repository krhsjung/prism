// 서버 계약(libs/common/src/types/contracts.ts)을 웹 사본으로 복사 생성한다.
// 사용: pnpm sync:contracts  (원본 수정 후 실행 — drift는 contracts.spec.ts가 잡는다)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(serverRoot, 'libs/common/src/types/contracts.ts');
const target = resolve(serverRoot, '../web/src/lib/contracts.gen.ts');

const HEADER = `// GENERATED FILE — DO NOT EDIT.
// 원본: apps/server/libs/common/src/types/contracts.ts
// 재생성: apps/server에서 \`pnpm sync:contracts\`
`;

// 헤더 뒤 빈 줄 하나로 본문과 구분한다(drift 테스트가 이 경계로 본문을 잘라 비교).
writeFileSync(target, `${HEADER}\n${readFileSync(source, 'utf8')}`);
console.log(`contracts synced → ${target}`);
