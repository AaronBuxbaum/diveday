"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  IDLE_INVOICE_RESEND_STATE,
  type InvoiceResendState,
} from "@/app/actions/invoice-resend-types";
import { resendInvoiceAction } from "@/app/actions/invoices";
import { Copyable } from "@/components/Copyable";
import { buttonClass } from "@/components/ui/button";

export type PaymentActionCopy = {
  copyLink: string;
  linkCopied: string;
  copyFailed: string;
  resendInvoice: string;
  resending: string;
  invoiceResent: string;
  errors: {
    notFound: string;
    notOpen: string;
    notConfigured: string;
    failed: string;
  };
};

function CopyLinkButton({
  hostedInvoiceUrl,
  copy,
}: {
  hostedInvoiceUrl: string;
  copy: PaymentActionCopy;
}) {
  return (
    <Copyable
      layout="inline"
      className="shrink-0"
      value={hostedInvoiceUrl}
      copyLabel={copy.copyLink}
      copiedLabel={copy.linkCopied}
      failedLabel={copy.copyFailed}
    />
  );
}

function ResendButton({ label, resending }: { label: string; resending: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0" })}
    >
      {pending ? resending : label}
    </button>
  );
}

function ResultNotice({ state, copy }: { state: InvoiceResendState; copy: PaymentActionCopy }) {
  if (state.status === "idle") return null;
  const errorCopy: Record<Extract<InvoiceResendState, { status: "error" }>["reason"], string> = {
    not_found: copy.errors.notFound,
    not_open: copy.errors.notOpen,
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
          <span aria-hidden="true">✅ </span>
          {copy.invoiceResent}
        </>
      ) : (
        errorCopy[state.reason]
      )}
    </p>
  );
}

/**
 * The Today queue's in-place fix for a `payment_due` row that was actually
 * invoiced through Stripe: copy the diver's hosted payment link, or resend
 * the invoice email, without leaving the queue for the roster. Only rendered
 * when `src/db/today.ts` found a still-open order for the booking — a
 * booking never invoiced (paid at the counter, or invoicing wasn't wired up)
 * has nothing here to act on, and the caller keeps its plain roster link
 * instead of rendering this with no order to work from.
 */
export function PaymentActionControl({
  shopSlug,
  orderId,
  hostedInvoiceUrl,
  copy,
}: {
  shopSlug: string;
  orderId: string;
  hostedInvoiceUrl: string | null;
  copy: PaymentActionCopy;
}) {
  const [state, formAction] = useActionState(
    resendInvoiceAction.bind(null, shopSlug),
    IDLE_INVOICE_RESEND_STATE,
  );

  return (
    <div className="flex flex-col items-end gap-1 sm:text-right">
      <div className="flex flex-wrap justify-end gap-2">
        {hostedInvoiceUrl ? (
          <CopyLinkButton hostedInvoiceUrl={hostedInvoiceUrl} copy={copy} />
        ) : null}
        <form action={formAction} className="flex sm:inline-flex">
          <input type="hidden" name="orderId" value={orderId} />
          <ResendButton label={copy.resendInvoice} resending={copy.resending} />
        </form>
      </div>
      <ResultNotice state={state} copy={copy} />
    </div>
  );
}
