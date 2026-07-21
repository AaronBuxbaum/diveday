"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { IDLE_RESEND_STATE, type ResendState } from "@/app/actions/notification-resend-types";
import { resendConfirmationAction } from "@/app/actions/notifications";
import { buttonClass } from "@/components/ui/button";

function ResendButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass({ variant: "secondary", className: "w-full shrink-0 sm:w-auto" })}
    >
      {pending ? "Resending…" : label}
    </button>
  );
}

const ERROR_COPY: Record<Extract<ResendState, { status: "error" }>["reason"], string> = {
  invalid: "Something went wrong — open the trip to check the booking.",
  no_email: "No email on file — add one from the roster, then resend.",
  not_configured: "Email isn’t configured for this shop yet.",
  failed: "Still couldn’t deliver it — open the trip to check the booking.",
};

function ResultNotice({ state }: { state: ResendState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role="status"
      className={`mt-2 text-sm font-medium ${state.status === "sent" ? "text-success" : "text-danger"}`}
    >
      {state.status === "sent" ? (
        <>
          <span aria-hidden="true">✓ </span>Confirmation resent.
        </>
      ) : (
        ERROR_COPY[state.reason]
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
}: {
  shopSlug: string;
  bookingId: string;
  label: string;
}) {
  const [state, formAction] = useActionState(
    resendConfirmationAction.bind(null, shopSlug),
    IDLE_RESEND_STATE,
  );

  return (
    <div className="sm:text-right">
      <form action={formAction} className="flex sm:inline-flex">
        <input type="hidden" name="bookingId" value={bookingId} />
        <ResendButton label={label} />
      </form>
      <ResultNotice state={state} />
    </div>
  );
}
