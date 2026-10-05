"use client";

import { useActionState } from "react";
import { IDLE_RESEND_STATE } from "@/app/actions/notification-resend-types";
import { resendConfirmationAction } from "@/app/actions/notifications";
import { ActionResultNotice } from "@/app/shop/[shopSlug]/_components/today/ActionResultNotice";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";

export type ResendConfirmationCopy = {
  resending: string;
  confirmationResent: string;
  /** The same, for a batched row that resent several. */
  confirmationsResent: string;
  errors: {
    invalid: string;
    noEmail: string;
    notConfigured: string;
    failed: string;
  };
};

/**
 * One-tap re-send of a failed booking confirmation on the Today queue. Posts the
 * shared server action in place and reports the outcome inline, so the row is a
 * fix rather than a dead link. Falls back to a plain form post before hydration.
 * `sm`, like every other fix in a ledger row (`button.ts`).
 */
export function ResendConfirmationControl({
  shopSlug,
  bookingIds,
  label,
  copy,
}: {
  shopSlug: string;
  /** One booking, or every one a batched row stands for. */
  bookingIds: readonly string[];
  label: string;
  copy: ResendConfirmationCopy;
}) {
  const [state, formAction] = useActionState(
    resendConfirmationAction.bind(null, shopSlug),
    IDLE_RESEND_STATE,
  );
  const errorCopy = {
    invalid: copy.errors.invalid,
    no_email: copy.errors.noEmail,
    not_configured: copy.errors.notConfigured,
    failed: copy.errors.failed,
  } as const;

  return (
    <div className="sm:text-right">
      <form action={formAction} className="flex sm:inline-flex">
        {bookingIds.map((id) => (
          <input key={id} type="hidden" name="bookingId" value={id} />
        ))}
        <SubmitButton
          pendingLabel={copy.resending}
          className={buttonClass({
            variant: "secondary",
            size: "sm",
            className: "w-full shrink-0 sm:w-auto",
          })}
        >
          {label}
        </SubmitButton>
      </form>
      <ActionResultNotice
        status={state.status}
        sentMessage={bookingIds.length > 1 ? copy.confirmationsResent : copy.confirmationResent}
        errorMessage={state.status === "error" ? errorCopy[state.reason] : undefined}
      />
    </div>
  );
}
