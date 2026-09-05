import { useI18n } from '../../lib/i18n/i18n-context';
import {
  CameraIcon,
  CameraOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
} from './CallIcons';

/**
 * 음소거 · 카메라 · 종료.
 *
 * **빨강은 종료에만 쓴다**(plan/webrtc.md §4). 음소거를 빨강으로 칠하는 관행이 있지만
 * 그러면 화면에 빨간 원이 둘 생기고 **되돌릴 수 있는 것과 없는 것**이 같은 색이 된다.
 * 꺼짐은 `Warning`(내가 지금 꺼 두었다는 알림), 종료는 `Destructive`.
 *
 * **보이는 라벨을 두지 않고 접근성 이름만 둔다** — 세 글리프는 관습이 굳었고, 라벨을
 * 달면 바 폭이 세 배가 되며 ko·ja에서 줄바꿈된다. "터치엔 hover가 없다"는 대시보드
 * 규칙에 대한 의식적 예외다.
 */
export function CallControls({
  micOn,
  cameraOn,
  onToggleMic,
  onToggleCamera,
  onHangUp,
  /**
   * 종료 버튼을 둘 것인가(시안 `Molecule/CallControls`의 `End` 불리언).
   *
   * 로비와 호출 중에는 **없앤다** — 끄는 것이 아니다. 아직 통화가 아니고, 나가는 길은
   * 호출 중이라면 `Cancel` 하나여야 한다. 흐린 빨간 원을 남기면 누를 수 있는 것처럼
   * 보이고, 무대 위에 빨강이 하나 더 생긴다.
   */
  end = true,
}: {
  micOn: boolean;
  cameraOn: boolean;
  onToggleMic(): void;
  onToggleCamera(): void;
  onHangUp(): void;
  end?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="callctl">
      <div className="callctl__toggles">
        <button
          type="button"
          className={`callctl__btn${micOn ? '' : ' callctl__btn--warning'}`}
          aria-label={t(micOn ? 'webrtc.mute' : 'webrtc.unmute')}
          aria-pressed={!micOn}
          onClick={onToggleMic}
        >
          {micOn ? <MicIcon /> : <MicOffIcon />}
        </button>
        <button
          type="button"
          className={`callctl__btn${cameraOn ? '' : ' callctl__btn--warning'}`}
          aria-label={t(cameraOn ? 'webrtc.camera_off' : 'webrtc.camera_on')}
          aria-pressed={!cameraOn}
          onClick={onToggleCamera}
        >
          {cameraOn ? <CameraIcon /> : <CameraOffIcon />}
        </button>
      </div>
      {/* 종료 앞의 여백은 **안전 여백**이다 — 되돌릴 수 없는 버튼이 반복 조작하는
          버튼에 이어 붙으면 오탭이 생긴다(대시보드가 "모두 로그아웃"을 `Revoke`
          기둥에 붙이지 않은 것과 같은 규칙). */}
      {end && (
        <button
          type="button"
          className="callctl__btn callctl__btn--end"
          aria-label={t('webrtc.end_call')}
          onClick={onHangUp}
        >
          <PhoneOffIcon />
        </button>
      )}
    </div>
  );
}
