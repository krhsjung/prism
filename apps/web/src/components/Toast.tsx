import { useEffect } from 'react';

/**
 * 바닥에 잠깐 떠서 스스로 사라지는 한 줄 알림(시안 `Molecule/Toast`).
 *
 * 인라인 배너 대신 이것을 쓰는 이유는 **레이아웃을 건드리지 않기 때문**이다. 좁은 자리
 * (사이드바)에 문구를 펼치면 항목들이 밀려나며 화면이 흔들리고, 실패를 알리는 순간
 * 사용자의 눈은 방금 닫힌 확인 창이 있던 화면 가운데에 있다(plan/auth.md §8-1).
 *
 * `role="status"`이고 `aria-live="polite"`다 — 화면을 읽는 사람에게도 전해지되, 하던 일을
 * 끊지는 않는다. 오류지만 `alert`로 두지 않는 것은 사용자가 방금 누른 것의 **결과**라
 * 이미 주의가 거기 있기 때문이다.
 */
export function Toast({
  message,
  onDismiss,
  durationMs = 5000,
}: {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    // 문구가 바뀌면 타이머도 새로 시작한다 — 남은 시간을 물려받으면 두 번째 알림이
    // 첫 번째의 잔여 시간만큼만 보인다.
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [message, durationMs, onDismiss]);

  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
