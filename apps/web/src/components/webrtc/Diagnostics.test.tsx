import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Diagnostics } from './Diagnostics';
import { I18nContext } from '../../lib/i18n/i18n-context';
import { englishI18n } from '../../lib/i18n/test-i18n';
import type { CallStats } from '../../lib/webrtc/stats';

/**
 * 폭을 정해 준다 — `useMediaQuery`는 `matchMedia`가 없으면 항상 `false`(데스크톱)라,
 * 375 쪽을 재려면 이것이 필요하다.
 */
function setWidth(mobile: boolean) {
  // `useMediaQuery`가 쓰는 세 가지만 채운다(`theme.test.ts`의 `stubSystem`과 같은 모양).
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: mobile && query.includes('max-width'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

const STATS: CallStats = { rttMs: 24, sendingKbps: 1200, path: 'relay' };

function renderDiagnostics(stats: CallStats | null = STATS) {
  render(
    <I18nContext.Provider value={englishI18n()}>
      <Diagnostics
        stats={stats}
        connectedAtMs={null}
        isLoopback={false}
        log={[]}
        onClearLog={() => undefined}
        icePolicy="all"
        onIcePolicy={() => undefined}
        cameras={[]}
        microphones={[]}
        cameraId={null}
        microphoneId={null}
        onSelectCamera={() => undefined}
        onSelectMicrophone={() => undefined}
      />
    </I18nContext.Provider>,
  );
  // 접힌 요약은 펼치기 버튼 안에 산다.
  return screen.getByRole('button').textContent ?? '';
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * 접힌 요약의 형식은 **시안이 정한다**(`24 ms · relay`, plan/webrtc.md §4).
 * 375에서 떨어져 나가는 것은 **대역폭이지 경로가 아니다** — 이 슬라이스가 답하려는
 * 질문이 "직통인가 릴레이인가"이기 때문이다. 한때 웹만 반대로 하고 있었다.
 */
describe('Diagnostics 접힌 요약', () => {
  it('375에서는 왕복 지연과 경로 두 값이다 — 대역폭은 빠진다', () => {
    setWidth(true);
    const summary = renderDiagnostics();
    expect(summary).toContain('24 ms');
    expect(summary).toContain('Relayed (TURN)');
    expect(summary).not.toContain('Mbps');
    // 좁을 때는 접두어도 뗀다(시안 `24 ms · relay`).
    expect(summary).not.toContain('RTT');
  });

  it('데스크톱은 세 값이다 — RTT · 상행 대역폭 · 경로(§4)', () => {
    setWidth(false);
    const summary = renderDiagnostics();
    expect(summary).toContain('RTT 24 ms');
    expect(summary).toContain('1.2 Mbps');
    expect(summary).toContain('Relayed (TURN)');
  });

  it('아직 연결이 없으면 옛 수치가 아니라 `—`다', () => {
    setWidth(true);
    const summary = renderDiagnostics(null);
    expect(summary).toContain('—');
    expect(summary).not.toContain('ms');
  });
});
