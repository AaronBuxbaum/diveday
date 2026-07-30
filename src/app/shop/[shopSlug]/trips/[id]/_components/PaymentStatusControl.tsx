"use client";

import { useOptimistic } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

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
      <select
        name="status"
        defaultValue={status}
        className="min-h-11 items-center rounded-lg border border-border-strong bg-surface px-2 text-sm"
      >
        {Object.entries(copy.statuses).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <SubmitButton
        pendingLabel={copy.updating}
        className={buttonClass({ variant: "secondary", size: "sm", className: "text-foreground" })}
      >
        {copy.update}
      </SubmitButton>
    </form>
  );
}
