import { useId } from 'react';
import { useI18n } from '../../lib/i18n/i18n-context';
import type { IcePolicy } from '../../lib/webrtc/call-context';

/**
 * 경로를 고르는 라디오 한 벌 — **로비와 진단 패널이 같은 것을 쓴다**(plan/webrtc.md §4).
 *
 * 두 자리에 두는 이유는 묻는 것이 다르기 때문이다: 로비에서는 "이번 통화를 어느 경로로
 * 걸까"이고, 통화 중에는 "지금 경로를 바꿔 보자"다. 뒤쪽을 없애면 `TURN만 사용`이 `Path`를
 * 즉시 `Relayed`로 바꾸는 것을 보여 줄 자리가 사라지고, 앞쪽이 없으면 벨이 울린 **뒤에야**
 * 경로를 고를 수 있다.
 *
 * 값은 한 벌이다(컨트롤러가 들고 있다) — 어느 쪽에서 바꾸든 다음 연결이 그 값으로 선다.
 */
export function IcePolicyChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: IcePolicy;
  onChange(policy: IcePolicy): void;
  /** 통화가 서는 중에는 잠근다 — 협상 도중의 전환은 되돌릴 자리가 애매하다. */
  disabled?: boolean;
}) {
  const { t } = useI18n();
  // 두 자리에 동시에 그려질 수 있어 `name`이 겹치면 안 된다 — 겹치면 두 벌의 라디오가
  // 한 그룹으로 묶여 한쪽을 고르는 순간 다른 쪽이 풀린다.
  const group = useId();
  return (
    <div className="radios" role="radiogroup" aria-label={t('webrtc.ice_policy')}>
      {(['all', 'relay'] as const).map((policy) => (
        <label key={policy} className="radio">
          <input
            type="radio"
            name={group}
            checked={value === policy}
            disabled={disabled}
            onChange={() => onChange(policy)}
          />
          {t(policy === 'all' ? 'webrtc.ice_policy_all' : 'webrtc.ice_policy_relay')}
        </label>
      ))}
    </div>
  );
}
