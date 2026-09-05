import { useEffect, useState, type ReactNode } from 'react';
import { ChevronIcon } from './CallIcons';
import { DeviceSelect } from './DeviceSelect';
import { useI18n } from '../../lib/i18n/i18n-context';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { formatSignalLog, type SignalLogEntry } from '../../lib/webrtc/signal-log';
import type { IcePolicy } from '../../lib/webrtc/call-context';
import type { CallStats, CandidateInfo, IcePath } from '../../lib/webrtc/stats';
import type { MediaDeviceOption } from '../../lib/webrtc/media';
import type { MessageKey } from '../../lib/i18n/messages.gen';

const PATH_LABELS: Record<IcePath, MessageKey> = {
  direct: 'webrtc.ice_path_direct',
  reflexive: 'webrtc.ice_path_reflexive',
  relay: 'webrtc.ice_path_relay',
  loopback: 'webrtc.ice_path_loopback',
};

// 릴레이는 **실패가 아니라 비싼 성공**이다 — 그래서 Error가 아니라 Warning이다(§4).
const PATH_VARIANTS: Record<IcePath, string> = {
  direct: 'success',
  reflexive: 'info',
  relay: 'warning',
  loopback: 'neutral',
};

/**
 * 통화 아래 접이식 진단(시안 `Organism/Diagnostics`).
 *
 * **덮지 않고 민다**(plan/webrtc.md §4). 진단하려는 대상이 영상인데 그 위를 덮으면
 * 지표와 화면을 같이 볼 수 없다. 시트는 드래그 핸들·백드롭·스냅이 딸린 플랫폼 모양의
 * 새 컴포넌트라 iOS·Android에 각각 빚이 생긴다 — 접이식은 이미 세 번 만들어 본 모양이다.
 *
 * 절 순서는 **Quality · Connection · Settings · Signaling**: 지금 어떤가 → 왜 그런가 →
 * 바꿔 본다 → 무슨 일이 있었나. 데스크톱은 앞의 둘을 나란히 두고, 375에서는 1열로 쌓는다.
 */
export function Diagnostics({
  stats,
  connectedAtMs,
  isLoopback,
  log,
  onClearLog,
  icePolicy,
  onIcePolicy,
  cameras,
  microphones,
  cameraId,
  microphoneId,
  onSelectCamera,
  onSelectMicrophone,
}: {
  stats: CallStats | null;
  connectedAtMs: number | null;
  isLoopback: boolean;
  log: readonly SignalLogEntry[];
  onClearLog(): void;
  icePolicy: IcePolicy;
  onIcePolicy(policy: IcePolicy): void;
  cameras: MediaDeviceOption[];
  microphones: MediaDeviceOption[];
  cameraId: string | null;
  microphoneId: string | null;
  onSelectCamera(id: string): void;
  onSelectMicrophone(id: string): void;
}) {
  const { t } = useI18n();
  const isMobile = useMediaQuery('(max-width: 720px)');
  const [open, setOpen] = useState(false);

  const dash = t('webrtc.stat_unavailable');
  // 루프백은 소켓을 지나지 않으므로 경로가 후보 쌍이 아니라 **사실**로 정해진다.
  const path = isLoopback ? 'loopback' : stats?.path;

  return (
    <section className="diag">
      <button
        type="button"
        className="diag__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* 셰브런은 **펴지는 방향**을 가리키고 라벨 앞에 선다(시안 `Disclosure`). */}
        <span className="diag__chevron">
          <ChevronIcon up={open} />
        </span>
        <span className="diag__title">{t('webrtc.diagnostics')}</span>
        {/* 접혀 있어도 **요약을 보여준다** — 아무 말도 안 하면 열어 볼 이유를 화면이
            주지 못한다. 아직 연결이 없으면 옛 수치가 아니라 `—`다.
            데스크톱은 세 값(§4 `RTT 24 ms · ↑ 1.2 Mbps · relay`), 375는 두 값이다.
            **떨어져 나가는 쪽은 대역폭이지 경로가 아니다** — 이 슬라이스가 답하려는
            질문이 "직통인가 릴레이인가"이고, 순간 상행 대역폭은 그다음이다. 좁을 때는
            `RTT` 접두어도 뗀다(시안 `24 ms · relay`, 네이티브도 같다). */}
        <span className="diag__summary">
          {isMobile ? '' : 'RTT '}
          {stats?.rttMs === undefined ? dash : `${stats.rttMs} ms`}
          {isMobile ? '' : ` · ↑ ${bitrate(stats?.sendingKbps, dash)}`}
          {path ? ` · ${t(PATH_LABELS[path])}` : ''}
        </span>
        <span className="sr-only">
          {t(open ? 'webrtc.diag_hide' : 'webrtc.diag_show')}
        </span>
      </button>

      {open && (
        <div className="diag__body">
          <div className="diag__columns">
            <section className="diag__col">
              <h3 className="diag__section">{t('webrtc.diag_quality')}</h3>
              <dl className="diag__stats">
                <Stat label={t('webrtc.stat_rtt')} value={unit(stats?.rttMs, 'ms')} dash={dash} />
                <Stat label={t('webrtc.stat_jitter')} value={unit(stats?.jitterMs, 'ms')} dash={dash} />
                <Stat
                  label={t('webrtc.stat_packet_loss')}
                  value={unit(stats?.packetLossPct, '%')}
                  dash={dash}
                />
                <Stat
                  label={t('webrtc.stat_sending')}
                  value={stats?.sendingKbps === undefined ? undefined : bitrate(stats.sendingKbps, dash)}
                  dash={dash}
                />
                <Stat
                  label={t('webrtc.stat_receiving')}
                  value={stats?.receivingKbps === undefined ? undefined : bitrate(stats.receivingKbps, dash)}
                  dash={dash}
                />
                <Stat
                  label={t('webrtc.stat_video')}
                  value={
                    stats?.video &&
                    `${stats.video.width}×${stats.video.height}${
                      stats.video.fps === undefined ? '' : ` · ${stats.video.fps}`
                    }`
                  }
                  dash={dash}
                />
              </dl>
            </section>

            <section className="diag__col diag__col--connection">
              <h3 className="diag__section">{t('webrtc.diag_connection')}</h3>
              <dl className="diag__rows">
                <div className="diag__row">
                  <dt>{t('webrtc.ice_path')}</dt>
                  <dd>
                    {path ? (
                      <span className={`badge badge--${PATH_VARIANTS[path]}`}>
                        {t(PATH_LABELS[path])}
                      </span>
                    ) : (
                      <span className="diag__value">{dash}</span>
                    )}
                  </dd>
                </div>
                <Row
                  label={t('webrtc.ice_local')}
                  value={candidate(stats?.local, t('webrtc.ice_address_hidden'))}
                  dash={dash}
                />
                <Row
                  label={t('webrtc.ice_remote')}
                  value={candidate(stats?.remote, t('webrtc.ice_address_hidden'))}
                  dash={dash}
                />
                <Row label={t('webrtc.ice_state')} value={stats?.iceState} dash={dash} />
                <Row label={t('webrtc.dtls_state')} value={stats?.dtlsState} dash={dash} />
                <Row
                  label={t('webrtc.connected_for')}
                  value={connectedAtMs === null ? undefined : <Elapsed sinceMs={connectedAtMs} />}
                  dash={dash}
                />
              </dl>
            </section>
          </div>

          <hr className="diag__divider" />

          <section className="diag__col">
            <h3 className="diag__section">{t('webrtc.diag_settings')}</h3>
            <div className="diag__setting">
              <span className="diag__setting-label" id="ice-policy-label">
                {t('webrtc.ice_policy')}
              </span>
              <div
                className="diag__radios"
                role="radiogroup"
                aria-labelledby="ice-policy-label"
              >
                {(['all', 'relay'] as const).map((policy) => (
                  <label key={policy} className="diag__radio">
                    <input
                      type="radio"
                      name="ice-policy"
                      checked={icePolicy === policy}
                      onChange={() => onIcePolicy(policy)}
                    />
                    {t(policy === 'all' ? 'webrtc.ice_policy_all' : 'webrtc.ice_policy_relay')}
                  </label>
                ))}
              </div>
            </div>
            <div className="diag__setting">
              <span className="diag__setting-label">
                {`${t('webrtc.camera')} · ${t('webrtc.microphone')}`}
              </span>
              <div className="diag__selects">
                <DeviceSelect
                  label={t('webrtc.camera')}
                  options={cameras}
                  value={cameraId}
                  onChange={onSelectCamera}
                />
                <DeviceSelect
                  label={t('webrtc.microphone')}
                  options={microphones}
                  value={microphoneId}
                  onChange={onSelectMicrophone}
                />
              </div>
            </div>
            <p className="diag__note">{t('webrtc.ice_policy_note')}</p>
          </section>

          <hr className="diag__divider" />

          <section className="diag__col">
            <div className="diag__loghead">
              <h3 className="diag__section">{t('webrtc.diag_signaling')}</h3>
              <div className="diag__logactions">
                <button
                  type="button"
                  className="btn btn--ghost btn--compact"
                  // 사용자가 누를 때만 동작하고 **자동 전송은 없다**(§7).
                  onClick={() => void navigator.clipboard?.writeText(formatSignalLog(log))}
                  disabled={log.length === 0}
                >
                  {t('webrtc.log_copy')}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--compact"
                  onClick={onClearLog}
                  disabled={log.length === 0}
                >
                  {t('webrtc.log_clear')}
                </button>
              </div>
            </div>
            {/* 로그만 **내부 스크롤**을 갖는다(데스크톱 220 · 모바일 160) — 유일하게
                계속 자라는 영역이라 페이지를 밀어내지 않게 한다(§4). */}
            <div className="diag__log">
              {log.length === 0 ? (
                <p className="diag__empty">
                  {/* 루프백은 시그널링을 타지 않으므로 **비어 있는 것이 정상이다**(§4). */}
                  {t(isLoopback ? 'webrtc.log_loopback' : 'webrtc.log_empty')}
                </p>
              ) : (
                <ul className="diag__lines">
                  {log.map((entry) => (
                    <li
                      key={entry.id}
                      className={`logline${entry.isError ? ' logline--error' : ''}`}
                    >
                      <span className="logline__at">{stamp(entry.atMs, isMobile)}</span>
                      <span
                        className={`logline__dir${
                          entry.direction === 'sent' ? ' logline__dir--out' : ''
                        }`}
                      >
                        {entry.direction === 'sent' ? '→' : '←'}
                        <span className="sr-only">
                          {t(entry.direction === 'sent' ? 'webrtc.log_sent' : 'webrtc.log_received')}
                        </span>
                      </span>
                      <span className="logline__type">{entry.type}</span>
                      <span className="logline__detail">{entry.detail ?? ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  dash,
}: {
  label: string;
  value: string | undefined | false;
  dash: string;
}) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd className="stat__value">{value || dash}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  dash,
}: {
  label: string;
  value: ReactNode;
  dash: string;
}) {
  return (
    <div className="diag__row">
      <dt>{label}</dt>
      <dd className="diag__value">{value ?? dash}</dd>
    </div>
  );
}

/** 통화가 이어진 시간. **초 단위로만 센다** — 밀리초는 읽기 전에 바뀐다. */
function Elapsed({ sinceMs }: { sinceMs: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.floor((now - sinceMs) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return <>{`${mm}:${ss}`}</>;
}

function unit(value: number | undefined, suffix: string): string | undefined {
  return value === undefined ? undefined : `${value} ${suffix}`;
}

function bitrate(kbps: number | undefined, dash: string): string {
  if (kbps === undefined) return dash;
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
}

/** 후보는 **타입·전송까지만**. 주소는 마스킹한다(§7). */
function candidate(
  info: CandidateInfo | undefined,
  hidden: string,
): string | undefined {
  if (!info) return undefined;
  return [info.type, info.protocol, hidden].filter(Boolean).join(' · ');
}

// 375에서는 밀리초를 뺀다(`Atom/LogLine` `Compact=Yes`) — 초 단위로도 순서와 간격은 읽힌다.
function stamp(atMs: number, compact: boolean): string {
  const iso = new Date(atMs).toISOString();
  return compact ? iso.slice(11, 19) : iso.slice(11, 23);
}
