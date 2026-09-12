"use client";

import { keepRentalFitAction } from "@/app/shop/[shopSlug]/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

/**
 * **"Keep it"** — the evening's one tap on a size the day already proved
 * (issue #1174, delight report D14; ADR 20260904-reef-all-the-way-down, slice
 * 16h).
 *
 * The desk confirmed a `fit_adjusted` return at the counter, so the fact is
 * already recorded; this only asks whether to keep it as the diver's fit. It
 * posts in place rather than navigating, the shape `WaiverSendControl` and
 * `ResendConfirmationControl` already set, and the row's own Dismiss stands
 * beside it — which is the other honest answer, and the one that costs
 * nothing.
 *
 * The tap names the reservation and nothing else. The diver and the size are
 * not the client's to supply: the action re-proves both from the desk's own
 * `fit_adjusted` return, because this control is open to every staff role on
 * the strength of writing down what a human already decided, and a bound size
 * would have let a crew member rewrite any diver's stated fit instead
 * (`security-reviewer`, issue #1453).
 *
 * Every word arrives as a prop. Staff copy is resolved server-side and never
 * crosses to the client (`src/i18n/staff-messages.ts`).
 */
export function RentalFitKeepControl({
  reservationId,
  label,
  pendingLabel,
}: {
  reservationId: string;
  label: string;
  pendingLabel: string;
}) {
  return (
    <form action={keepRentalFitAction.bind(null, reservationId)}>
      <SubmitButton
        pendingLabel={pendingLabel}
        className={buttonClass({ variant: "secondary", size: "sm" })}
        observabilityAction="rental-fit-keep"
      >
        {label}
      </SubmitButton>
    </form>
  );
}
