"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceRow } from "@/components/ui/form";

/**
 * A signed-in diver's "Use my trip credit" choice, when their balance covers
 * the full fare of the plain seat on the form (ADR 20261125-diver-sign-in).
 * The attempt id makes a resubmit of this form the same spend.
 */
export function TripCreditChoice({
  attemptId,
  balance,
  fare,
  checked,
  onChange,
}: {
  attemptId: string;
  balance: string;
  fare: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTranslations("booking");
  return (
    <div className="border-t border-border pt-4">
      <input type="hidden" name="tripCreditAttempt" value={attemptId} />
      <ChoiceRow
        type="checkbox"
        name="useTripCredit"
        value="on"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      >
        {t("useTripCredit")}
      </ChoiceRow>
      <p className="mt-1 text-base text-muted tabular-nums">
        {t("useTripCreditNote", { balance, fare })}
      </p>
    </div>
  );
}

/**
 * The form's action and the lines beside it: the button sized by the party,
 * not the boat's free seats (one diver reads "Book this seat", never "these
 * spots": fourth UX review item 7, H-20261014-seat-is-the-word), the checkout
 * hint when the submit goes on to pay, the cancellation window, and a refusal.
 */
export function BookingSubmit({
  payAtBooking,
  groupHold,
  usesCredit,
  course,
  remaining,
  partySize,
  terms,
  children,
}: {
  payAtBooking: boolean | "test-mode";
  groupHold: boolean;
  usesCredit: boolean;
  course: boolean;
  remaining: number;
  partySize: number;
  terms: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("booking");
  const checkout = Boolean(payAtBooking) && !groupHold && !usesCredit;
  const label = usesCredit
    ? t("bookWithTripCredit")
    : groupHold
      ? t("holdSeats")
      : course
        ? t(payAtBooking ? "enrollAndPay" : "enroll")
        : payAtBooking
          ? remaining === 1
            ? t("bookAndPayLastSeat")
            : t("bookAndPaySeats", { count: partySize })
          : remaining === 1
            ? t("bookLastSeat")
            : t("bookSeats", { count: partySize });
  return (
    <div className="mt-1">
      <SubmitButton
        pendingLabel={checkout ? t("headingToPayment") : t("booking")}
        className={buttonClass({ busy: true })}
      >
        {label}
      </SubmitButton>
      {/* Explain the external Stripe checkout before submission. */}
      {checkout ? (
        <p className="mt-2 text-xs text-muted">
          {t(payAtBooking === "test-mode" ? "stripeTestModeHint" : "stripeHint")}
        </p>
      ) : null}
      {!payAtBooking && !usesCredit ? (
        <p className="mt-2 text-sm text-muted">{t("payLater")}</p>
      ) : null}
      {/* The cancellation window stays directly beside the booking action. */}
      {terms}
      {/* Keep a booking refusal beside the action that produced it. */}
      {children}
    </div>
  );
}
