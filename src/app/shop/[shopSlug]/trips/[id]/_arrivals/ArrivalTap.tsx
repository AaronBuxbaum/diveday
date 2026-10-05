"use client";

import { useOptimistic } from "react";
import { useFormStatus } from "react-dom";
import { RowActionForm } from "./RowActionForm";

type ArrivalAction = (formData: FormData) => Promise<{ ok: true }>;

/**
 * **The desk's one tap, on the roster row** (owner, 2026-10-05: the Divers and
 * Check-in tabs were one list drawn twice). Once arrivals open, a cleared
 * diver's row on the Divers tab ends in this control; a checked-in diver's row
 * ends in the same control in its other state, and tapping it again undoes the
 * arrival (design principle 7 — a high-frequency toggle gets re-tap undo, never
 * a blocking confirm).
 *
 * **Optimistic, like the counter it replaces.** Check-in is reversible, local to
 * this screen and repeated all morning, so the word flips on the tap and the
 * server render settles the row into its group behind it. The roll call is the
 * opposite case and stays strictly non-optimistic on the Boat tab.
 *
 * A blocked row never draws this: readiness is the gate, and a tap beside the
 * reasons would be offering an act the server refuses.
 */
export function ArrivalTap({
  action,
  bookingId,
  checkedIn,
  label,
  pendingLabel,
  ariaLabel,
  sendFailedLabel,
}: {
  action: ArrivalAction;
  bookingId: string;
  /** Which half of the toggle this is: arrived (the tap undoes) or not yet. */
  checkedIn: boolean;
  label: string;
  pendingLabel: string;
  /** Names the diver: one row's tap must not read like the next row's. */
  ariaLabel: string;
  sendFailedLabel: string;
}) {
  const [optimisticPending, setOptimisticPending] = useOptimistic(
    false,
    (_current, next: boolean) => next,
  );
  return (
    <RowActionForm
      action={action}
      sendFailedLabel={sendFailedLabel}
      onSubmitting={() => setOptimisticPending(true)}
      className="flex flex-col items-end"
      sendFailedClassName="mt-1 text-sm font-medium text-danger-strong"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <TapButton
        checkedIn={checkedIn}
        label={label}
        pendingLabel={pendingLabel}
        ariaLabel={ariaLabel}
        optimisticPending={optimisticPending}
      />
    </RowActionForm>
  );
}

function TapButton({
  checkedIn,
  label,
  pendingLabel,
  ariaLabel,
  optimisticPending,
}: {
  checkedIn: boolean;
  label: string;
  pendingLabel: string;
  ariaLabel: string;
  optimisticPending: boolean;
}) {
  const { pending } = useFormStatus();
  const busy = pending || optimisticPending;
  return (
    <button
      type="submit"
      aria-label={ariaLabel}
      disabled={busy}
      data-arrival-tap={checkedIn ? "undo" : "check-in"}
      // 44px tall, the dock test's floor, and the word and its drawn circle in
      // one target: the empty circle is the roll call's own "waiting to be
      // ticked", so the row reads as a checklist line, not a link.
      className={`-me-2 inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-lg px-2 text-base font-semibold whitespace-nowrap transition-[background-color,transform] hover:bg-surface-sunken active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 ${
        checkedIn ? "text-success" : "text-primary"
      }`}
    >
      <span>{busy ? pendingLabel : label}</span>
      {checkedIn ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="m7.5 12.5 3 3 6-6.5" />
        </svg>
      ) : (
        <span
          aria-hidden="true"
          className={`size-6 rounded-full border-2 border-current ${busy ? "opacity-40" : ""}`}
        />
      )}
    </button>
  );
}
