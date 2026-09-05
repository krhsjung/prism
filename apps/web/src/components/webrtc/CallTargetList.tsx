import { Fragment } from 'react';
import { Button } from '../Button';
import { DeviceIcon } from '../DeviceIcon';
import { DEVICE_LABELS } from '../../lib/devices';
import { useI18n } from '../../lib/i18n/i18n-context';
import type { SessionListItem } from '../../lib/contracts.gen';

/**
 * 로비의 **내 기기 목록**(시안 `Molecule/CallTarget` × `Organism` 리스트).
 *
 * 코드 입력란이 있던 자리다(plan/webrtc.md §4). 방 코드를 사람이 짓거나 받아 적는 대신
 * **이미 인증된 내 세션**을 고른다. 대시보드가 그리는 목록과 같은 데이터·같은 행
 * 구성이고, 기기명·브라우저·위치를 담지 않는 이유도 그대로 물려받는다.
 *
 * 목록은 **테두리 하나에 구분선으로 나뉜 한 판**이다 — 행마다 카드를 주면 기기 수만큼
 * 상자가 생겨 목록이 아니라 카드 더미로 읽힌다(시안 `List`).
 *
 * **닿지 않는 줄만 버튼을 잃는다.** 회색 버튼을 남기면 눌러 볼 수 있는 것처럼 보이고,
 * 벨이 끝날 때까지 기다린 뒤에야 이유를 알게 된다.
 */
export function CallTargetList({
  sessions,
  socketReady,
  busy,
  onCall,
  onLoopback,
}: {
  sessions: SessionListItem[];
  /** 내 소켓이 붙어 있는가. 아니면 **아무도 부를 수 없다** — 시그널링이 이 소켓뿐이다. */
  socketReady: boolean;
  /** 통화 중이면 목록 전체를 잠근다 — 서버도 세션당 한 통화만 허락한다. */
  busy: boolean;
  onCall(session: SessionListItem): void;
  onLoopback(): void;
}) {
  const { t } = useI18n();
  const current = sessions.find((session) => session.isCurrent);
  const others = sessions.filter((session) => !session.isCurrent);

  return (
    <div className="setup__field">
      <p className="setup__label">{t('webrtc.devices')}</p>
      <p className="setup__hint">{t('webrtc.devices_desc')}</p>

      <ul className="targets">
        {current && (
          <li className="target">
            <span className="target__chip">
              <DeviceIcon device={current.device} className="icon" />
            </span>
            <span className="target__label">
              {t('webrtc.this_tab')}
              <span className="target__sub">{t('webrtc.loopback')}</span>
            </span>
            {/* 현재 세션 줄만 할 수 있는 일이 있다 — 대시보드에서는 `Revoke`를 갖지
                않는 그 줄이 여기서는 **루프백 시험**이다(§4). */}
            <Button
              variant="outline"
              className="btn--compact target__action"
              disabled={busy}
              onClick={onLoopback}
            >
              {t('webrtc.test')}
            </Button>
          </li>
        )}

        {others.map((session) => {
          // 소켓이 없으면 서버가 `unreachable`로 거절한다. 푸시로 깨우는 경로는
          // push 슬라이스와 함께 붙고(§8-11), 그때까지 이 줄은 알림이 꺼진 줄이다.
          const reachable = socketReady && session.isConnected;
          return (
            <Fragment key={session.id}>
              <li className="targets__divider" aria-hidden="true" />
              <li className={`target${reachable ? '' : ' target--muted'}`}>
                <span className="target__chip">
                  <DeviceIcon device={session.device} className="icon" />
                </span>
                <span className="target__label">
                  {t(DEVICE_LABELS[session.device])}
                  <span className="target__sub target__sub--code">
                    #{session.id.slice(0, 8)}
                  </span>
                </span>
                {reachable ? (
                  <Button
                    variant="secondary"
                    className="btn--compact target__action"
                    disabled={busy}
                    // 목록에 `Call`이 여럿이라 버튼 글자만으로는 무엇에 거는지 알 수 없다.
                    aria-label={`${t('webrtc.call')}: ${t(
                      DEVICE_LABELS[session.device],
                    )} · #${session.id.slice(0, 8)}`}
                    onClick={() => onCall(session)}
                  >
                    {t('webrtc.call')}
                  </Button>
                ) : (
                  <span className="badge badge--neutral">
                    {t('webrtc.notifications_off')}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ul>

      {/* 목록이 비면 빈 상태 대신 **다음에 할 일**을 적는다(§4). */}
      {others.length === 0 && (
        <p className="setup__hint setup__hint--after">
          {t('webrtc.no_other_devices')}
        </p>
      )}
    </div>
  );
}
