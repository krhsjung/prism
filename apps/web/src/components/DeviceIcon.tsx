import { DEVICE_SHAPES } from '../lib/devices';
import type { DeviceKind } from '../lib/contracts.gen';

/**
 * 기기 종류별 아이콘. 브랜드 로고를 쓰지 않는다 — 상표를 앱에 심는 일이고, 목록에서
 * 필요한 것은 "폰인가 태블릿인가 데스크톱인가"라는 형태 구분뿐이다. `unknown`은 모니터를
 * 재사용한다: 모르는 것에 특별한 그림을 주면 그 자체가 하나의 상태처럼 읽힌다.
 */
export function DeviceIcon({
  device,
  className = 'icon session__glyph',
}: {
  device: DeviceKind;
  className?: string;
}) {
  const shape = DEVICE_SHAPES[device];
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {shape === 'phone' ? (
        <>
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <path d="M11 18h2" />
        </>
      ) : shape === 'tablet' ? (
        <>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <path d="M11 18h2" />
        </>
      ) : (
        <>
          <path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1" />
          <path d="M12 16v4" />
          <path d="M8 20h8" />
        </>
      )}
    </svg>
  );
}
