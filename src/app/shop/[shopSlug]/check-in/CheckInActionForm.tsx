"use client";

import { useOptimistic } from "react";
import { QueueRowButton } from "./QueueRowButton";
import { RowActionForm } from "./RowActionForm";

type CheckInAction = (formData: FormData) => Promise<{ ok: true }>;

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
  className,
  children,
}: {
  action: CheckInAction;
  bookingId: string;
  /** What the row says when the tap did not send. Words come from the page. */
  sendFailedLabel: string;
  ariaLabel: string;
  trailing: React.ReactNode;
  pendingTrailing: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const [optimisticTrailing, setOptimisticTrailing] = useOptimistic(
    trailing,
    (_current, update: React.ReactNode) => update,
  );

  return (
    <RowActionForm
      action={action}
      sendFailedLabel={sendFailedLabel}
      onSubmitting={() => setOptimisticTrailing(pendingTrailing)}
      // The row's own padding rather than this form's default margin, so the
      // failure line lands exactly where it did before the reducer moved out.
      sendFailedClassName="px-4 pb-3 text-sm font-medium text-danger-strong sm:px-5"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <QueueRowButton
        ariaLabel={ariaLabel}
        className={className}
        trailing={optimisticTrailing}
        pendingTrailing={pendingTrailing}
      >
        {children}
      </QueueRowButton>
    </RowActionForm>
  );
}
