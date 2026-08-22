import type { ComponentProps } from 'react';

type Variant = 'primary' | 'outline' | 'secondary' | 'ghost' | 'kakao';

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
