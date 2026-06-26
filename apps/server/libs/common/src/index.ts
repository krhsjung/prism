// @app/common — 앱 간 공유 코드 배럴.
// 우선은 공유 도메인 타입만. 런타임 provider(서비스/모듈)를 추가할 때는
// nest-cli의 webpack 빌더로 전환 필요(타입은 컴파일 시 소거되어 tsc로 충분).
export * from './types/user';
