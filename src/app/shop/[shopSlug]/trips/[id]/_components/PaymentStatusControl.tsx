"use client";

import { useOptimistic } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";

export type PaymentStatus = "unpaid" | "deposit_paid" | "paid" | "waived" | "refunded";

/** Every word this client component renders, resolved on the server — see the
 * note in src/i18n/staff-messages.ts. */
export type PaymentStatusControlCopy = {
  prefix: string;
  statuses: Record<PaymentStatus, string>;
  update: string;
  updating: string;
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
  allowedStatuses,
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
  copy: PaymentStatusControlCopy;
}) {
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(status);
  const showRefund =
    (optimisticStatus === "paid" || optimisticStatus === "deposit_paid") && refundNote;
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
      {/* Sized by the wrapper, not by a width class on the control —
          `controlClass` already carries `w-full`, and two width utilities
          resolve by stylesheet order rather than class order (same trap as
          `min-h-*`, see components/ui/button.ts). `w-fit` on the wrapper keeps
          the shrink-to-content width this row has always had. The hand-rolled
          class this replaces had dropped `py-2` and, more to the point,
          `focus:border-primary` — the control had no focus indicator at all —
          and carried a no-op `items-center` on an element that is not a flex
          container. */}
      <span className="w-fit">
        <select name="status" defaultValue={status} className={`${controlClass} text-sm`}>
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
        className={buttonClass({ variant: "secondary", size: "sm" })}
      >
        {copy.update}
      </SubmitButton>
    </form>
  );
}
