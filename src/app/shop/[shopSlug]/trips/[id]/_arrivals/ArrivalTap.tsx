"use client";

import { useOptimistic } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui/button";
import { RowActionForm } from "./RowActionForm";

type ArrivalAction = (formData: FormData) => Promise<{ ok: true }>;

/** Reversible check-in toggle on the roster row; blocked rows omit the action.
 * Check-in is optimistic, while boat roll call remains non-optimistic.
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
      // Check in is the row's one bordered button, as drawn (ADR
      // 20261117-trip-page-clock, `22-clock-checkin`); once tapped it turns into
      // the quiet green word and its drawn tick, which undoes it. 44px either way.
      className={
        checkedIn
          ? "-me-2 inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-lg px-2 text-base font-semibold whitespace-nowrap text-success transition-[background-color,transform] hover:bg-surface-sunken active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
          : buttonClass({
              variant: "secondary",
              size: "sm",
              className: "touch-manipulation whitespace-nowrap disabled:cursor-wait",
            })
      }
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
      ) : null}
    </button>
  );
}
