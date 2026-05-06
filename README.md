# prism

한 도메인, 네 플랫폼 — 서버 · 웹 · iOS · Android 구현을 한 저장소에 모은 풀스택 포트폴리오.

## 구조

```
prism/
├── apps/
│   ├── server/   # NestJS — REST API, 도메인 소스
│   ├── web/      # React + Vite
│   ├── ios/      # Swift + SwiftUI
│   └── android/  # Kotlin + Compose
├── infra/        # Docker, CI/CD, 배포 설정
├── design/       # 디자인 자산, 목업, 스크린샷
└── plan/         # 기획/설계 문서, ADR, API 명세
```

각 앱은 독립 프로젝트입니다. 빌드/실행은 각 앱 폴더 안에서 수행합니다.

## 기술 스택

| 영역    | 스택             |
| ------- | ---------------- |
| Server  | NestJS           |
| Web     | React + Vite     |
| iOS     | Swift + SwiftUI  |
| Android | Kotlin + Compose |

## 시작하기

자세한 실행 방법은 각 앱 폴더의 README를 참고하세요.
