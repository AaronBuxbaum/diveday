"use client";

import { useOptimistic, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import type { ForgivingCopy } from "@/components/ui/ForgivingInput";
import { ChoiceFieldset, ChoicePill, controlClass, PriceField } from "@/components/ui/form";
import { MANUAL_PAYMENT_METHODS, type ManualPaymentMethodCode } from "@/lib/payment-marks";

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
  const [picked, setPicked] = useState<PaymentStatus>(status);
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
      {/* **The picker and the button it submits wrap as one.** Label,
          select and Update were three siblings of this wrapping row, so on a
          phone a short label ("Payment: Unpaid") kept the select on the first
          line and sent Update down alone, while a longer one dropped both,
          and the select stood at two x's down the roster (K-363). The pair
          is one group, so the row breaks between the label and the pair, and
          the pair moves down entire. The group wraps only inside a row too
          narrow for the pair alone (a long status in Spanish at 360), where
          the one alternative is pushing the page sideways. */}
      <span className="flex flex-wrap items-center gap-2">
        {/* Sized by the wrapper, not by a width class on the control —
            `controlClass` already carries `w-full`, and two width utilities
            resolve by stylesheet order rather than class order (same trap as
            `min-h-*`, see components/ui/button.ts). `w-fit` on the wrapper keeps
            the shrink-to-content width this row has always had. The hand-rolled
            class this replaces had dropped `py-2` and, more to the point,
            `focus:border-primary` — the control had no focus indicator at all —
            and carried a no-op `items-center` on an element that is not a flex
            container.

            `md` Update beside the select: every text control is 48px with 16px
            type. The select used to take an appended `text-sm` to match an
            `sm` Update; a control's type is 16px (K-45), and a 16px box beside
            a 14px label is the mismatch `controlClass` names. */}
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
              .filter((value) => value === status || allowedStatuses.includes(value))
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
            cents={mark.amountCents}
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
                defaultChecked={method === "cash"}
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
