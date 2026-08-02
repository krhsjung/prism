// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // 생성 파일은 포맷 검사 대상이 아니다 — 손으로 고치지 않으므로 지적할 사람이 없고,
    // prettier가 다시 쓰면 마스터에서 생성한 내용과 어긋나 drift 검사가 깨진다.
    // (재생성: i18n에서 `pnpm generate` — .prettierignore에도 같은 경로를 둔다)
    ignores: ['eslint.config.mjs', 'libs/common/src/i18n/**/*.gen.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // 프로젝트 방침: unknown/any 타입 키워드 금지 — 구체 union·제네릭으로 대체한다.
      // (경계의 any 유입은 contracts의 parseJsonValue/jsonBodyOf 단일 통로로만)
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSUnknownKeyword',
          message:
            'unknown 금지 — JsonValue/구체 union/제네릭으로 표현한다 (프로젝트 방침)',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
