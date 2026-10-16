import { after } from "next/server";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { recordStripePayout, summarizeStripePayout } from "@/db/payouts";
import { errorClassToken } from "@/lib/error-token";
import { log } from "@/lib/log";
import {
  type PayoutSummaryLookup,
  payoutSummaryLookupFromEnvironment,
} from "@/lib/payments/payout-summary";
import type { StripeWebhookEvent } from "@/lib/payments/webhook";

/**
 * The Payout every `payout.*` event carries (ADR 20261012-payouts-reach-diveday).
 * Only what the owner's line needs: the amount and currency, the day it reaches
 * the bank, whether Stripe will itemize it, and why it failed.
 */
const payoutObjectSchema = z.object({
  id: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  arrival_date: z.number().int(),
  // The only statuses a `payout.paid` / `payout.failed` / `payout.canceled`
  // event carries; anything else is refused rather than stored as "Paid out".
  status: z.enum(["paid", "failed", "canceled"]),
  automatic: z.boolean().optional(),
  failure_code: z.string().nullable().optional(),
});

/**
 * The after-response half of a paid payout: never able to fail the delivery it
 * follows. A payout Stripe could not be asked about stays recorded without a
 * span or fee and is reported by class and code, never message.
 */
async function summarizePayoutSafely(
  db: AppDb,
  lookup: PayoutSummaryLookup,
  payout: { stripeAccountId: string; payoutId: string; automatic: boolean },
): Promise<void> {
  try {
    const run = await summarizeStripePayout(db, lookup, payout);
    if (run === "failed") log("stripe_webhook.payout_summary_failed", "error", {});
  } catch (error) {
    log("stripe_webhook.payout_summary_failed", "error", { errorCode: errorClassToken(error) });
  }
}

/**
 * A `payout.paid`, `payout.failed` or `payout.canceled` event (ADR 20261012-payouts-reach-diveday).
 * Whose payout it is comes from the event's own `account` alone, the same way
 * every reversal is scoped. Returns the outcome to log.
 */
export async function applyPayoutEvent(
  db: AppDb,
  event: StripeWebhookEvent,
  occurredAt: Date,
  livemode: boolean,
): Promise<string> {
  const payout = payoutObjectSchema.safeParse(event.data.object);
  if (!payout.success) return "malformed_payload";
  if (!event.account) return "missing_account";
  const automatic = payout.data.automatic ?? false;
  const outcome = await recordStripePayout(db, {
    stripeAccountId: event.account,
    occurredAt,
    payout: {
      id: payout.data.id,
      amountCents: payout.data.amount,
      currency: payout.data.currency,
      status: payout.data.status,
      arrivalDate: new Date(payout.data.arrival_date * 1000),
      automatic,
      failureCode: payout.data.failure_code ?? null,
    },
  });
  if (outcome.status === "recorded") {
    // What the payout carried is asked of Stripe after this answers (issue
    // #2464): a page walk of up to twenty GETs never holds the delivery open.
    if (outcome.needsSummary) {
      const stripeAccountId = event.account;
      after(() =>
        summarizePayoutSafely(
          db,
          payoutSummaryLookupFromEnvironment(process.env, fetch, { livemode }),
          { stripeAccountId, payoutId: payout.data.id, automatic },
        ),
      );
    }
    return "payout_recorded";
  }
  return outcome.status === "stale" ? "stale_payout_event" : "payout_account_not_found";
}
