import { SelectMenu } from '../SelectMenu';
import type { MediaDeviceOption } from '../../lib/webrtc/media';

/**
 * 카메라·마이크 선택. 시안 `Molecule/Select`의 `Leading icon = false`다 — 바로 위(로비)
 * 또는 왼쪽(진단)에 이름표가 있어 글리프가 같은 말을 두 번 하게 된다.
 *
 * 로비와 진단 패널이 **같은 컴포넌트를 나눠 쓴다**: 장치를 바꾸는 일은 두 곳에서 같아야
 * 하고, 갈라 두면 한쪽만 고쳐지는 날이 온다.
 */
export function DeviceSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: MediaDeviceOption[];
  value: string | null;
  onChange(id: string): void;
}) {
  // 권한 전에는 목록이 비고 라벨도 없다 — 브라우저가 채워 주지 않는다. 그때는 **아무것도
  // 그리지 않는다**: 자리표시자를 두면 카메라·마이크 두 칸이 같은 문장을 되풀이하고,
  // 마이크 칸이 카메라 이야기를 하게 된다. 첫 통화 뒤에는 목록이 남아 그대로 보인다.
  if (options.length === 0) return null;
  const current = value ?? options[0]?.deviceId ?? '';
  return (
    <SelectMenu
      label={label}
      value={current}
      options={options.map((option, index) => ({
        value: option.deviceId,
        // 라벨이 비어 있으면(권한 직후의 짧은 창) 자리라도 지킨다.
        label: option.label || `${label} ${index + 1}`,
      }))}
      onChange={onChange}
    />
  );
}
