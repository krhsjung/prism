import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'prism:public';

// 인증 없이 열어둘 라우트에 붙인다.
//
// 기본을 "보호"로 두고 예외에 표시를 다는 방향이 반대보다 안전하다. 가드를 라우트마다
// 붙이는 방식에서는 **빠뜨린 라우트가 조용히 공개**되고, 그 사실이 코드에 드러나지도
// 않는다(리뷰에서 "없는 것"을 알아채야 한다). 이쪽은 반대로 공개가 눈에 보인다.
//
// @example
// ```typescript
// @Public()
// @Get('healthz')
// health() { ... }
// ```
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
