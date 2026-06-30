# prism

한 도메인, 네 플랫폼 — 서버 · 웹 · iOS · Android 구현을 한 저장소에 모은 풀스택 포트폴리오.

## 이름의 의미

프리즘은 하나의 빛을 여러 갈래로 펼쳐 보여줍니다. 이 프로젝트도 **하나의 백엔드(도메인)** 를
**웹 · iOS · Android** 라는 여러 면으로 굴절시켜, 같은 기능을 플랫폼마다 어떻게 구현했는지
나란히 비교할 수 있게 합니다. 도메인은 일부러 단순하게 두었고, 보여주려는 것은 도메인 복잡도가
아니라 **여러 플랫폼에 걸친 구현 품질과 일관성**입니다. 하나의 소스가 여러 결과물로 나뉜다는
점에서 프리즘이라는 이름을 골랐습니다.

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

## 배포

web(정적) · auth · api 빌드/배포 방법은 [infra/deploy/README.md](infra/deploy/README.md)를 참고하세요.
