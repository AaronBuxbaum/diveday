"use client";

import { keepRentalFitAction } from "@/app/shop/[shopSlug]/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { SizedRentalKind } from "@/lib/rentals";

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
 * Every word arrives as a prop. Staff copy is resolved server-side and never
 * crosses to the client (`src/i18n/staff-messages.ts`).
 */
export function RentalFitKeepControl({
  personId,
  kind,
  size,
  label,
  pendingLabel,
}: {
  personId: string;
  kind: SizedRentalKind;
  size: string;
  label: string;
  pendingLabel: string;
}) {
  return (
    <form action={keepRentalFitAction.bind(null, personId, kind, size)}>
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
