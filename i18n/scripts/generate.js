// 번역 마스터(CSV) → 플랫폼별 산출물 생성.
//
//   node scripts/generate.js            모든 서비스 생성
//   node scripts/generate.js client     한 서비스만 생성
//   node scripts/generate.js --check    커밋된 산출물이 마스터와 일치하는지 검사(쓰지 않음)
//
// 마스터가 진실의 원천이다 — 산출물은 절대 직접 수정하지 않는다.
// web/server 산출물은 컴파일 대상이라 커밋하고(계약 파일과 같은 방식), 아직 앱이 없는
// iOS/Android 산출물은 build/에만 만든다(gitignore).

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
const TARGETS = {
  web: {
    platform: 'Web',
    committed: true,
    dir: 'apps/web/src/lib/i18n',
    emit: emitWeb,
  },
  server: {
    platform: '',
    committed: true,
    dir: 'apps/server/libs/common/src/i18n',
    emit: emitServer,
  },
  ios: {
    platform: 'iOS',
    committed: false,
    dir: 'i18n/build/ios',
    emit: emitIos,
  },
  android: {
    platform: 'Android',
    committed: false,
    dir: 'i18n/build/android',
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

  return files;
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '\\&apos;')
    .replace(/\n/g, '\\n');
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
          lines.push(`    <string name="${entry.fullKey}">${value}</string>`);
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

// 마스터에서 사라진 언어의 파일이 남지 않도록, 생성 대상 디렉터리의 .gen.ts 중
// 이번에 만들지 않은 것을 지운다. 손으로 쓴 파일(.ts)은 건드리지 않는다.
function pruneGenerated(dir, keep) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name.endsWith('.gen.ts') && !keep.has(path)) {
      unlinkSync(path);
      console.log(`  - ${relative(REPO_ROOT, path)} (제거)`);
    }
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
      const keep = new Set(files.keys());
      pruneGenerated(root, keep);
      pruneGenerated(join(root, 'locales'), keep);
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

    // 마스터에 없는 언어 파일이 남아 있는 경우도 drift다.
    const root = join(REPO_ROOT, config.dir);
    const keep = new Set(files.keys());
    for (const dir of [root, join(root, 'locales')]) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (name.endsWith('.gen.ts') && !keep.has(path)) {
          drifted.push(`${relative(REPO_ROOT, path)} (마스터에 없음)`);
        }
      }
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
