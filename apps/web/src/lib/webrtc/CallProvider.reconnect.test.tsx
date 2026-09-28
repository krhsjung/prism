import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakePeer,
  calleeConnecting,
  callerConnecting,
  deliver,
  renderApp,
  sent,
  status,
  stubCallEnvironment,
} from './CallProvider.harness';
import { REJOIN_WINDOW_MS } from '../contracts.gen';

// 통화 중 길이 끊기면 **같은 연결에서** 다시 찾는다(ICE restart, plan/webrtc.md §8).
// 이 스펙의 질문은 셋이다 — 누가 내는가(거는 쪽만), 언제 포기하는가(처음 끊긴 뒤 15초),
// 받는 쪽이 어떻게 "이어 붙일 offer"를 알아보는가(DTLS 지문).

const RESTART = { iceRestart: true };
const offerFrom = (fingerprint: string) =>
  `v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 ${fingerprint}`;

const peer = () => {
  const made = FakePeer.made.at(-1);
  if (!made) throw new Error('no peer connection was built');
  return made;
};
const offersSent = () => sent.filter((m) => m.type === 'offer');
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

// 거는 쪽으로 `연결됨`까지 간다 — offer를 내고 답을 받고 ICE가 붙었다.
async function callerConnected() {
  await callerConnecting();
  await waitFor(() => expect(offersSent()).toHaveLength(1));
  deliver({ type: 'answer', callId: 'c-1', sdp: offerFrom('AA') });
  await waitFor(() => expect(peer().remoteDescription?.sdp).toBe(offerFrom('AA')));
  act(() => peer().fire('connected'));
  await waitFor(() => expect(status()).toBe('connected'));
  sent.length = 0;
}

// 받는 쪽으로 `연결됨`까지 간다 — 상대의 offer에 답하고 ICE가 붙었다.
async function calleeConnected() {
  await calleeConnecting();
  deliver({ type: 'offer', callId: 'c-1', sdp: offerFrom('AA') });
  await waitFor(() => expect(sent.some((m) => m.type === 'answer')).toBe(true));
  act(() => peer().fire('connected'));
  await waitFor(() => expect(status()).toBe('connected'));
  sent.length = 0;
}

describe('CallProvider — 재연결', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubCallEnvironment();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // `disconnected`는 스스로 돌아오는 경우가 흔하다 — 잠깐 두고 본 뒤에 낸다.
  it('끊기면 거는 쪽이 잠깐 두고 본 뒤 같은 연결에서 restart offer를 낸다', async () => {
    renderApp();
    await callerConnected();
    const pc = peer();

    act(() => pc.fire('disconnected'));

    await waitFor(() => expect(status()).toBe('reconnecting'));
    await advance(1_000);
    expect(offersSent()).toEqual([]);
    await advance(1_100);
    expect(offersSent()).toEqual([{ type: 'offer', callId: 'c-1', sdp: 'v=0 mine' }]);
    // **연결을 새로 세우지 않았다** — restart는 지금 연결의 재-offer다.
    expect(peer()).toBe(pc);
    expect(pc.offers.at(-1)).toEqual(RESTART);
  });

  // `failed`는 지금 후보로는 길이 없다는 뜻이다 — 기다릴 이유가 없다.
  it('failed는 기다리지 않고 바로 낸다', async () => {
    renderApp();
    await callerConnected();

    act(() => peer().fire('failed'));

    await waitFor(() => expect(offersSent()).toHaveLength(1));
    expect(status()).toBe('reconnecting');
    expect(peer().offers.at(-1)).toEqual(RESTART);
  });

  it('답이 오고 붙으면 연결됨으로 돌아오고 통화 시간은 이어진다', async () => {
    renderApp();
    await callerConnected();
    const since = screen.getByTestId('connected-at').textContent;
    act(() => peer().fire('failed'));
    await waitFor(() => expect(offersSent()).toHaveLength(1));

    deliver({ type: 'answer', callId: 'c-1', sdp: offerFrom('AA') });
    await waitFor(() =>
      expect(peer().remoteDescription).toEqual({ type: 'answer', sdp: offerFrom('AA') }),
    );
    act(() => peer().fire('connected'));

    await waitFor(() => expect(status()).toBe('connected'));
    expect(screen.getByTestId('connected-at').textContent).toBe(since);
    // 붙었으면 더 내지 않는다.
    await advance(6_000);
    expect(offersSent()).toHaveLength(1);
  });

  // 처음 끊긴 시점부터 잰다 — restart를 몇 번 냈는지가 아니라 사람이 얼마나 기다렸는지다.
  it('답은 오는데 붙지 않으면 5초마다 다시 내고 15초에 접는다', async () => {
    renderApp();
    await callerConnected();
    act(() => peer().fire('disconnected'));
    await waitFor(() => expect(status()).toBe('reconnecting'));

    // 2초 · 7초 · 12초 — 답은 매번 오지만 ICE는 붙지 않는다.
    for (const [attempt, wait] of [2_100, 5_000, 5_000].entries()) {
      await advance(wait);
      expect(offersSent()).toHaveLength(attempt + 1);
      deliver({ type: 'answer', callId: 'c-1', sdp: offerFrom('AA') });
      await advance(10);
    }
    expect(status()).toBe('reconnecting');

    await advance(3_000);

    await waitFor(() => expect(status()).toBe('failed'));
    // 접은 뒤에는 더 내지 않는다 — 남는 것은 타일의 `Try again`이다.
    await advance(10_000);
    expect(offersSent()).toHaveLength(3);
  });

  // 내가 낸 offer의 답이 아직 안 왔으면 겹쳐 내지 않는다 — 두 offer가 한 답을 두고 다툰다.
  it('답이 오지 않은 restart 위에 또 내지 않는다', async () => {
    renderApp();
    await callerConnected();
    act(() => peer().fire('failed'));
    await waitFor(() => expect(offersSent()).toHaveLength(1));

    await advance(10_000);

    expect(offersSent()).toHaveLength(1);
    await advance(5_000);
    await waitFor(() => expect(status()).toBe('failed'));
  });

  // 붙기 전의 `failed`는 길을 잃은 것이 아니라 애초에 길이 없던 것이다.
  it('붙기 전의 failed는 restart로 살리지 않는다', async () => {
    renderApp();
    await callerConnecting();
    await waitFor(() => expect(offersSent()).toHaveLength(1));

    act(() => peer().fire('failed'));

    await waitFor(() => expect(status()).toBe('failed'));
    await advance(3_000);
    expect(offersSent()).toHaveLength(1);
  });

  // 역할이 방향에서 나온다 — 받는 쪽은 restart를 내지 않는다. 그래서 glare가 없다.
  it('받는 쪽은 restart를 내지 않고 기다리다 같은 상한에서 접는다', async () => {
    renderApp();
    await calleeConnected();

    act(() => peer().fire('failed'));

    await waitFor(() => expect(status()).toBe('reconnecting'));
    await advance(14_000);
    expect(offersSent()).toEqual([]);
    expect(status()).toBe('reconnecting');
    await advance(1_100);
    await waitFor(() => expect(status()).toBe('failed'));
  });

  // 지문이 같으면 같은 연결이 낸 offer다 — 이어 붙이고, 배지는 이 연결의 상태가 그린다.
  it('같은 지문의 재-offer는 같은 연결에 이어 붙인다', async () => {
    renderApp();
    await calleeConnected();
    const pc = peer();
    const built = FakePeer.made.length;

    deliver({ type: 'offer', callId: 'c-1', sdp: offerFrom('AA') });

    await waitFor(() =>
      expect(sent).toContainEqual({ type: 'answer', callId: 'c-1', sdp: 'v=0 mine-answer' }),
    );
    expect(FakePeer.made).toHaveLength(built);
    expect(peer()).toBe(pc);
    expect(status()).toBe('connected');
  });

  // 지문이 다르면 상대가 연결을 새로 세운 것이다(ICE 정책 전환) — 지금까지의 규칙 그대로.
  it('지문이 다른 offer는 새 연결을 세운다', async () => {
    renderApp();
    await calleeConnected();
    const pc = peer();

    deliver({ type: 'offer', callId: 'c-1', sdp: offerFrom('BB') });

    await waitFor(() => expect(peer()).not.toBe(pc));
    expect(pc.closed).toBe(true);
    await waitFor(() => expect(status()).toBe('connecting'));
  });

  // 같은 연결에는 remoteDescription이 이미 있어서, 새 세대의 후보가 먼저 닿으면 옛
  // 자격증명에 대고 넣다가 버려진다 — 붙이는 동안은 붙들어 둔다.
  it('재-offer를 붙이는 동안 온 후보는 붙들었다가 넣는다', async () => {
    renderApp();
    await calleeConnected();
    const pc = peer();
    let release = () => {};
    FakePeer.holdRemote = new Promise<void>((resolve) => {
      release = resolve;
    });
    const candidate = { candidate: 'candidate:1 1 udp 1 10.0.0.1 5000 typ host', sdpMid: '0' };

    deliver({ type: 'offer', callId: 'c-1', sdp: offerFrom('AA') });
    deliver({ type: 'ice', callId: 'c-1', candidate });
    await advance(10);
    expect(pc.candidates).toEqual([]);

    release();

    await waitFor(() => expect(pc.candidates).toEqual([candidate]));
  });

  // 루프백은 같은 표·같은 시계를 쓴다 — offer가 소켓 대신 페이지 안의 `b`로 갈 뿐이다.
  it('루프백도 같은 길을 탄다', async () => {
    renderApp();
    fireEvent.click(screen.getByText('loopback'));
    await waitFor(() => expect(FakePeer.made).toHaveLength(2));
    const [a, b] = FakePeer.made as [FakePeer, FakePeer];
    await waitFor(() => expect(a.remoteDescription?.type).toBe('answer'));
    act(() => a.fire('connected'));
    await waitFor(() => expect(status()).toBe('connected'));

    act(() => a.fire('disconnected'));

    await waitFor(() => expect(status()).toBe('reconnecting'));
    await advance(2_100);
    expect(a.offers.at(-1)).toEqual(RESTART);
    expect(b.remoteDescription).toEqual({ type: 'offer', sdp: 'v=0 mine' });
    expect(a.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 mine-answer' });
    expect(sent).toEqual([]);
    expect(FakePeer.made).toHaveLength(2);
  });

  // 회선이 바뀌면 시그널링 소켓이 먼저 죽는다 — 통화를 접지 않고 소켓을 기다렸다가
  // `rejoin`으로 창구를 되찾는다(plan/webrtc.md §8-12).
  describe('소켓을 잃었다', () => {
    const noticeText = () => screen.getByTestId('notice').textContent;

    it('붙은 뒤 소켓이 끊기면 접지 않고 소켓을 기다린다', async () => {
      const view = renderApp();
      await callerConnected();

      view.setReady(false);

      await waitFor(() => expect(status()).toBe('reconnecting'));
      // ICE의 소식은 듣지 않고 restart도 내지 않는다 — 갈 길이 없다.
      act(() => peer().fire('failed'));
      await advance(3_000);
      expect(offersSent()).toEqual([]);
      expect(status()).toBe('reconnecting');
    });

    it('소켓이 돌아오면 rejoin을 보내고 accepted에 처음처럼 다시 협상한다', async () => {
      const view = renderApp();
      await callerConnected();
      const since = screen.getByTestId('connected-at').textContent;
      const old = peer();
      view.setReady(false);
      await waitFor(() => expect(status()).toBe('reconnecting'));

      view.setReady(true);

      await waitFor(() => expect(sent).toContainEqual({ type: 'rejoin', callId: 'c-1' }));
      deliver({ type: 'accepted', callId: 'c-1', iceServers: [] });
      await waitFor(() => expect(status()).toBe('connecting'));
      await waitFor(() => expect(offersSent()).toHaveLength(1));
      // **연결을 새로 세운다** — 창구를 되찾은 뒤에는 처음 붙을 때와 같은 길이다.
      expect(peer()).not.toBe(old);
      expect(old.closed).toBe(true);
      expect(screen.getByTestId('connected-at').textContent).toBe(since);

      deliver({ type: 'answer', callId: 'c-1', sdp: offerFrom('BB') });
      await waitFor(() => expect(peer().remoteDescription?.type).toBe('answer'));
      act(() => peer().fire('connected'));
      await waitFor(() => expect(status()).toBe('connected'));
    });

    // 창이 지난 것이다 — "늦게 연 알림"이 아니라 회선이 끊겨 끝난 통화다.
    it('rejoin에 expired가 오면 회선이 끊긴 통화로 접는다', async () => {
      const view = renderApp();
      await callerConnected();
      view.setReady(false);
      await waitFor(() => expect(status()).toBe('reconnecting'));
      view.setReady(true);
      await waitFor(() => expect(sent).toContainEqual({ type: 'rejoin', callId: 'c-1' }));

      deliver({ type: 'expired', callId: 'c-1' });

      await waitFor(() => expect(status()).toBe('none'));
      expect(noticeText()).toBe('lost');
    });

    // 서버가 알려 줄 길이 없는 유일한 시간이라 클라이언트가 스스로 잰다.
    it('창 안에 소켓이 돌아오지 않으면 접는다', async () => {
      const view = renderApp();
      await callerConnected();
      view.setReady(false);
      await waitFor(() => expect(status()).toBe('reconnecting'));

      await advance(REJOIN_WINDOW_MS - 1_000);
      expect(status()).toBe('reconnecting');
      await advance(1_100);

      await waitFor(() => expect(status()).toBe('none'));
      expect(noticeText()).toBe('lost');
    });

    // ⚠️ 창과 "답을 기다리는 시간"이 **한 시계였을 때** 창 끝의 `rejoin`은 서버가 받아
    // 줘도 졌다 — 답이 닿기 전에 시계가 먼저 울었다. 보낸 순간 창을 끄고 답만 따로 잰다.
    it('창 끝에 보낸 rejoin은 답이 늦어도 이긴다', async () => {
      const view = renderApp();
      await callerConnected();
      view.setReady(false);
      await waitFor(() => expect(status()).toBe('reconnecting'));

      // 창이 200ms 남았을 때 소켓이 돌아온다 — 서버는 아직 창 안이라 받아 준다.
      await advance(REJOIN_WINDOW_MS - 200);
      view.setReady(true);
      await waitFor(() => expect(sent).toContainEqual({ type: 'rejoin', callId: 'c-1' }));

      // 그 답이 왕복 300ms 뒤에 닿는다 — 옛 시계였다면 그 사이에 울었다.
      await advance(300);
      deliver({ type: 'accepted', callId: 'c-1', iceServers: [] });

      await waitFor(() => expect(status()).toBe('connecting'));
    });

    // 소켓이 살아 있는데 말없이 접으면 상대는 `통화 중` 안에 `연결 실패`로 남는다 —
    // 되찾힌 창구 때문에 서버도 통화를 살아 있는 것으로 본다.
    it('답이 오지 않아 접을 때는 상대에게 알린다', async () => {
      const view = renderApp();
      await callerConnected();
      view.setReady(false);
      await waitFor(() => expect(status()).toBe('reconnecting'));
      view.setReady(true);
      await waitFor(() => expect(sent).toContainEqual({ type: 'rejoin', callId: 'c-1' }));

      // 답이 아예 오지 않는다 — 10초가 그 상한이다.
      await advance(10_500);

      await waitFor(() => expect(status()).toBe('none'));
      expect(noticeText()).toBe('lost');
      expect(sent).toContainEqual({ type: 'hangup', callId: 'c-1' });
    });

    it('받는 쪽도 rejoin으로 되찾고 상대의 새 offer에 답한다', async () => {
      const view = renderApp();
      await calleeConnected();
      view.setReady(false);
      await waitFor(() => expect(status()).toBe('reconnecting'));
      view.setReady(true);
      await waitFor(() => expect(sent).toContainEqual({ type: 'rejoin', callId: 'c-1' }));

      deliver({ type: 'accepted', callId: 'c-1', iceServers: [] });
      await waitFor(() => expect(status()).toBe('connecting'));
      expect(offersSent()).toEqual([]);

      deliver({ type: 'offer', callId: 'c-1', sdp: offerFrom('BB') });
      await waitFor(() => expect(sent.some((m) => m.type === 'answer')).toBe(true));
      act(() => peer().fire('connected'));
      await waitFor(() => expect(status()).toBe('connected'));
    });
  });
});
