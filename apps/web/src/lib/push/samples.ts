/**
 * 알림에 바로 실어 볼 수 있는 샘플 이미지.
 *
 * **이 사이트가 서빙한다** — 리뷰어가 공개 이미지 주소를 따로 구해 오지 않아도 시연할
 * 수 있어야 하기 때문이다(plan/push.md §5-11). 업로드를 받지 않는 이유도 거기 있다:
 * 저장소가 생기면 "개인정보를 저장하지 않습니다"와 부딪힌다.
 *
 * ⚠️ **로컬 개발에서는 뜨지 않는다.** FCM이 이미지를 직접 내려받는데 `localhost`에는
 * 닿을 수 없다. 배포된 주소에서만 보인다.
 *
 * 이미지는 디자인 토큰 색으로 만든 그러데이션 카드다 — Figma 시안이 아니라 **자리표시자**라
 * 여기서 만든다. `swatch`는 고른 것을 표시하는 버튼의 색이고 같은 두 색을 쓴다.
 */
export const PUSH_SAMPLE_IMAGES: readonly {
  path: string;
  swatch: string;
}[] = [
  {
    path: '/push-samples/deep.png',
    swatch: 'linear-gradient(#1d3557, #4a78b8)',
  },
  {
    path: '/push-samples/calm.png',
    swatch: 'linear-gradient(#edf3fb, #4a78b8)',
  },
  {
    path: '/push-samples/green.png',
    swatch: 'linear-gradient(#4a9d6e, #1d3557)',
  },
];
