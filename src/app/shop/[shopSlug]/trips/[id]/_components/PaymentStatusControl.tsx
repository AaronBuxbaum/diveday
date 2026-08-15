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
  copy,
}: {
  bookingId: string;
  status: PaymentStatus;
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
          {Object.entries(copy.statuses).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </span>
      <SubmitButton
        pendingLabel={copy.updating}
        className={buttonClass({ variant: "secondary", size: "sm", className: "text-foreground" })}
      >
        {copy.update}
      </SubmitButton>
    </form>
  );
}
