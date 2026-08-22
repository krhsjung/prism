/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 지원하는 브라우저의 하한. 여기 적힌 것보다 오래된 브라우저는 대상이 아니다.
 *
 * 값 자체보다 **명시한다는 것**이 중요하다: 기본값에 맡기면 최소화기가 최신 문법으로
 * 줄여도 알 길이 없다(실제로 미디어쿼리가 range 문법으로 나가 Safari 16.3 이하에서
 * 모바일 배치가 통째로 죽었다).
 */
const BROWSER_FLOOR = ['chrome107', 'edge107', 'firefox104', 'safari16'];

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // **지원 하한을 명시한다.** 기본값에 맡기면 최소화기가 최신 문법으로 줄여 버린다 —
    // 실제로 `@media (max-width: 720px)`가 range 문법(`width<=720px`)으로 바뀌어 나갔고,
    // 그 문법을 모르는 브라우저에서는 규칙이 **통째로 무시돼** 모바일 배치가 죽는다
    // (Safari는 16.4부터 지원한다). 하한을 적어 두면 그런 변환이 조용히 일어나지 않는다.
    //
    // JS도 같은 하한을 쓴다 — 한쪽만 정해 두면 "스타일은 무시되는데 스크립트는 도는"
    // (또는 그 반대의) 어긋난 조합이 나온다.
    target: BROWSER_FLOOR,
    cssTarget: BROWSER_FLOOR,
  },
  test: {
    environment: 'jsdom',
  },
})
