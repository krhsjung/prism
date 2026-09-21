import type { ComponentProps } from 'react';

type Variant =
  | 'primary'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'kakao'
  // 되돌릴 수 없는 동작(계정 삭제). 소프트 필 + error 색 — Secondary와 같은 무게로
  // 두되 색으로만 가른다. 빨간 덩어리가 화면을 지배하지 않게 한다(plan/auth.md §8-1).
  | 'destructive';

// `ComponentProps<'button'>`이라 `ref`도 그대로 받는다(React 19에서 ref는 평범한 prop이다)
// — 확인 창이 열릴 때 취소 버튼에 초점을 줘야 해서 필요하다.
interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
}

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonProps) {
  return <button className={`btn btn--${variant} ${className}`.trim()} {...rest} />;
}
