import { useEffect, useId, useRef } from 'react';
import { Button } from '../Button';
import { DeviceIcon } from '../DeviceIcon';
import { DEVICE_LABELS } from '../../lib/devices';
import { useI18n } from '../../lib/i18n/i18n-context';
import type { SessionRef } from '../../lib/contracts.gen';

/**
 * 걸려 온 통화.
 *
 * **앱 어디에 있든 뜬다**(plan/webrtc.md §4) — 소켓이 이미 앱 전역에 붙어 있어서,
 * 대시보드를 보고 있어도 마찬가지다. `ConfirmDialog`와 같은 골격을 쓰는 것은 무게가
 * 같은 결정(받는다/거절한다)이기 때문이다.
 *
 * **자동 수락은 없다.** 내 기기라도 카메라가 말없이 켜지면 안 되고, 공유되는 데모
 * 계정에서는 더 그렇다(§7의 "getUserMedia는 명시적 사용자 제스처 후"와 같은 줄).
 *
 * 초점은 **거절**에서 시작한다 — 실수로 Enter를 눌렀을 때 카메라가 켜지면 안 된다.
 * (`ConfirmDialog`가 취소에서 시작하는 것과 같은 규칙이고, 여기서는 대가가 더 크다.)
 */
export function IncomingCallDialog({
  from,
  onAccept,
  onDecline,
}: {
  from: SessionRef;
  onAccept(): void;
  onDecline(): void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const bodyId = useId();
  const declineRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    declineRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onDecline();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDecline]);

  // 거는 쪽 이름은 **기기 종류**다. 계약에 그것밖에 없고, 그것으로 충분하다 — 내 기기니까.
  const device = t(DEVICE_LABELS[from.device]);

  return (
    // 바깥을 눌러도 닫히지 **않는다** — 확인 창과 다른 점이다. 통화는 상대가 기다리고
    // 있어서, 실수로 흘려보내면 그쪽이 45초를 다 쓴다.
    <div className="confirm-scrim">
      <div
        className="confirm incoming"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <span className="incoming__icon">
          <DeviceIcon device={from.device} className="icon" />
        </span>
        <h2 className="confirm__title" id={titleId}>
          {t('webrtc.incoming_title')}
        </h2>
        <p className="confirm__body" id={bodyId}>
          {t('webrtc.incoming_body', { device })}
        </p>
        <div className="confirm__actions">
          <Button
            ref={declineRef}
            variant="ghost"
            className="btn--compact"
            onClick={onDecline}
          >
            {t('webrtc.decline')}
          </Button>
          <Button variant="secondary" className="btn--compact" onClick={onAccept}>
            {t('webrtc.accept')}
          </Button>
        </div>
      </div>
    </div>
  );
}
