"use client";

import { useOptimistic, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { ForgivingCopy } from "@/components/ui/ForgivingInput";
import { ChoiceFieldset, ChoicePill, controlClass, PriceField } from "@/components/ui/form";
import {
  MANUAL_PAYMENT_METHODS,
  type ManualPaymentMethodCode,
  type MarkRetry,
} from "@/lib/payment-marks";

/**
 * Every value the column can hold — which is not the same as every value this
 * control may *set*. `partly_refunded` is here so a seat that reached it
 * through an actual Stripe partial refund still shows its own word in the
 * select (the filter below always keeps the current status), and it is
 * deliberately absent from `PAYMENT_STATUSES_ALL` in `RosterSection`, because
 * no amount of hand-setting a dropdown moves money (issue #699).
 */
export type PaymentStatus =
  | "unpaid"
  | "deposit_paid"
  | "paid"
  | "partly_refunded"
  | "waived"
  | "refunded";

/** Every word this client component renders, resolved on the server — see the
 * note in src/i18n/staff-messages.ts. */
export type PaymentStatusControlCopy = {
  prefix: string;
  /**
   * The select's accessible name ("Payment status"). The visible prefix beside
   * it reads as a sentence with the current status, not as the select's label.
   */
  label: string;
  statuses: Record<PaymentStatus, string>;
  update: string;
  updating: string;
  /** The Paid mark's two questions (batch 6 item 1): how much, and how. */
  amountLabel: string;
  methodLabel: string;
  methods: Record<ManualPaymentMethodCode, string>;
  forgiving: ForgivingCopy;
};

/** The statuses a hand mark attaches money to; picking one opens the Paid mark. */
const MONEY_STATUSES: readonly PaymentStatus[] = ["paid", "deposit_paid"];

/**
 * What the Paid mark opens holding: the seat's balance in the shop's currency,
 * so the usual fare is one tap. Left blank, the mark records no money, which
 * is a free seat by another name: `markPaymentAction` takes it only from
 * someone with the write-off right and asks anyone else for the amount.
 */
export type PaymentMarkDefaults = {
  amountCents: number | null;
  currency: string;
  locale: string;
  /** "Balance owed: $70" beside the amount, on a deposit-paid seat. */
  balanceHint?: string | null;
  /**
   * The seat was paid online or from a package. Its row points at the payment
   * a refund or a release reverses, and `markPaymentAction` refuses any hand
   * mark on it, so the picker offers nothing but the seat's own status.
   */
  handMarkRefused?: boolean;
  /**
   * The mark the server just refused (issue #2607): the status picked, the
   * amount typed and the method chosen, so the sheet reopens holding them
   * instead of empty. Absent on every other render.
   */
  retry?: MarkRetry | null;
};

/**
 * Payment status with a true optimistic path: picking a new status flips the
 * "Payment:" face instantly via useOptimistic, then reconciles when the server
 * action returns (which revalidates the real value). Payment is money state, not
 * safety state, and a wrong guess simply corrects on the server response — so
 * unlike boarding (never optimistic) the instant feedback is safe here.
 */
export function PaymentStatusControl({
  bookingId,
  status,
  action,
  sourceNote,
  refundNote,
  packageNote = null,
  allowedStatuses,
  mark,
  copy,
}: {
  bookingId: string;
  status: PaymentStatus;
  /**
   * Which statuses this staffer may set. `waived` and `refunded` are decisions
   * *about* money rather than records of it, and `canRefund` gates that
   * write-off everywhere else, so they are absent for anyone else — hidden
   * rather than explained (issue #714). The action refuses independently; a
   * missing option is not a gate.
   */
  allowedStatuses: readonly PaymentStatus[];
  action: (formData: FormData) => void;
  /** e.g. "Paid on Stripe" — shown after the status. */
  sourceNote: string | null;
  /** e.g. "Refund-eligible until …" — shown only while the status is (deposit) paid. */
  refundNote: string | null;
  /**
   * The diver holds unspent package dives this trip could take (issue #1697,
   * H-79). Shown only while money is still to be taken: a fare already
   * collected stands, so the line exists to be read before the cash.
   */
  packageNote?: string | null;
  mark: PaymentMarkDefaults;
  copy: PaymentStatusControlCopy;
}) {
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(status);
  // The picked status, so the Paid mark opens the moment Paid is chosen rather
  // than after a round trip. Only a change *into* a money status asks: the
  // seat's own status re-submitted is a tap that changes nothing.
  const [picked, setPicked] = useState<PaymentStatus>(mark.retry?.status ?? status);
  const asksForMoney = picked !== status && MONEY_STATUSES.includes(picked);
  const showRefund =
    (optimisticStatus === "paid" || optimisticStatus === "deposit_paid") && refundNote;
  const showPackage =
    (optimisticStatus === "unpaid" || optimisticStatus === "deposit_paid") && packageNote;
  return (
    <form
      action={(formData) => {
        setOptimisticStatus((formData.get("status") as PaymentStatus) ?? status);
        return action(formData);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <span className="text-sm text-muted">
        {copy.prefix} {copy.statuses[optimisticStatus]}
        {sourceNote ? <span className="text-muted"> · {sourceNote}</span> : null}
        {showRefund ? <span className="text-muted"> · {refundNote}</span> : null}
      </span>
      {showPackage ? (
        <span className="basis-full text-sm" data-testid="payment-package-note">
          {packageNote}
        </span>
      ) : null}
      {/* Keep the picker and Update together; on narrow rows, wrap the group
          internally to avoid separating the button or causing page overflow. */}
      <span className="flex flex-wrap items-center gap-2">
        {/* `w-fit` overrides controlClass's `w-full` on the wrapper. Keep the
            shared 16px control type, padding, and visible focus border. */}
        <span className="w-fit">
          <select
            name="status"
            aria-label={copy.label}
            value={picked}
            onChange={(event) => setPicked(event.target.value as PaymentStatus)}
            className={controlClass}
          >
            {/* The booking's current status is always among the options, even
                when this staffer could not have set it. Without that, a captain
                opening a booking an owner had waived would find the select
                showing the *first* option instead — and one tap of Update would
                silently move a free seat to unpaid. Order comes from the copy
                map, so the list reads the same for everyone who sees it. */}
            {(Object.keys(copy.statuses) as PaymentStatus[])
              .filter(
                (value) =>
                  value === status || (!mark.handMarkRefused && allowedStatuses.includes(value)),
              )
              .map((value) => (
                <option key={value} value={value}>
                  {copy.statuses[value]}
                </option>
              ))}
          </select>
        </span>
        <SubmitButton
          pendingLabel={copy.updating}
          className={buttonClass({ variant: "secondary" })}
        >
          {copy.update}
        </SubmitButton>
      </span>
      {/* **The Paid mark** (batch 6 item 1): how much changed hands and how,
          so cash at the dock reaches Reports instead of a $0 paid row. It
          opens under the picker, before Update, on the pick itself. */}
      {asksForMoney ? (
        <div className="grid basis-full gap-3 sm:grid-cols-2" data-testid="payment-mark">
          <PriceField
            name="amount"
            label={copy.amountLabel}
            hint={mark.balanceHint ?? undefined}
            cents={mark.retry?.amountCents ?? mark.amountCents}
            currency={mark.currency}
            locale={mark.locale}
            copy={copy.forgiving}
          />
          <ChoiceFieldset legend={copy.methodLabel} bodyClassName="flex flex-wrap gap-2">
            {MANUAL_PAYMENT_METHODS.map((method) => (
              <ChoicePill
                key={method}
                type="radio"
                name="method"
                value={method}
                // No default: a method nobody picked would be recorded as
                // how the money came in. The browser asks first, and the
                // action asks again for a post without one.
                required
                defaultChecked={mark.retry?.method === method}
              >
                {copy.methods[method]}
              </ChoicePill>
            ))}
          </ChoiceFieldset>
        </div>
      ) : null}
    </form>
  );
}
