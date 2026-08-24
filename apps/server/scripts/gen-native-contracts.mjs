// 서버 계약(libs/common/src/types/contracts.ts)의 **드리프트 위험이 큰 상수**(오류 코드·
// provider 목록)를 iOS(Swift)·Android(Kotlin) 사본으로 생성한다.
//
//   node scripts/gen-native-contracts.mjs          생성
//   node scripts/gen-native-contracts.mjs --check  커밋된 산출물이 원천과 일치하는지 검사
//
// 웹은 contracts.gen.ts로 통째 복사되지만(sync-contracts.mjs), 네이티브는 언어가 달라
// 그대로 옮길 수 없어 손으로 베끼던 값이었다 — 그 값(특히 오류 코드 문자열)이 서버에서
// 바뀌면 조용히 어긋난다. 여기서 문자열 상수만 원천에서 뽑아 생성하고, 모델 struct·
// UI 열거형·디코더 같은 플랫폼별 코드는 손으로 유지한다(그쪽은 형태가 안정적이다).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(serverRoot, '../..');
const source = resolve(serverRoot, 'libs/common/src/types/contracts.ts');

const TARGETS = {
  swift: resolve(repoRoot, 'apps/ios/prism/Domain/Models/Auth/Contracts.gen.swift'),
  kotlin: resolve(
    repoRoot,
    'apps/android/app/src/main/java/kr/hs/jung/prism/domain/model/Contracts.gen.kt',
  ),
};

// ──────────────────────── 원천 추출 ────────────────────────

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const src = readFileSync(source, 'utf8');

// `export const NAME = ['a', 'b'] as const;` → ['a','b']
function extractStringArray(name) {
  const match = src.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
  if (!match) fail(`could not find array const ${name} in contracts.ts`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// `export const NAME = { KEY: 'VALUE', ... } as const;` → [[KEY, VALUE], ...]
// (주석 줄은 건너뛴다 — 원천은 값 사이에 설명 주석을 둔다)
function extractRecord(name) {
  const startMarker = `export const ${name} = {`;
  const start = src.indexOf(startMarker);
  if (start < 0) fail(`could not find record const ${name} in contracts.ts`);
  const end = src.indexOf('} as const;', start);
  if (end < 0) fail(`unterminated record const ${name} in contracts.ts`);
  const body = src.slice(start + startMarker.length, end);
  const pairs = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    const pair = trimmed.match(/^([A-Z_][A-Z0-9_]*):\s*'([^']+)'/);
    if (pair) pairs.push([pair[1], pair[2]]);
  }
  if (pairs.length === 0) fail(`record const ${name} yielded no entries`);
  return pairs;
}

const contract = {
  authProviders: extractStringArray('AUTH_PROVIDERS'),
  deviceKinds: extractStringArray('DEVICE_KINDS'),
  socketServerMessageTypes: extractStringArray('SOCKET_SERVER_MESSAGE_TYPES'),
  authErrorCodes: extractRecord('AUTH_ERROR_CODES'),
  clientErrorCodes: extractRecord('CLIENT_ERROR_CODES'),
};

// ──────────────────────── 방출 ────────────────────────

function camelCase(screamingSnake) {
  return screamingSnake
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

// 반대 방향 — 와이어 값이 camelCase인 목록(소켓 메시지 type)을 Kotlin enum 상수로 옮긴다.
function screamingSnake(camel) {
  return camel.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}

const HEADER = [
  '// GENERATED FILE — DO NOT EDIT.',
  '// 원본: apps/server/libs/common/src/types/contracts.ts',
  '// 재생성: apps/server에서 `pnpm gen:contracts`',
];

function emitSwift() {
  const lines = [
    ...HEADER,
    '',
    '/// 서버가 오류 응답 body(`{ "error": "..." }`)로 주는 코드.',
    'enum AuthErrorCode {',
    ...contract.authErrorCodes.map(([k, v]) => `    static let ${camelCase(k)} = "${v}"`),
    '}',
    '',
    '/// 클라이언트(웹·모바일)가 로컬에서 만드는, 서버 계약에 등재된 코드.',
    '/// 앱 전용 코드(예: PROVIDER_UNAVAILABLE)는 여기 없다 — `AppErrorCode`(손으로 유지).',
    'enum ClientErrorCode {',
    ...contract.clientErrorCodes.map(([k, v]) => `    static let ${camelCase(k)} = "${v}"`),
    '}',
    '',
    '/// 서버 `User.provider`가 취하는 값. 디코딩 경계에서 이 집합으로 검증한다.',
    `let AUTH_PROVIDERS: Set<String> = [${contract.authProviders.map((p) => `"${p}"`).join(', ')}]`,
    '',
    '/// 세션을 만든 기기의 종류(`SessionInfo.device`). 모르는 값은 `unknown`으로 접는다 —',
    '/// 갈래가 늘었다고 예전 앱에서 목록 전체가 실패하면 손해가 더 크다.',
    'enum DeviceKind: String, Codable, Sendable {',
    ...contract.deviceKinds.map((k) => `    case ${k}`),
    '',
    '    init(from decoder: Decoder) throws {',
    '        let raw = try decoder.singleValueContainer().decode(String.self)',
    '        self = DeviceKind(rawValue: raw) ?? .unknown',
    '    }',
    '}',
    '',
    '/// 세션 소켓이 내려보내는 메시지의 종류.',
    '///',
    '/// `DeviceKind`와 달리 **모르는 값은 접지 않고 거부한다** — 이것은 화면 라벨이 아니라',
    '/// 동작이라, 아무 갈래로 접으면 하지 말아야 할 일을 한다. 합성된 `init(from:)`이',
    '/// 모르는 raw 값에 throw하는 것이 바로 그 동작이다.',
    'enum SocketServerMessageType: String, Codable, Sendable {',
    ...contract.socketServerMessageTypes.map((t) => `    case ${t}`),
    '}',
    '',
  ];
  return lines.join('\n');
}

function emitKotlin() {
  const lines = [
    'package kr.hs.jung.prism.domain.model',
    '',
    ...HEADER,
    '',
    '/** 서버가 오류 응답 body(`{ "error": "..." }`)로 주는 코드. */',
    'object AuthErrorCode {',
    ...contract.authErrorCodes.map(([k, v]) => `    const val ${k} = "${v}"`),
    '}',
    '',
    '/** 클라이언트(웹·모바일)가 로컬에서 만드는, 서버 계약에 등재된 코드. */',
    '/** 앱 전용 코드(예: PROVIDER_UNAVAILABLE)는 여기 없다 — `AppErrorCode`(손으로 유지). */',
    'object ClientErrorCode {',
    ...contract.clientErrorCodes.map(([k, v]) => `    const val ${k} = "${v}"`),
    '}',
    '',
    '/** 서버 `User.provider`가 취하는 값. 디코딩 경계에서 이 집합으로 검증한다. */',
    `val AUTH_PROVIDERS: Set<String> = setOf(${contract.authProviders.map((p) => `"${p}"`).join(', ')})`,
    '',
    '/** 세션을 만든 기기의 종류(`SessionInfo.device`). */',
    'enum class DeviceKind(val wire: String) {',
    ...contract.deviceKinds.map((k) => `    ${k.toUpperCase()}("${k}"),`),
    '    ;',
    '',
    '    companion object {',
    '        /**',
    '         * 모르는 값은 거부하지 않고 [UNKNOWN]으로 접는다 — 기기 종류는 화면의 라벨일',
    '         * 뿐이라, 갈래가 늘었다고 예전 앱에서 목록 전체가 실패하면 손해가 더 크다.',
    '         */',
    '        fun from(wire: String?): DeviceKind =',
    '            entries.firstOrNull { it.wire == wire } ?: UNKNOWN',
    '    }',
    '}',
    '',
    '/** 세션 소켓이 내려보내는 메시지의 종류. */',
    'enum class SocketServerMessageType(val wire: String) {',
    ...contract.socketServerMessageTypes.map(
      (t) => `    ${screamingSnake(t)}("${t}"),`,
    ),
    '    ;',
    '',
    '    companion object {',
    '        /**',
    '         * [DeviceKind]와 달리 **모르는 값은 접지 않고 null을 준다** — 이것은 화면',
    '         * 라벨이 아니라 동작이라, 아무 갈래로 접으면 하지 말아야 할 일을 한다.',
    '         */',
    '        fun from(wire: String?): SocketServerMessageType? =',
    '            entries.firstOrNull { it.wire == wire }',
    '    }',
    '}',
    '',
  ];
  return lines.join('\n');
}

const built = {
  swift: { path: TARGETS.swift, contents: emitSwift() },
  kotlin: { path: TARGETS.kotlin, contents: emitKotlin() },
};

// ──────────────────────── 쓰기 / 검사 ────────────────────────

const check = process.argv.includes('--check');

if (check) {
  const drifted = [];
  for (const { path, contents } of Object.values(built)) {
    const at = relative(repoRoot, path);
    let current = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      drifted.push(`${at} (없음)`);
      continue;
    }
    if (current !== contents) drifted.push(`${at} (내용 불일치)`);
  }
  if (drifted.length > 0) {
    console.error(
      `✗ 네이티브 계약 산출물이 원천과 어긋난다 — \`pnpm gen:contracts\` 후 커밋할 것:\n   ${drifted.join('\n   ')}`,
    );
    process.exit(1);
  }
  console.log('✓ 네이티브 계약 산출물이 원천과 일치한다');
} else {
  for (const { path, contents } of Object.values(built)) {
    writeFileSync(path, contents);
    console.log(`  ${relative(repoRoot, path)}`);
  }
  console.log('완료');
}
