"use client";

import { useActionState } from "react";
import { IDLE_RESEND_STATE } from "@/app/actions/notification-resend-types";
import { resendConfirmationAction } from "@/app/actions/notifications";
import { SubmitButton } from "@/components/SubmitButton";
import { ActionResultNotice } from "@/components/today/ActionResultNotice";
import { buttonClass } from "@/components/ui/button";

export type ResendConfirmationCopy = {
  resending: string;
  confirmationResent: string;
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
 * fix rather than a dead link. Degrades to a plain form post without JavaScript.
 */
export function ResendConfirmationControl({
  shopSlug,
  bookingId,
  label,
  copy,
}: {
  shopSlug: string;
  bookingId: string;
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
        <input type="hidden" name="bookingId" value={bookingId} />
        <SubmitButton
          pendingLabel={copy.resending}
          className={buttonClass({ variant: "secondary", className: "w-full shrink-0 sm:w-auto" })}
        >
          {label}
        </SubmitButton>
      </form>
      <ActionResultNotice
        status={state.status}
        sentMessage={copy.confirmationResent}
        errorMessage={state.status === "error" ? errorCopy[state.reason] : undefined}
      />
    </div>
  );
}
