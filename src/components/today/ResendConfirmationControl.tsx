"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { IDLE_RESEND_STATE, type ResendState } from "@/app/actions/notification-resend-types";
import { resendConfirmationAction } from "@/app/actions/notifications";
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

function ResendButton({ label, resending }: { label: string; resending: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass({ variant: "secondary", className: "w-full shrink-0 sm:w-auto" })}
    >
      {pending ? resending : label}
    </button>
  );
}

function ResultNotice({ state, copy }: { state: ResendState; copy: ResendConfirmationCopy }) {
  if (state.status === "idle") return null;
  const errorCopy: Record<Extract<ResendState, { status: "error" }>["reason"], string> = {
    invalid: copy.errors.invalid,
    no_email: copy.errors.noEmail,
    not_configured: copy.errors.notConfigured,
    failed: copy.errors.failed,
  };
  return (
    <p
      role="status"
      className={`mt-2 text-sm font-medium ${state.status === "sent" ? "text-success" : "text-danger"}`}
    >
      {state.status === "sent" ? (
        <>
          <span aria-hidden="true">✓ </span>
          {copy.confirmationResent}
        </>
      ) : (
        errorCopy[state.reason]
      )}
    </p>
  );
}

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

  return (
    <div className="sm:text-right">
      <form action={formAction} className="flex sm:inline-flex">
        <input type="hidden" name="bookingId" value={bookingId} />
        <ResendButton label={label} resending={copy.resending} />
      </form>
      <ResultNotice state={state} copy={copy} />
    </div>
  );
}
