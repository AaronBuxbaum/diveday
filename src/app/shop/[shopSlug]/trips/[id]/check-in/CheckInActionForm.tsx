"use client";

import { useOptimistic } from "react";
import { QueueRowButton } from "./QueueRowButton";
import { RowActionForm } from "./RowActionForm";

type CheckInAction = (formData: FormData) => Promise<{ ok: true }>;

/**
 * The tap is the row's whole box. `LedgerRow` keeps 8px of room around its
 * words; the form takes it back so the button's fill runs rule to rule, and the
 * button and the failure line keep it as padding, so both stay on the column
 * the row's words start on. The margin and the padding that cancels it are one
 * entry here, so they cannot disagree.
 *
 * **Beside a trailing action, the start side only** (dive-domain-expert review,
 * 2026-09-25). The checked-in row trails "Print a pass" a `gap-3` (12px) after
 * this tap. Taking the end's room back as well pushed the undo's fill 8px into
 * that gap and left 4px between two acts a wet-handed desk worker taps one
 * after the other. There the row's gap is the end's room, so the button draws
 * no end padding either.
 */
const ROW_ROOM = {
  alone: { form: "-mx-2", inset: "px-2" },
  besideTrailingAction: { form: "-ms-2", inset: "ps-2" },
} as const;

/**
 * Check-in is a high-frequency toggle, so a successful write refreshes the
 * server-rendered row in place. Keeping the action inside a client form with
 * `useOptimistic` lets the row respond instantaneously on tap (Principle 1),
 * while Next refreshes the data without redirecting the document to the top
 * of the queue.
 *
 * **Counter check-in is optimistic; roll call is strictly non-optimistic.**
 * At the front desk, counter check-in satisfies all three conditions of
 * Principle 1: it is reversible (has undo), it is local to this staff screen,
 * and it is high frequency. On the boat, roll call is non-optimistic: marking
 * a diver aboard without confirmed server/store commit is how a boat sails with
 * a ghost count.
 *
 * **This is the tap; the send's failure handling is `RowActionForm`.** That
 * reducer — and the reasoning about why a failed mutation must not take the
 * queue with it (issue #819) — used to live here, which is why it reached only
 * the one control it was written around. It is one component up now, so the
 * confirms and scripts on the same row post through it too (issue #1788). What
 * stays here is the optimistic badge, which is this control's own: the trailing
 * pill flips on tap and the form tells it when the send starts.
 */
export function CheckInActionForm({
  action,
  bookingId,
  sendFailedLabel,
  ariaLabel,
  trailing,
  pendingTrailing,
  rowHasTrailingAction = false,
  className = "",
  children,
}: {
  action: CheckInAction;
  bookingId: string;
  /** What the row says when the tap did not send. Words come from the page. */
  sendFailedLabel: string;
  ariaLabel: string;
  trailing: React.ReactNode;
  pendingTrailing: React.ReactNode;
  /**
   * The row draws an act of its own after this tap, in `LedgerRow`'s
   * `trailing` slot: the checked-in row's "Print a pass". The tap then takes
   * back only the start side of the row's room (`ROW_ROOM`).
   */
  rowHasTrailingAction?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [optimisticTrailing, setOptimisticTrailing] = useOptimistic(
    trailing,
    (_current, update: React.ReactNode) => update,
  );
  const room = rowHasTrailingAction ? ROW_ROOM.besideTrailingAction : ROW_ROOM.alone;

  return (
    <RowActionForm
      action={action}
      sendFailedLabel={sendFailedLabel}
      onSubmitting={() => setOptimisticTrailing(pendingTrailing)}
      className={room.form}
      sendFailedClassName={`${room.inset} pb-3 text-sm font-medium text-danger-strong`}
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <QueueRowButton
        ariaLabel={ariaLabel}
        className={`${room.inset} ${className}`.trim()}
        trailing={optimisticTrailing}
        pendingTrailing={pendingTrailing}
      >
        {children}
      </QueueRowButton>
    </RowActionForm>
  );
}
