# design

디자인 시스템 — 토큰 + 비주얼 소스 of truth.

## 구조

```text
design/
├── tokens/                     # JSON 토큰 (Figma Variables에서 sync)
│   ├── color/
│   │   ├── light.json
│   │   └── dark.json
│   ├── typography.json
│   ├── radius.json
│   └── spacing.json
├── build/                      # Style Dictionary 산출물 (gitignored)
│   ├── web/{light,dark}/{tokens.css, tokens.ts}
│   ├── ios/{light,dark}/Tokens.swift
│   └── android/{light,dark}/{colors.xml, dimens.xml}
├── build.js                    # Style Dictionary 빌드 스크립트
└── package.json
```

## 워크플로

비주얼 소스: [Figma — `Prism` 파일](https://www.figma.com/design/sTDo6HDslOcRmWL78klk1I/Prism)

1. **편집**: Figma Variables / 컴포넌트 / 비주얼은 Figma에서 수정
2. **Sync**: Figma 변수 → `tokens/color/{light,dark}.json` 수동 sync (Claude가 MCP로 추출 + 매핑)
3. **Build**: `pnpm build` → `build/{platform}/{theme}/`에 플랫폼별 + 테마별 산출물 생성
4. **Use**: 각 앱이 자기 플랫폼/테마 산출물을 import해서 사용

## 사용

```bash
pnpm install
pnpm build
```

## 스타일

Manrope (Regular / SemiBold / Bold) 기반. 컬러는 Navy / Primary / Accent Blue 중심의
soft cool 무드 (라이트/다크 양쪽 정의 — Figma `Colors` 변수 컬렉션 참고).
