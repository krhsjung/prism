import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/Button';
import { CallControls } from '../components/webrtc/CallControls';
import { CallTargetList } from '../components/webrtc/CallTargetList';
import { DeviceSelect } from '../components/webrtc/DeviceSelect';
import { Diagnostics } from '../components/webrtc/Diagnostics';
import { VideoTile, type TileState } from '../components/webrtc/VideoTile';
import { api } from '../lib/api';
import { DEVICE_LABELS } from '../lib/devices';
import { useI18n } from '../lib/i18n/i18n-context';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useSessionSocket } from '../lib/session-socket-context';
import { useCall } from '../lib/webrtc/call-context';
import type { CallErrorCode, SessionListItem } from '../lib/contracts.gen';
import type { CallNotice, CallStatus } from '../lib/webrtc/call-context';
import type { MediaErrorKind } from '../lib/webrtc/media';
import type { MessageKey } from '../lib/i18n/messages.gen';

// 배지는 `Atom/Badge`의 **기존 여섯 변형을 그대로** 쓴다 — 새 변형 없음(plan/webrtc.md §4).
const STATUS: Record<CallStatus, { variant: string; key: MessageKey }> = {
  ringing: { variant: 'neutral', key: 'webrtc.status_ringing' },
  connecting: { variant: 'info', key: 'webrtc.status_connecting' },
  connected: { variant: 'success', key: 'webrtc.status_connected' },
  reconnecting: { variant: 'warning', key: 'webrtc.status_reconnecting' },
  failed: { variant: 'error', key: 'webrtc.status_failed' },
};

/**
 * 미디어를 얻지 못한 이유 → 문구와 **말투**.
 *
 * ⚠️ 넷이 다 빨강은 아니다. `not-found`는 **사용자가 만든 실패가 아니라** 기기의
 * 사실이고, 로비에 들어온 것만으로 알 수 있어서(누르기 전에 뜬다) 오류로 말하면
 * "뭔가 잘못했으니 고쳐라"로 읽힌다 — 고칠 것이 없는 사람에게는 틀린 말이다.
 * 나머지 셋은 사용자가 손댈 자리가 분명해서 그대로 오류다(§4의 Alert Info/Error).
 */
const MEDIA_ERRORS: Record<
  MediaErrorKind,
  { key: MessageKey; variant: 'error' | 'info' }
> = {
  denied: { key: 'error.camera_permission_denied', variant: 'error' },
  'not-found': { key: 'error.camera_not_found', variant: 'info' },
  unavailable: { key: 'error.camera_in_use', variant: 'error' },
  // 웹에만 있는 갈래다 — 브라우저가 안전한 컨텍스트가 아니면 미디어 API 자체를 주지
  // 않는다. 고칠 곳이 카메라가 아니라 **주소창**이라 문구도 그렇게 말한다.
  insecure: { key: 'error.camera_insecure', variant: 'error' },
};

/**
 * 타일에 얹는 짧은 한 줄. **알림과 달리 갈래마다 다르다.**
 *
 * 하나로 뭉쳐 두었더니 영어가 "No camera access"였다 — 장치가 아예 없는 기기에는
 * 접근 권한 이야기가 틀린 말이고, 사용자를 없는 권한 설정으로 보낸다. 타일은 좁아서
 * 이유를 다 담을 수 없으니 **알림이 설명하고 타일은 이름표만 단다.**
 */
const MEDIA_TILES: Record<MediaErrorKind, MessageKey> = {
  denied: 'webrtc.tile_camera_denied',
  'not-found': 'webrtc.tile_camera_missing',
  unavailable: 'webrtc.tile_camera_busy',
  insecure: 'webrtc.tile_camera_blocked',
};

/**
 * 1:1 통화 화면.
 *
 * 로비와 통화가 **한 카드**다. 방이 없으므로 "들어간다/나온다"가 없고, 통화가 끝나면
 * 같은 카드가 다시 로비가 된다 — 그래서 부재중 목록도 필요 없다: 주소록이 곧 그 화면이다
 * (plan/webrtc.md §4).
 */
export function WebRtcPage() {
  const { t } = useI18n();
  const isMobile = useMediaQuery('(max-width: 720px)');
  const { ready: socketReady, changed } = useSessionSocket();
  const {
    localStream,
    remoteStream,
    mediaError,
    micOn,
    cameraOn,
    toggleMic,
    toggleCamera,
    call,
    notice,
    stats,
    log,
    clearLog,
    icePolicy,
    setIcePolicy,
    cameras,
    microphones,
    cameraId,
    microphoneId,
    selectCamera,
    selectMicrophone,
    starting,
    startCall,
    startLoopback,
    startPreview,
    cancelCall,
    retryCall,
    hangUp,
  } = useCall();

  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const alive = useRef(true);
  // 요청은 마운트당 한 번만. StrictMode의 이중 마운트에서 두 번 나가지 않게 하고,
  // 효과의 setState를 조건부로 만든다(DashboardPage가 쓰는 가드와 같다).
  const started = useRef(false);
  const handled = useRef(changed);

  // 목록은 대시보드와 **같은 HTTP 경로**에서 온다(GET /auth/sessions) — 소켓은 신호만
  // 준다. 이 화면이 목록을 직접 주입받으면 스탬핑·회전 처리를 통째로 우회한다.
  const fetchSessions = useCallback(async (background = false) => {
    try {
      const list = await api.sessions(background);
      if (alive.current) setSessions(list);
    } catch {
      if (alive.current) setLoadFailed(true);
    }
  }, []);

  // **로비에서는 카메라를 열지 않는다.** 권한은 통화가 시작되는 순간에 묻고(`Call`·
  // `Accept`·`Test`), 끝나거나 화면을 벗어나면 놓는다 — 화면을 열어 둔 것만으로 카메라
  // 표시등이 켜져 있으면, 우리가 보고 있지 않다는 말을 화면이 증명하지 못한다.
  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true;
      void fetchSessions();
    }
    return () => {
      alive.current = false;
    };
  }, [fetchSessions]);

  useEffect(() => {
    if (changed === handled.current) return;
    handled.current = changed;
    void fetchSessions(true);
  }, [changed, fetchSessions]);

  const inCall = call !== null;
  const peerLabel = call?.isLoopback
    ? t('webrtc.loopback_peer')
    : call?.peer
      ? t(DEVICE_LABELS[call.peer.device])
      : '';

  // 카드 머리는 **지금 무엇을 하는 중인가**를 말한다. 붙은 뒤에는 부제를 두지 않는다 —
  // 상대가 누구인지는 타일의 이름표가 이미 말하고, 상태는 오른쪽 배지가 말한다(시안 Head).
  const heading = !inCall
    ? { title: t('webrtc.lobby_title'), desc: t('webrtc.lobby_desc') }
    : call.status === 'ringing'
      ? {
          title: t('webrtc.calling', { device: peerLabel }),
          desc: `${t('webrtc.ringing_desc')} ${t('webrtc.ring_timeout_note')}`,
        }
      : { title: t('webrtc.in_call'), desc: undefined };

  const controls = (
    <CallControls
      micOn={micOn}
      cameraOn={cameraOn}
      onToggleMic={toggleMic}
      onToggleCamera={toggleCamera}
      onHangUp={hangUp}
      // 로비에도, 호출 중에도 종료는 **없다** — 아직 통화가 아니고, 나가는 길은
      // 호출 중이라면 `Cancel` 하나여야 한다(§4).
      end={inCall && call.status !== 'ringing'}
    />
  );

  return (
    <AppShell page="webrtc">
      <section className="card callcard">
        <header className="callcard__head">
          <div>
            <h2 className="callcard__title">{heading.title}</h2>
            <p className="callcard__desc">{heading.desc}</p>
          </div>
          {call && (
            <span className={`badge badge--${STATUS[call.status].variant}`}>
              {t(STATUS[call.status].key)}
            </span>
          )}
        </header>

        {/* 알림 한 줄 — 거절·종료·오류·만료가 여기로 온다. 통화가 끝난 뒤 남는 것은
            이것뿐이고, 기록은 남기지 않는다(§2). */}
        {mediaError && (
          <div className="callcard__notice">
            {/* 말투에 따라 역할도 가른다 — 오류는 즉시 읽어 주고(assertive),
                기기의 사실은 흐름을 끊지 않고 알린다(polite). */}
            <div
              className={`alert alert--${MEDIA_ERRORS[mediaError].variant}`}
              role={MEDIA_ERRORS[mediaError].variant === 'error' ? 'alert' : 'status'}
            >
              {t(MEDIA_ERRORS[mediaError].key)}
            </div>
          </div>
        )}
        {notice && !mediaError && <Notice notice={notice} />}
        {loadFailed && (
          <div className="callcard__notice">
            <div className="alert alert--error" role="alert">
              {t('error.sessions_load_failed')}
            </div>
            <Button
              variant="outline"
              className="btn--compact"
              onClick={() => {
                setLoadFailed(false);
                void fetchSessions();
              }}
            >
              {t('common.retry')}
            </Button>
          </div>
        )}

        {inCall ? (
          // 통화 중: **판은 Surface, 타일은 Stage** — 판까지 어두우면 타일 경계가
          // 사라진다(§4). 피어가 왼쪽, 셀프가 오른쪽: 왼→오 읽기 순서에서 먼저 읽히는
          // 자리가 대화 상대여야 한다. 내 얼굴은 콘텐츠가 아니라 모니터다.
          <div className={`stage${isMobile ? ' stage--pip' : ''}`}>
            <VideoTile
              stream={remoteStream}
              name={peerLabel}
              state={peerTileState(call.status, remoteStream)}
              audible={!call.isLoopback}
              message={peerTileMessage(call.status, remoteStream, t)}
              action={
                // 타일의 행동은 **하나뿐이다** — 호출 중에는 `Cancel`, 실패에는
                // `Try again`. 실패에는 문구가 없으므로(§4) 이 버튼만 남는다.
                call.status === 'ringing' ? (
                  <Button
                    variant="outline"
                    className="btn--compact"
                    onClick={cancelCall}
                  >
                    {t('common.cancel')}
                  </Button>
                ) : call.status === 'failed' ? (
                  <Button
                    variant="outline"
                    className="btn--compact"
                    onClick={retryCall}
                  >
                    {t('common.retry')}
                  </Button>
                ) : undefined
              }
            />
            <VideoTile
              stream={localStream}
              name={t('webrtc.you')}
              state={selfTileState(cameraOn, localStream, mediaError)}
              mirrored
              muted={!micOn}
              message={selfTileMessage(cameraOn, localStream, mediaError, t)}
              pip={isMobile}
            />
          </div>
        ) : (
          // 로비: 프리뷰(컨트롤이 **타일 위에 얹힌다**) + 설정 열(카메라·마이크·기기 목록).
          <div className="callcard__body">
            <div className="preview">
              <VideoTile
                stream={localStream}
                name={t('webrtc.you')}
                state={selfTileState(cameraOn, localStream, mediaError)}
                mirrored
                muted={!micOn}
                message={selfTileMessage(cameraOn, localStream, mediaError, t)}
                // 미리 켜 보는 길. **자동으로는 켜지지 않는다** — 누르는 것이 곧 제스처다.
                // 아직 허용한 적이 없으면 이 버튼이 장치 이름을 얻는 유일한 길이기도 하다
                // (브라우저는 허용 뒤에야 이름을 준다).
                //
                // ⚠️ **실패한 뒤에도 남는다.** 오류 문구가 하나같이 "고치고 다시 시도해
                // 주세요"라고 말하는데(권한 허용·다른 앱 종료·장치 연결), 버튼을 치우면
                // 시도할 길이 새로고침밖에 없다. 브라우저가 한 번 거부를 기억한 오리진에서는
                // 첫 클릭이 곧바로 오류가 되므로, 그 자리가 그대로 막다른 길이 된다.
                //
                // 라벨은 **상태와 무관하게 하나다.** 실패 뒤에 `다시 시도`로 바꿔 달았더니
                // "되풀이하면 된다"는 약속이 됐는데, 네 갈래 중 둘(권한 거부·비보안)에서는
                // 눌러도 같은 오류가 즉시 돌아와 거짓이 된다. 이 버튼이 하는 일은 어느
                // 상태에서나 "카메라를 연다" 하나뿐이라, **동작을 그대로 이름으로 쓴다.**
                // 무엇이 잘못됐는지는 위의 알림과 타일 이름표가 이미 말하고 있다.
                action={
                  !localStream ? (
                    <Button
                      variant="outline"
                      className="btn--compact preview__start"
                      onClick={startPreview}
                    >
                      {t('webrtc.preview_start')}
                    </Button>
                  ) : undefined
                }
              />
              <div className="preview__controls">{controls}</div>
            </div>

            <div className="setup">
              {/* 장치 선택은 **고를 것이 생긴 뒤에** 나타난다. 권한을 통화 시작으로
                  미뤘으므로 첫 통화 전에는 브라우저가 목록도 이름도 주지 않는다 —
                  빈 셀렉트 위에 라벨만 띄우면 고칠 수 없는 빈 자리가 된다. */}
              {cameras.length > 0 && (
                <div className="setup__field">
                  <p className="setup__label">{t('webrtc.camera')}</p>
                  <DeviceSelect
                    label={t('webrtc.camera')}
                    options={cameras}
                    value={cameraId}
                    onChange={selectCamera}
                  />
                </div>
              )}
              {microphones.length > 0 && (
                <div className="setup__field">
                  <p className="setup__label">{t('webrtc.microphone')}</p>
                  <DeviceSelect
                    label={t('webrtc.microphone')}
                    options={microphones}
                    value={microphoneId}
                    onChange={selectMicrophone}
                  />
                </div>
              )}

              {sessions === null && !loadFailed && (
                <p className="setup__hint">{t('common.loading')}</p>
              )}
              {sessions && (
                <CallTargetList
                  sessions={sessions}
                  socketReady={socketReady}
                  busy={starting}
                  onCall={(session) =>
                    startCall({ id: session.id, device: session.device })
                  }
                  onLoopback={startLoopback}
                />
              )}
            </div>
          </div>
        )}

        {/* 통화 중에만 컨트롤이 제 줄을 갖는다 — 로비에서는 프리뷰 위에 얹혀 있다. */}
        {inCall && !isMobile && (
          <div className="callcard__controls">{controls}</div>
        )}

        {inCall && (
          <Diagnostics
            stats={stats}
            connectedAtMs={call.connectedAtMs}
            isLoopback={call.isLoopback}
            log={log}
            onClearLog={clearLog}
            icePolicy={icePolicy}
            onIcePolicy={setIcePolicy}
            cameras={cameras}
            microphones={microphones}
            cameraId={cameraId}
            microphoneId={microphoneId}
            onSelectCamera={selectCamera}
            onSelectMicrophone={selectMicrophone}
          />
        )}

        {/* 미디어가 서버를 지나지 않는 것이 이 슬라이스의 핵심이라 화면에도 한 줄로
            적는다 — 카드 바닥의 제 구획이다(시안 Foot). */}
        {!inCall && (
          <footer className="callcard__foot">{t('webrtc.p2p_note')}</footer>
        )}
      </section>

      {inCall && isMobile && <div className="callbar">{controls}</div>}
    </AppShell>
  );
}

/**
 * 로비에 남는 한 줄. 거절·상대 종료는 Info, 권한·통화 중·실패는 Error다(§4).
 *
 * **닫기 버튼을 두지 않는다.** 다시 걸 수 있는 목록이 바로 아래에 있고, 다음 통화를
 * 시작하면 사라진다 — 그것이 부재중 목록을 두지 않아도 되는 이유이기도 하다(§4).
 */
function Notice({ notice }: { notice: CallNotice }) {
  const { t } = useI18n();
  const { variant, text } = describe(notice, t);
  return (
    <div className="callcard__notice">
      <div className={`alert alert--${variant}`} role="status">
        {text}
      </div>
    </div>
  );
}

function describe(
  notice: CallNotice,
  t: (key: MessageKey, vars?: Record<string, string>) => string,
): { variant: 'info' | 'error'; text: string } {
  switch (notice.kind) {
    case 'declined':
      return { variant: 'info', text: t('webrtc.declined') };
    case 'ended':
      // 응답 없음만 오류다 — 사람이 끊은 것과 소켓이 사라진 것은 **그저 끝**이다.
      return notice.reason === 'timeout'
        ? { variant: 'error', text: t('error.no_answer') }
        : { variant: 'info', text: t('webrtc.peer_left') };
    case 'expired':
      return {
        variant: 'info',
        text: notice.from
          ? t('webrtc.expired_body', { device: t(DEVICE_LABELS[notice.from.device]) })
          : t('webrtc.expired_title'),
      };
    case 'error':
      return { variant: 'error', text: t(CALL_ERRORS[notice.code]) };
  }
}

// 계약의 유니온을 키로 쓴다 — 오류 코드가 늘면 여기서 컴파일이 걸린다.
const CALL_ERRORS: Record<CallErrorCode, MessageKey> = {
  unreachable: 'error.device_unreachable',
  busy: 'error.device_busy',
  'unknown-session': 'error.device_offline',
  // 루프백이 클라이언트 안에서 끝나므로 자기 자신을 소켓으로 부를 길은 없다 —
  // 여기까지 왔다면 우리 쪽 버그다.
  self: 'error.call_failed',
};

function selfTileState(
  cameraOn: boolean,
  stream: MediaStream | null,
  mediaError: MediaErrorKind | null,
): TileState {
  if (mediaError) return 'no-video';
  // 스트림이 없는 것은 **실패가 아니다** — 통화 전에는 열지 않기 때문이다.
  if (!stream) return 'idle';
  return cameraOn ? 'live' : 'camera-off';
}

function selfTileMessage(
  cameraOn: boolean,
  stream: MediaStream | null,
  mediaError: MediaErrorKind | null,
  t: (key: MessageKey) => string,
): string | undefined {
  if (mediaError) return t(MEDIA_TILES[mediaError]);
  if (!stream) return t('webrtc.tile_camera_idle');
  return cameraOn ? undefined : t('webrtc.tile_camera_off');
}

function peerTileState(status: CallStatus, stream: MediaStream | null): TileState {
  if (status === 'ringing') return 'ringing';
  if (status === 'reconnecting') return 'reconnecting';
  if (!stream) return 'connecting';
  return status === 'connected' ? 'live' : 'connecting';
}

function peerTileMessage(
  status: CallStatus,
  stream: MediaStream | null,
  t: (key: MessageKey) => string,
): string | undefined {
  if (status === 'ringing') return t('webrtc.tile_ringing');
  if (status === 'reconnecting') return t('webrtc.tile_reconnecting');
  // 실패 타일은 **문구를 갖지 않는다** — 배지가 이미 그 말을 한다(§4).
  if (status === 'failed') return undefined;
  return stream ? undefined : t('webrtc.tile_connecting');
}
