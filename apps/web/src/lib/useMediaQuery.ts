import { useCallback, useSyncExternalStore } from 'react';

/**
 * CSS 미디어 쿼리를 리액트 상태로 읽는다.
 *
 * 배치가 폭에 따라 **부모가 달라지는** 경우에만 쓴다 — 색·간격처럼 같은 자리에서
 * 값만 바뀌는 것은 CSS가 해야 한다(여기서 하면 첫 페인트가 한 박자 늦는다).
 * 대시보드 상단 바의 컨트롤은 모바일에서 드로어 **안쪽으로 옮겨 가므로**, CSS로는
 * 표현할 수 없어(부모를 바꿀 수 없다) 이 훅이 필요하다. 양쪽에 두고 하나를 숨기는
 * 방법도 있지만, 그러면 같은 컨트롤이 DOM에 둘이 되어 초점·리스너가 이중이 된다.
 *
 * 구독을 이펙트로 직접 걸지 않고 [useSyncExternalStore]에 맡긴다 — 렌더와 구독 사이에
 * 폭이 바뀌면 그 `change` 이벤트는 아무도 듣지 못하는데, 이 훅은 구독 직후 스냅샷을
 * 다시 읽어 그 틈을 스스로 메운다(이펙트 안에서 setState 하는 방식은 같은 문제를
 * 손으로 메우게 되고, 연쇄 렌더를 부른다).
 *
 * `matchMedia`가 없는 환경(테스트 런타임 등)에서는 `false`로 둔다 — 폭을 모를 때는
 * 넓은 쪽 배치가 안전하다(`theme.ts`·`oauth-popup.ts`와 같은 가드).
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
