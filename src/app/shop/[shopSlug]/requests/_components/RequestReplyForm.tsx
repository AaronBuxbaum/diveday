import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SummaryCaret } from "@/components/ui/disclosure";
import type { ForgivingCopy } from "@/components/ui/ForgivingInput";
import { Field, PriceField, textareaClassFor } from "@/components/ui/form";
import { INTEREST_REPLY_MAX } from "@/lib/interest-reply";

export type RequestReplyCopy = {
  open: string;
  label: string;
  /** Where it goes, already worded: "Goes to priya@example.com by email." */
  destination: string;
  send: string;
  sending: string;
};

/**
 * The whole-boat price a reply to a private charter carries (loop 5, row 11),
 * in the shop's major unit; the writer words it into the diver's language.
 */
export type RequestQuoteField = {
  label: string;
  hint: string;
  currency: string;
  locale: string;
  copy: ForgivingCopy;
};

/**
 * **Answer a request from DiveDay** (issue #2555): a closed line under the
 * lead that opens to one box and Send. The reply goes on the channel the diver
 * left (`interestReplyRoute`), is recorded against the request and closes it as
 * replied, which moves the row under Done. A reply that did not go comes back
 * here open, with `error` under the box, and the words the staffer typed are
 * theirs to paste again: nothing is kept in the URL.
 *
 * A server form with no client state: the outcome is the redirect's
 * `?notice=`, and `error` is this row's share of it.
 */
export function RequestReplyForm({
  requestId,
  action,
  copy,
  quote,
  error,
}: {
  requestId: string;
  /** Posts `requestId` and `body` (`replyToRequestAction`). */
  action: (formData: FormData) => void;
  copy: RequestReplyCopy;
  /** Present only on a charter request: a price box above the words. */
  quote?: RequestQuoteField;
  /** Why the last reply on this row did not go, when it is this row the notice names. */
  error?: string;
}) {
  const fieldId = `reply-${requestId}`;
  return (
    <details className="group/reply mt-2 print:hidden" open={error ? true : undefined}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
        <SummaryCaret className="group-open/reply:rotate-90" />
        {copy.open}
      </summary>
      <form action={action} className="mt-1 flex flex-col gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        {quote ? (
          <PriceField
            id={`${fieldId}-quote`}
            name="quote"
            label={quote.label}
            hint={quote.hint}
            cents={null}
            currency={quote.currency}
            locale={quote.locale}
            copy={quote.copy}
          />
        ) : null}
        <Field label={copy.label} htmlFor={fieldId} description={copy.destination} error={error}>
          <textarea
            id={fieldId}
            name="body"
            required
            maxLength={INTEREST_REPLY_MAX}
            rows={3}
            className={textareaClassFor(3)}
          />
        </Field>
        <div>
          <SubmitButton
            pendingLabel={copy.sending}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.send}
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
