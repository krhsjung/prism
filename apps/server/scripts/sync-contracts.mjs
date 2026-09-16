// 서버 계약(libs/common/src/types/contracts.ts)을 웹 사본으로 복사 생성한다.
// 사용: pnpm sync:contracts  (원본 수정 후 실행 — drift는 contracts.spec.ts가 잡는다)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(serverRoot, 'libs/common/src/types/contracts.ts');
const target = resolve(serverRoot, '../web/src/lib/contracts.gen.ts');
// 서비스 워커용 사본. 워커는 classic 스크립트라 모듈을 import할 수 없고 번들도 지나지
// 않으므로, 손으로 베끼던 값(data 키·버튼 조합)을 여기서 뽑아 `importScripts`로 읽힌다.
const workerTarget = resolve(serverRoot, '../web/public/push-contract.gen.js');

const HEADER = `// GENERATED FILE — DO NOT EDIT.
// 원본: apps/server/libs/common/src/types/contracts.ts
// 재생성: apps/server에서 \`pnpm sync:contracts\`
`;

// 헤더 뒤 빈 줄 하나로 본문과 구분한다(drift 테스트가 이 경계로 본문을 잘라 비교).
const src = readFileSync(source, 'utf8');
writeFileSync(target, `${HEADER}\n${src}`);
console.log(`contracts synced → ${target}`);

writeFileSync(workerTarget, emitWorkerContract(src));
console.log(`push contract synced → ${workerTarget}`);

// `export const NAME = { KEY: 'VALUE', ... } as const;` → [[KEY, VALUE], ...]
// (gen-native-contracts.mjs와 같은 추출 규칙 — 주석 줄은 건너뛴다)
function extractRecord(name) {
  const startMarker = `export const ${name} = {`;
  const start = src.indexOf(startMarker);
  const end = src.indexOf('} as const;', start);
  if (start < 0 || end < 0) throw new Error(`could not find ${name} in contracts.ts`);
  const pairs = [];
  for (const line of src.slice(start + startMarker.length, end).split('\n')) {
    const pair = line.trim().match(/^([A-Z_][A-Z0-9_]*):\s*'([^']+)'/);
    if (pair) pairs.push([pair[1], pair[2]]);
  }
  return pairs;
}

function extractStringArray(name) {
  const match = src.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
  if (!match) throw new Error(`could not find ${name} in contracts.ts`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// 워커가 읽는 것은 두 가지뿐이다 — 알림을 그릴 때 꺼내는 data 키와, 버튼을 그릴지
// 정하는 조합 목록. 문구는 여기 없다(i18n 마스터의 몫).
function emitWorkerContract() {
  const dataKeys = extractRecord('PUSH_DATA_KEYS')
    .map(([k, v]) => `    ${k}: '${v}',`)
    .join('\n');
  const actionSets = extractStringArray('PUSH_ACTION_SETS')
    .map((a) => `'${a}'`)
    .join(', ');
  return [
    ...HEADER.trimEnd().split('\n'),
    '//',
    '// 서비스 워커(firebase-messaging-sw.js)가 importScripts로 읽는다 — 워커는 모듈을',
    '// import할 수 없어 사본이 필요한데, 손으로 베끼면 언젠가 하나만 어긋난다.',
    'self.PRISM_PUSH_CONTRACT = Object.freeze({',
    '  dataKeys: Object.freeze({',
    dataKeys,
    '  }),',
    `  actionSets: Object.freeze([${actionSets}]),`,
    '});',
    '',
  ].join('\n');
}
