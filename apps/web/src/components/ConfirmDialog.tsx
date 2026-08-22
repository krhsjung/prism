import { useEffect, useId, useRef } from 'react';
import { Button } from './Button';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  // 진행 중에는 두 번 눌리지 않게 잠근다 — 되돌릴 수 없는 동작이라 중복 호출이 곧 손해다.
  isBusy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * 되돌릴 수 없는 동작 앞에 세우는 확인 창.
 *
 * 시스템 `confirm()`이나 `<dialog>` 기본 모양을 쓰지 않는다 — 브라우저마다 껍데기가 달라
 * 세 플랫폼을 나란히 놓으면 여기서만 튄다(선택 메뉴를 직접 그리는 것과 같은 이유).
 *
 * 초점은 **취소**에서 시작한다. 실수로 Enter를 눌렀을 때 벌어지는 일이 "아무 일도 없음"
 * 이어야 하기 때문이다.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  isBusy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="confirm-scrim"
      // 바깥을 눌러도 닫힌다 — 다만 창 안을 누른 것이 새어 나가지 않게 막는다.
      onClick={onCancel}
    >
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="confirm__title" id={titleId}>
          {title}
        </h2>
        <p className="confirm__body" id={bodyId}>
          {body}
        </p>
        <div className="confirm__actions">
          <Button
            ref={cancelRef}
            variant="ghost"
            className="btn--compact"
            onClick={onCancel}
            disabled={isBusy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="secondary"
            className="btn--compact"
            onClick={onConfirm}
            disabled={isBusy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
