import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // 배포된 웹은 콘솔에 아무것도 남기지 않는다 — 리뷰어의 활동이 로그로 재구성되지
      // 않게 하려는 것이다(apps/web/README.md). 유일한 예외는 개발 게이트 뒤에 있는
      // src/lib/log.ts이고, 그 두 줄만 disable 주석으로 열어 둔다.
      'no-console': 'error',
      // 프로젝트 방침: unknown/any 타입 키워드 금지 — 구체 union·제네릭으로 대체한다.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSUnknownKeyword',
          message:
            'unknown 금지 — JsonValue/구체 union/제네릭으로 표현한다 (프로젝트 방침)',
        },
      ],
    },
  },
])
