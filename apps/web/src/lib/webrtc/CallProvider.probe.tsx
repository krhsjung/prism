import { useCall } from './call-context';

/** 스펙이 누르고 읽는 화면 조각 — `CallProvider.harness.tsx`가 트리에 꽂는다. */
export function Probe() {
  const {
    startCall, startLoopback, acceptIncoming, cancelCall, hangUp, retryCall,
    setIcePolicy, resumeCall, call, incoming, notice,
  } = useCall();
  return (
    <>
      <button onClick={() => startCall({ id: 'peer-1', device: 'mac' })}>call</button>
      <button onClick={startLoopback}>loopback</button>
      <button onClick={acceptIncoming}>accept</button>
      <button onClick={cancelCall}>cancel</button>
      <button onClick={hangUp}>hangup</button>
      <button onClick={retryCall}>retry</button>
      <button onClick={() => setIcePolicy('relay')}>relay</button>
      <button onClick={() => resumeCall('c-1')}>resume</button>
      <span data-testid="status">{call ? call.status : 'none'}</span>
      <span data-testid="connected-at">{call?.connectedAtMs ?? 'none'}</span>
      <span data-testid="incoming">{incoming ? 'ringing' : 'none'}</span>
      <span data-testid="notice">{notice?.kind ?? 'none'}</span>
    </>
  );
}
