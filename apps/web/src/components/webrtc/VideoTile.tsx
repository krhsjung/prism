import { useEffect, useRef, type ReactNode } from 'react';
import { MicOffIcon } from './CallIcons';

/**
 * 타일 안의 한 줄. **연결 상태 배지는 여기 있지 않다** — 그것은 통화의 상태이지 어느
 * 타일의 상태가 아니라서 카드 머리에 산다(plan/webrtc.md §4).
 *
 * `failed`가 없는 것도 결정이다: 실패 타일은 문구를 갖지 않는다. 배지가 이미
 * "Connection failed"라고 말하고 있고 자세한 사정은 notice의 `Alert`가 맡는다.
 */
export type TileState =
  | 'live'
  // 아직 카메라를 켜지 않았다 — **실패가 아니라 아직 묻지 않은 것**이다(`no-video`와 다르다).
  | 'idle'
  | 'ringing'
  | 'notified'
  | 'connecting'
  | 'reconnecting'
  | 'camera-off'
  | 'no-video';

export function VideoTile({
  stream,
  name,
  state,
  /** 셀프만 미러링한다 — 상대가 든 글씨가 뒤집히면 안 된다(§4). */
  mirrored = false,
  muted = false,
  /** 소리를 낼 것인가. **셀프 타일은 반드시 false다** — 아니면 하울링이 난다. */
  audible = false,
  message,
  /** 상태 줄 아래의 단 하나의 행동(호출 중의 `Cancel`, 실패의 `Try again`). */
  action,
  /** 화면 안에 겹쳐 놓는 작은 타일(모바일의 셀프 PiP). */
  pip = false,
}: {
  stream: MediaStream | null;
  name?: string;
  state: TileState;
  mirrored?: boolean;
  muted?: boolean;
  audible?: boolean;
  /** 상태 줄의 문구. 이미 번역해서 넘긴다. */
  message?: string;
  action?: ReactNode;
  pip?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // `srcObject`는 속성이 아니라 프로퍼티라 JSX로 넘길 수 없다.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);

  const showVideo = state === 'live' || state === 'reconnecting';

  return (
    <div
      className={`tile${pip ? ' tile--pip' : ''}${
        state === 'reconnecting' ? ' tile--dimmed' : ''
      }`}
    >
      <video
        ref={videoRef}
        className={`tile__video${mirrored ? ' tile__video--mirrored' : ''}`}
        // 자동 재생은 **음소거일 때만** 브라우저가 허용한다. 상대 타일은 소리를 내야
        // 하므로 muted를 걸지 않고, 대신 재생 시작이 사용자 제스처(Call/Accept) 뒤라
        // 정책에 걸리지 않는다.
        autoPlay
        playsInline
        muted={!audible}
        // 영상이 없을 때는 자리만 차지하고 상태 줄이 그 위에 온다.
        hidden={!showVideo}
      />
      {!showVideo && (
        <div className="tile__overlay">
          {message && (
            <p className="tile__state" role="status">
              {message}
            </p>
          )}
          {action}
        </div>
      )}
      {name && !pip && <span className="tile__name">{name}</span>}
      {muted && (
        <span className="tile__muted" title={name}>
          <MicOffIcon />
        </span>
      )}
    </div>
  );
}
