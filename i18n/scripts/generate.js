// 번역 마스터(CSV) → 플랫폼별 산출물 생성.
//
//   node scripts/generate.js            모든 서비스 생성
//   node scripts/generate.js client     한 서비스만 생성
//   node scripts/generate.js --check    커밋된 산출물이 마스터와 일치하는지 검사(쓰지 않음)
//
// 마스터가 진실의 원천이다 — 산출물은 절대 직접 수정하지 않는다.
// 앱이 있는 플랫폼(web/server/iOS)의 산출물은 컴파일·번들 대상이라 커밋하고(계약 파일과
// 같은 방식), 아직 앱이 없는 Android 산출물은 build/에만 만든다(gitignore).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const I18N_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(I18N_ROOT, '..');

// 서비스: 마스터 파일 하나가 어떤 플랫폼들로 펼쳐지는지.
const SERVICES = {
  client: { csv: 'client.csv', targets: ['web', 'ios', 'android'] },
  server: { csv: 'server.csv', targets: ['server'] },
};

// 타깃: 산출물의 형식·위치.
// platform은 `{{platform}}` 치환값이다(빈 문자열이면 변수를 지운다).
// committed=true인 산출물만 --check가 검사한다(나머지는 gitignore된 build/).
// suffix는 "이 타깃이 만드는 파일"의 표식이다 — 커밋된 디렉터리에서 이번에 만들지
// 않은 같은 확장자 파일을 잔재로 보고 지운다(모듈·언어가 마스터에서 사라진 경우).
// 손으로 쓴 파일이 같은 자리에 있어도 확장자가 달라 건드리지 않는다.
const TARGETS = {
  web: {
    platform: 'Web',
    committed: true,
    suffix: '.gen.ts',
    dir: 'apps/web/src/lib/i18n',
    emit: emitWeb,
  },
  server: {
    platform: '',
    committed: true,
    suffix: '.gen.ts',
    dir: 'apps/server/libs/common/src/i18n',
    emit: emitServer,
  },
  ios: {
    platform: 'iOS',
    committed: true,
    suffix: '.xcstrings',
    dir: 'apps/ios/prism/Resources/Localization',
    emit: emitIos,
  },
  android: {
    platform: 'Android',
    committed: true,
    suffix: '.xml',
    // 전용 생성 리소스 소스셋. 손으로 쓴 res/(colors·themes·strings)와 섞이지 않게
    // 별도 디렉터리에 두고 build.gradle의 sourceSets에서 res.srcDir로 등록한다 —
    // 그래야 잔재 정리가 이 디렉터리의 .xml만 지워도 안전하다.
    dir: 'apps/android/app/src/generated/res',
    emit: emitAndroid,
  },
};

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

// ──────────────────────── 마스터 읽기 ────────────────────────

function readLocales() {
  const path = join(I18N_ROOT, 'locales.json');
  const locales = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(locales) || locales.length === 0) {
    fail('locales.json: 최소 한 개의 언어가 필요하다');
  }
  for (const locale of locales) {
    if (!locale?.code || !locale.label || !locale.dir) {
      fail(`locales.json: code·label·dir이 모두 필요하다 — ${JSON.stringify(locale)}`);
    }
    if (locale.dir !== 'ltr' && locale.dir !== 'rtl') {
      fail(`locales.json: dir은 ltr 또는 rtl이어야 한다 — ${locale.code}`);
    }
  }
  return locales;
}

// CSV 한 줄 파싱 — 따옴표 필드와 이스케이프된 따옴표("")를 처리한다.
function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') {
        cell += ch;
      } else if (line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

// 마스터 CSV → { locales, modules: [{ name, entries }] }.
// 모듈·키의 등장 순서를 그대로 보존한다(산출물의 순서 = 마스터의 순서 → diff가 읽힌다).
function parseMaster(csvPath, locales) {
  const name = relative(REPO_ROOT, csvPath);
  const lines = readFileSync(csvPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) fail(`${name}: 비어 있다`);

  const header = parseCsvLine(lines[0]);
  const codes = locales.map((l) => l.code);
  const expected = ['module', 'key', ...codes].join(',');
  if (header.join(',') !== expected) {
    fail(
      `${name}: 헤더가 locales.json과 어긋난다\n  기대: ${expected}\n  실제: ${header.join(',')}`,
    );
  }

  const modules = [];
  const byName = new Map();
  const seenKeys = new Set();
  const filled = [];

  for (let i = 1; i < lines.length; i++) {
    const at = `${name}:${i + 1}`;
    const cells = parseCsvLine(lines[i]);
    const moduleName = cells[0]?.trim() ?? '';
    const key = cells[1]?.trim() ?? '';
    if (!moduleName) fail(`${at}: module 칸이 비어 있다`);

    let module = byName.get(moduleName);
    if (!module) {
      if (!KEY_PATTERN.test(moduleName)) {
        fail(`${at}: module은 snake_case여야 한다 — "${moduleName}"`);
      }
      module = { name: moduleName, entries: [] };
      byName.set(moduleName, module);
      modules.push(module);
    }

    // 주석 행 — key 칸이 #으로 시작한다. 산출물에 주석으로 옮겨 문맥을 보존한다.
    if (key.startsWith('#')) {
      module.entries.push({ type: 'comment', text: key.slice(1).trim() });
      continue;
    }
    if (!KEY_PATTERN.test(key)) {
      fail(`${at}: key는 snake_case여야 한다 — "${key}"`);
    }

    const fullKey = `${moduleName}.${key}`;
    if (seenKeys.has(fullKey)) fail(`${at}: 키가 중복된다 — ${fullKey}`);
    seenKeys.add(fullKey);

    // 마스터의 `\n`은 실제 줄바꿈으로 편다(CSV 한 줄 = 한 키를 유지하기 위한 표기).
    const values = {};
    const source = (cells[2] ?? '').replace(/\\n/g, '\n');
    if (source === '') fail(`${at}: 원본 언어(${codes[0]}) 값이 비어 있다 — ${fullKey}`);
    codes.forEach((code, column) => {
      const value = (cells[column + 2] ?? '').replace(/\\n/g, '\n');
      // 빈 칸은 원본 언어로 채운다 — 산출물의 키 집합은 언어마다 항상 같아야 하고
      // (타입이 그것을 강제한다), 빠진 번역은 침묵이 아니라 경고로 드러낸다.
      if (value === '') filled.push(`${fullKey} (${code})`);
      values[code] = value === '' ? source : value;
    });

    module.entries.push({ type: 'entry', key, fullKey, values });
  }

  if (seenKeys.size === 0) fail(`${name}: 키가 하나도 없다`);
  if (filled.length > 0) {
    console.warn(
      `⚠ 번역 누락 ${filled.length}건 — 원본 언어로 채워 생성한다:\n   ${filled.join('\n   ')}`,
    );
  }

  return { locales, modules };
}

// ──────────────────────── 공통 유틸 ────────────────────────

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function entriesOf(master) {
  return master.modules.flatMap((m) => m.entries.filter((e) => e.type === 'entry'));
}

// `{{platform}}` 치환 — 빌드 시점에 플랫폼별 문구를 갈라 쓰기 위한 변수.
// (런타임 값은 `{name}` 형태의 단일 중괄호를 쓴다 — 서로 겹치지 않는다)
function forPlatform(value, platform) {
  if (platform === '') return value.replace(/\s*\{\{platform\}\}/g, '').trim();
  return value.replace(/\{\{platform\}\}/g, platform);
}

function pascalCase(name) {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

// `auth.welcome_back` → `authWelcomeBack` (Swift 열거형 케이스 이름).
function camelCase(key) {
  const pascal = pascalCase(key.replace(/\./g, '_'));
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function tsString(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function generatedHeader(service) {
  return [
    '// GENERATED FILE — DO NOT EDIT.',
    `// 원본: i18n/${service}.csv, i18n/locales.json`,
    '// 재생성: i18n에서 `pnpm generate`',
    '',
  ].join('\n');
}

// 언어 파일의 본문 — 마스터의 모듈 구분과 주석을 그대로 옮긴다.
function tsMessageBody(master, code, platform) {
  const lines = [];
  master.modules.forEach((module, index) => {
    if (index > 0) lines.push('');
    lines.push(`  // ── ${module.name} ──`);
    for (const entry of module.entries) {
      if (entry.type === 'comment') lines.push(`  // ${entry.text}`);
      else {
        const value = forPlatform(entry.values[code], platform);
        lines.push(`  ${tsString(entry.fullKey)}: ${tsString(value)},`);
      }
    }
  });
  return lines.join('\n');
}

// 언어 공통 메타(목록·기본 언어·표시 이름·쓰기 방향·키 목록) — web/server가 함께 쓴다.
function tsLocaleMeta(master) {
  const codes = master.locales.map((l) => l.code);
  const meta = master.locales
    .map((l) => `  ${l.code}: { label: ${tsString(l.label)}, dir: '${l.dir}' },`)
    .join('\n');
  const keys = entriesOf(master)
    .map((entry) => `  ${tsString(entry.fullKey)},`)
    .join('\n');

  return `export const LOCALES = [${codes.map(tsString).join(', ')}] as const;

export type Locale = (typeof LOCALES)[number];

// 목록의 첫 언어가 원본이자 기본값 — 지원하지 않는 요청 언어는 여기로 떨어진다.
export const DEFAULT_LOCALE: Locale = ${tsString(codes[0])};

export interface LocaleMeta {
  // 언어 선택 UI에 그대로 노출되는 이름 — 해당 언어로 표기한다.
  label: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
${meta}
};

export const MESSAGE_KEYS = [
${keys}
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

// 모든 키가 채워져야 성립한다 — 언어 파일에 키가 빠지거나 남으면 컴파일이 깨진다.
export type Messages = Record<MessageKey, string>;`;
}

// ──────────────────────── 타깃별 산출물 ────────────────────────

// 웹: 기본 언어는 정적으로 번들하고 나머지는 동적 import로 나눈다.
function emitWeb(master, service, platform) {
  const files = new Map();
  const codes = master.locales.map((l) => l.code);
  const [defaultCode] = codes;

  for (const code of codes) {
    files.set(
      `locales/${code}.gen.ts`,
      `${generatedHeader(service)}
import type { Messages } from '../messages.gen';

export const messages: Messages = {
${tsMessageBody(master, code, platform)}
};
`,
    );
  }

  const loaders = codes
    .map((code) =>
      code === defaultCode
        ? `  ${code}: () => Promise.resolve(defaultMessages),`
        : `  ${code}: () => import('./locales/${code}.gen').then((m) => m.messages),`,
    )
    .join('\n');

  files.set(
    'messages.gen.ts',
    `${generatedHeader(service)}
import { messages as defaultMessages } from './locales/${defaultCode}.gen';

${tsLocaleMeta(master)}

// 기본 언어만 정적으로 번들한다 — 첫 렌더에서 곧바로 그릴 수 있어야 하기 때문.
export const DEFAULT_MESSAGES: Messages = defaultMessages;

// 나머지 언어는 고를 때 내려받는다 — 언어가 늘어도 초기 번들 크기는 그대로다.
export const LOAD_MESSAGES: Record<Locale, () => Promise<Messages>> = {
${loaders}
};
`,
  );

  return files;
}

// 서버: 요청 경로에서 동기 조회가 필요하므로 전 언어를 미리 적재한다.
function emitServer(master, service, platform) {
  const files = new Map();
  const codes = master.locales.map((l) => l.code);

  for (const code of codes) {
    files.set(
      `locales/${code}.gen.ts`,
      `${generatedHeader(service)}
import type { Messages } from '../messages.gen';

export const messages: Messages = {
${tsMessageBody(master, code, platform)}
};
`,
    );
  }

  const imports = codes
    .map((code) => `import { messages as ${code} } from './locales/${code}.gen';`)
    .join('\n');

  files.set(
    'messages.gen.ts',
    `${generatedHeader(service)}
${imports}

${tsLocaleMeta(master)}

// 요청마다 언어가 달라지므로 전부 메모리에 둔다 — 응답 경로에 파일 I/O를 두지 않는다.
export const MESSAGES: Record<Locale, Messages> = { ${codes.join(', ')} };
`,
  );

  return files;
}

// iOS: 모듈당 xcstrings 카탈로그 하나.
function emitIos(master, _service, platform) {
  const files = new Map();
  const codes = master.locales.map((l) => l.code);

  for (const module of master.modules) {
    const strings = {};
    for (const entry of module.entries) {
      if (entry.type !== 'entry') continue;
      const localizations = {};
      for (const code of codes) {
        localizations[code] = {
          stringUnit: {
            state: 'translated',
            value: forPlatform(entry.values[code], platform),
          },
        };
      }
      strings[entry.fullKey] = { extractionState: 'manual', localizations };
    }
    const catalog = {
      sourceLanguage: codes[0],
      strings,
      version: '1.0',
    };
    files.set(`${pascalCase(module.name)}.xcstrings`, `${JSON.stringify(catalog, null, 2)}\n`);
  }

  files.set('Messages.gen.swift', emitIosKeys(master));
  return files;
}

// iOS: 키를 문자열로 적으면 오타가 런타임까지 살아남는다(빠진 키는 키 자체가 화면에
// 그려질 뿐 빌드는 통과한다). 웹의 `MessageKey` 유니온과 같은 역할을 하는 열거형을
// 함께 만들어, 마스터에 없는 키를 쓰면 컴파일에서 걸리게 한다.
// 테이블 이름(= 모듈)도 여기서 짝지어 준다 — 호출부가 카탈로그 파일명을 알 필요가 없다.
function emitIosKeys(master) {
  const lines = [
    '// GENERATED FILE — DO NOT EDIT.',
    '// 원본: i18n/client.csv, i18n/locales.json',
    '// 재생성: i18n에서 `pnpm generate`',
    '',
    'import Foundation',
    '',
    '/// 지원 언어 — locales.json의 순서 그대로이며, 첫 항목이 기본 언어다.',
    'enum AppLocale: String, CaseIterable, Sendable {',
    ...master.locales.map((l) => `    case ${l.code}`),
    '',
    '    /// 목록에 그리는 이름. 각 언어를 **그 언어로** 적는다 — 지금 화면 언어를 못 읽는',
    '    /// 사용자가 쓰는 장치라, 현재 언어로 번역해 두면 정작 필요한 사람이 찾지 못한다.',
    '    var label: String {',
    '        switch self {',
    ...master.locales.map((l) => `        case .${l.code}: "${l.label}"`),
    '        }',
    '    }',
    '}',
    '',
    '/// 번역 키 — 값은 마스터의 `{module}.{key}`이고, `table`은 그 키가 실린 카탈로그다.',
    'enum MessageKey: String, CaseIterable, Sendable {',
  ];

  for (const module of master.modules) {
    const entries = module.entries.filter((e) => e.type === 'entry');
    if (entries.length === 0) continue;
    lines.push(`    // ${pascalCase(module.name)}`);
    for (const entry of entries) {
      lines.push(`    case ${camelCase(entry.fullKey)} = "${entry.fullKey}"`);
    }
  }

  lines.push(
    '',
    '    /// 키가 실린 .xcstrings 카탈로그 이름.',
    '    var table: String {',
    '        switch self {',
  );

  for (const module of master.modules) {
    const entries = module.entries.filter((e) => e.type === 'entry');
    if (entries.length === 0) continue;
    // 케이스가 모듈당 수십 개까지 가므로 한 줄에 몰지 않는다(생성물도 읽힌다).
    const cases = entries.map((e) => `.${camelCase(e.fullKey)}`);
    cases.forEach((name, i) => {
      const head = i === 0 ? '        case ' : '             ';
      const tail = i === cases.length - 1 ? ':' : ',';
      lines.push(`${head}${name}${tail}`);
    });
    lines.push(`            "${pascalCase(module.name)}"`);
  }

  lines.push('        }', '    }', '}', '');
  return lines.join('\n');
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Android는 문자열 리터럴에서 아포스트로피를 escape해야 한다. `\'`가 정식 표기다
    // (`&apos;`는 XML 엔티티일 뿐 Android 리소스 파서에는 통하지 않는다).
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
}

// Android 리소스 이름은 `[a-zA-Z0-9_]`만 허용한다 — 점을 언더스코어로 바꾼다
// (`auth.welcome_back` → `auth_welcome_back`). R.string 필드도 이 이름을 쓴다.
function androidName(fullKey) {
  return fullKey.replace(/\./g, '_');
}

// Android: 언어별 values 디렉터리 + 모듈별 strings 파일.
function emitAndroid(master, _service, platform) {
  const files = new Map();
  const [sourceCode] = master.locales.map((l) => l.code);

  for (const { code } of master.locales) {
    const dir = code === sourceCode ? 'values' : `values-${code}`;
    for (const module of master.modules) {
      const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<resources>'];
      for (const entry of module.entries) {
        if (entry.type === 'comment') lines.push('', `    <!-- ${entry.text} -->`);
        else {
          const value = escapeXml(forPlatform(entry.values[code], platform));
          lines.push(`    <string name="${androidName(entry.fullKey)}">${value}</string>`);
        }
      }
      lines.push('</resources>', '');
      files.set(`${dir}/strings_${module.name}.xml`, lines.join('\n'));
    }
  }

  return files;
}

// ──────────────────────── 쓰기 / 검사 ────────────────────────

// 서비스 × 타깃 → { absolutePath: contents }. 쓰기와 검사가 같은 결과를 공유한다.
function buildFiles(serviceNames) {
  const locales = readLocales();
  const built = [];

  for (const service of serviceNames) {
    const config = SERVICES[service];
    const master = parseMaster(join(I18N_ROOT, config.csv), locales);
    for (const name of config.targets) {
      const target = TARGETS[name];
      const files = new Map();
      for (const [file, contents] of target.emit(master, service, target.platform)) {
        files.set(join(REPO_ROOT, target.dir, file), contents);
      }
      built.push({ service, target: name, config: target, files });
    }
  }

  return built;
}

// 생성 대상 디렉터리 트리에서 이 타깃이 만드는 확장자(suffix) 파일을 모두 모은다.
// web/server는 root + `locales/`, Android는 root + `values-*/`처럼 한 단계 아래에도
// 산출물이 있어 재귀로 훑는다. 손으로 쓴 파일은 확장자가 다르거나(.ts·.swift) 전용
// 생성 디렉터리 밖에 있어 걸리지 않는다.
function collectGenerated(dir, suffix) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) found.push(...collectGenerated(path, suffix));
    else if (name.name.endsWith(suffix)) found.push(path);
  }
  return found;
}

// 마스터에서 사라진 언어·모듈의 파일이 남지 않도록, 이번에 만들지 않은 산출물을 지운다.
function pruneGenerated(dir, keep, suffix) {
  for (const path of collectGenerated(dir, suffix)) {
    if (keep.has(path)) continue;
    unlinkSync(path);
    console.log(`  - ${relative(REPO_ROOT, path)} (제거)`);
  }
}

function writeAll(built) {
  for (const { target, config, files } of built) {
    console.log(`\n[${target}] ${config.dir}`);
    const root = join(REPO_ROOT, config.dir);

    // 커밋하지 않는 산출물은 통째로 갈아엎는다(잔재가 남을 이유가 없다).
    if (!config.committed && existsSync(root)) rmSync(root, { recursive: true });

    for (const [path, contents] of files) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
      console.log(`  ${relative(REPO_ROOT, path)}`);
    }

    if (config.committed) {
      pruneGenerated(root, new Set(files.keys()), config.suffix);
    }
  }
}

// 커밋된 산출물이 마스터와 일치하는지 검사한다(CI·커밋 전 게이트).
function checkAll(built) {
  const drifted = [];

  for (const { config, files } of built) {
    if (!config.committed) continue;
    for (const [path, contents] of files) {
      const at = relative(REPO_ROOT, path);
      if (!existsSync(path)) drifted.push(`${at} (없음)`);
      else if (readFileSync(path, 'utf8') !== contents) drifted.push(`${at} (내용 불일치)`);
    }

    // 마스터에 없는 언어·모듈 파일이 남아 있는 경우도 drift다.
    const root = join(REPO_ROOT, config.dir);
    const keep = new Set(files.keys());
    for (const path of collectGenerated(root, config.suffix)) {
      if (!keep.has(path)) drifted.push(`${relative(REPO_ROOT, path)} (마스터에 없음)`);
    }
  }

  if (drifted.length > 0) {
    console.error(
      `✗ 산출물이 마스터와 어긋난다 — i18n에서 \`pnpm generate\` 후 커밋할 것:\n   ${drifted.join('\n   ')}`,
    );
    process.exit(1);
  }
  console.log('✓ 번역 산출물이 마스터와 일치한다');
}

// ──────────────────────── 진입점 ────────────────────────

const args = process.argv.slice(2);
const check = args.includes('--check');
const requested = args.filter((arg) => !arg.startsWith('--'));
const services = requested.length > 0 ? requested : Object.keys(SERVICES);

for (const service of services) {
  if (!SERVICES[service]) {
    fail(`알 수 없는 서비스: ${service} (가능: ${Object.keys(SERVICES).join(', ')})`);
  }
}

const built = buildFiles(services);
if (check) checkAll(built);
else {
  writeAll(built);
  console.log('\n완료');
}
