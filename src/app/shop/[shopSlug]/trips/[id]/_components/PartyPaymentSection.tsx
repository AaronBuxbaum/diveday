import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { ChoiceFieldset, ChoicePill, PriceField } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import { minorToMajor } from "@/lib/money";
import { MANUAL_PAYMENT_METHODS } from "@/lib/payment-marks";
import type { PaymentStatusControlCopy } from "./PaymentStatusControl";
import type { PartyPreview } from "./roster-model";

/**
 * **Mark the party paid** (issue #2605): one cash payment for a whole party,
 * on the lead's seat, instead of one mark per seat with the split done by hand.
 *
 * Two steps, both answered by the server. The first form sends the amount and
 * the method; the page comes back with the server's own split of it, seat by
 * seat, each taking its balance owed first and never more. The second form
 * takes the payment, and the server works the split out again from the
 * database rather than trusting the one on screen. Nothing here writes a seat
 * off: when the money runs short, one seat takes a deposit and the rest still
 * owe, which is why it needs no more than the right to record money.
 */
export function PartyPaymentSection({
  bookingId,
  party,
  previewAction,
  confirmAction,
  copy,
  t,
}: {
  bookingId: string;
  party: {
    seatCount: number;
    owed: string;
    currency: string;
    locale: string;
    preview: PartyPreview | null;
  };
  previewAction: (formData: FormData) => void;
  confirmAction: (formData: FormData) => void;
  copy: PaymentStatusControlCopy;
  t: StaffTranslator;
}) {
  const { preview } = party;
  return (
    <details className="mt-3" open={preview !== null} data-testid="party-payment">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
        {t("trips.roster.partyPay.summary")}
      </summary>
      <p className="text-sm text-muted">
        {t("trips.roster.partyPay.owes", { count: party.seatCount, amount: party.owed })}
      </p>
      <form action={previewAction} className="mt-2 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="bookingId" value={bookingId} />
        <PriceField
          name="amount"
          label={copy.amountLabel}
          cents={preview?.amountCents ?? null}
          currency={party.currency}
          locale={party.locale}
          copy={copy.forgiving}
        />
        <ChoiceFieldset legend={copy.methodLabel} bodyClassName="flex flex-wrap gap-2">
          {MANUAL_PAYMENT_METHODS.map((method) => (
            <ChoicePill
              key={method}
              type="radio"
              name="method"
              value={method}
              required
              defaultChecked={preview?.method === method}
            >
              {copy.methods[method]}
            </ChoicePill>
          ))}
        </ChoiceFieldset>
        <div className="sm:col-span-2">
          <SubmitButton
            pendingLabel={t("trips.roster.partyPay.previewing")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("trips.roster.partyPay.preview")}
          </SubmitButton>
        </div>
      </form>
      {preview ? (
        <form
          action={confirmAction}
          className="mt-4 grid gap-2 rounded-lg border border-border p-4"
          data-testid="party-payment-split"
        >
          <input type="hidden" name="bookingId" value={bookingId} />
          <input
            type="hidden"
            name="amount"
            value={String(minorToMajor(preview.amountCents, party.currency))}
          />
          <input type="hidden" name="method" value={preview.method} />
          <input type="hidden" name="expectedOwed" value={String(preview.owedCents)} />
          <p className="text-sm font-medium">
            {t("trips.roster.partyPay.splitHeading", {
              amount: formatMoneyCents(preview.amountCents, party.currency, party.locale),
              method: copy.methods[preview.method],
            })}
          </p>
          <ul className="grid gap-1 text-sm">
            {preview.shares.map((share) => (
              <li key={share.bookingId}>
                {t(
                  share.settles
                    ? "trips.roster.partyPay.shareSettles"
                    : "trips.roster.partyPay.shareDeposit",
                  {
                    name: share.personName,
                    amount: formatMoneyCents(share.amountCents, party.currency, party.locale),
                  },
                )}
              </li>
            ))}
          </ul>
          {preview.unspentCents > 0 ? (
            <p className="text-sm text-muted">
              {t("trips.roster.partyPay.stillOwed", {
                amount: formatMoneyCents(preview.unspentCents, party.currency, party.locale),
              })}
            </p>
          ) : null}
          <div>
            <SubmitButton
              pendingLabel={t("trips.roster.partyPay.confirming")}
              className={buttonClass({ variant: "primary" })}
            >
              {t("trips.roster.partyPay.confirm", {
                amount: formatMoneyCents(preview.amountCents, party.currency, party.locale),
              })}
            </SubmitButton>
          </div>
        </form>
      ) : null}
    </details>
  );
}
