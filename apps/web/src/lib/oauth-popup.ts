import { decodeOAuthPopupMessage, type JsonValue } from './contracts.gen';

// popup 흐름의 결과. error가 없는 실패는 사용자 취소(창을 닫음 등) — 알림 없이 복귀한다.
export interface OAuthPopupResult {
  ok: boolean;
  error?: string;
}

export interface OAuthPopupHandle {
  result: Promise<OAuthPopupResult>;
  // 화면을 떠날 때 리스너·타이머를 정리하고 창을 닫는다.
  cancel(): void;
}

const POPUP_SIZE = { width: 480, height: 640 };

// 사용자가 창을 그냥 닫은 경우엔 메시지가 오지 않으므로 주기적으로 확인해야 한다.
const CLOSED_POLL_MS = 400;

// 창이 닫힌 것을 감지해도 곧바로 취소로 단정하지 않는다. 서버 콜백 페이지는
// postMessage 직후 window.close()를 부르므로, 메시지가 배달되기 전에 닫힘이 먼저
// 관측될 수 있다 — 그 짧은 창을 두고 기다렸다가 아무것도 안 오면 취소로 본다.
const CLOSE_GRACE_MS = 250;

// 전체 상한. 서버 state의 수명(10분)과 맞춘다 — 그 뒤엔 콜백이 성공할 수 없으므로
// 더 기다릴 이유가 없다. 이게 없으면 provider 페이지가 멈추거나 popup.closed 접근이
// 막히는 환경에서 로그인 버튼이 영원히 잠긴 채로 남는다.
const OVERALL_TIMEOUT_MS = 10 * 60 * 1000;

// 데스크톱에서만 popup을 쓴다 — 모바일 브라우저는 popup을 새 탭으로 열거나 막아버려
// redirect가 더 낫다. matchMedia가 없는 환경(테스트 등)은 보수적으로 redirect.
export function prefersPopup(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(min-width: 768px) and (pointer: fine)').matches;
}

// OAuth를 팝업으로 시작한다. 팝업이 차단되면 null — 호출부가 redirect로 폴백한다.
export function openOAuthPopup(
  url: string,
  apiOrigin: string,
): OAuthPopupHandle | null {
  const { width, height } = POPUP_SIZE;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  const popup = window.open(
    url,
    'prism-oauth',
    `width=${width},height=${height},left=${left},top=${top}`,
  );
  if (!popup) return null;

  const controller = new AbortController();
  let poll: number | undefined;
  let grace: number | undefined;
  let deadline: number | undefined;
  let settled = false;

  const cleanup = () => {
    controller.abort();
    if (poll !== undefined) window.clearInterval(poll);
    if (grace !== undefined) window.clearTimeout(grace);
    if (deadline !== undefined) window.clearTimeout(deadline);
    poll = grace = deadline = undefined;
  };

  const result = new Promise<OAuthPopupResult>((resolve) => {
    const settle = (value: OAuthPopupResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    window.addEventListener(
      'message',
      (e: MessageEvent) => {
        // 발신 출처 검증 — 이게 없으면 아무 사이트나 로그인 성공을 위조할 수 있다.
        if (e.origin !== apiOrigin) return;
        // 우리가 연 바로 그 창에서 온 것인지까지 확인한다. null을 예외로 허용하면
        // "origin + source" 보장이 origin 하나로 줄어들므로 예외를 두지 않는다.
        if (e.source !== popup) return;
        // MessageEvent.data는 임의의 값 — 계약 디코더를 통과한 것만 받아들인다.
        const data: JsonValue = e.data;
        const message = decodeOAuthPopupMessage(data);
        if (!message) return;

        settle({ ok: message.ok, error: message.error });
        try {
          popup.close();
        } catch {
          /* 이미 닫혔거나 접근이 막힘 */
        }
      },
      { signal: controller.signal },
    );

    // 사용자가 창을 닫으면 코드 없는 실패(취소)로 본다.
    // 단, 배달 중인 메시지가 있을 수 있으므로 유예를 둔 뒤에 확정한다.
    poll = window.setInterval(() => {
      try {
        if (!popup.closed || grace !== undefined) return;
        grace = window.setTimeout(() => settle({ ok: false }), CLOSE_GRACE_MS);
      } catch {
        /* COOP 정책으로 closed 접근이 차단될 수 있다 — 메시지를 계속 기다린다 */
      }
    }, CLOSED_POLL_MS);

    // 아무 신호도 오지 않는 경우의 최후 방어.
    deadline = window.setTimeout(
      () => settle({ ok: false }),
      OVERALL_TIMEOUT_MS,
    );
  });

  return {
    result,
    cancel: () => {
      cleanup();
      try {
        popup.close();
      } catch {
        /* 이미 닫힘 */
      }
    },
  };
}
