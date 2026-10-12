import { z } from "zod";
import { log } from "@/lib/log";
import { keyLivemode } from "./payment-sources";
import { logStripeRequestThrew } from "./stripe-request-log";

/**
 * **What one Stripe payout carried**, asked of Stripe once, when the payout is
 * paid (ADR 20261012-payouts-reach-diveday).
 *
 * A `payout.paid` event names the amount and the day it reaches the bank, and
 * nothing about the money inside it. Stripe itemizes an automatic payout as
 * balance transactions (`GET /v1/balance_transactions?payout=…`), and two facts
 * an owner reconciling a bank statement wants come off that list: the span of
 * days the payout covers ("covering Sep 27 to Oct 1") and Stripe's fees on it.
 * The webhook asks once and stores the answer; Reports and the Orders index
 * only ever read the stored row, so no page waits on Stripe.
 *
 * Read-only: nothing here moves money or carries an idempotency key.
 *
 * - `summarized`: every transaction was read. The span is null when the payout
 *   carried nothing but its own transaction.
 * - `unavailable`: Stripe will not itemize it (a manual payout), refused the
 *   question (a 4xx no retry changes), the list ran longer than this reads, or
 *   no key of the event's mode is configured. The payout is recorded without a
 *   span or fees, which the page reads as "Stripe did not say".
 * - `failed`: Stripe was unreachable (network, 429, 5xx), so the webhook
 *   answers non-2xx and Stripe delivers the event again.
 */
export type PayoutSummary =
  | { status: "summarized"; coveredFrom: Date | null; coveredTo: Date | null; feeCents: number }
  | { status: "unavailable" }
  | { status: "failed" };

export interface PayoutSummaryLookup {
  summarize(stripeAccountId: string, payoutId: string): Promise<PayoutSummary>;
}

type Fetch = typeof fetch;

/** 100 per page, Stripe's ceiling; twenty pages is two thousand charges in one payout. */
const PAGE_LIMIT = 100;
export const MAX_PAYOUT_SUMMARY_PAGES = 20;

/**
 * The payout's own transactions, which move the money out rather than carry
 * any of it in: never part of the span, never a fee.
 */
const PAYOUT_MOVEMENT_TYPES: ReadonlySet<string> = new Set([
  "payout",
  "payout_cancel",
  "payout_failure",
  "payout_minimum_balance_hold",
  "payout_minimum_balance_release",
]);

const balanceTransactionPageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      created: z.number().int(),
      fee: z.number().int(),
    }),
  ),
  has_more: z.boolean(),
});

type Span = { earliest: number | null; latest: number | null; feeCents: number };

function addTransaction(span: Span, transaction: { type: string; created: number; fee: number }) {
  if (PAYOUT_MOVEMENT_TYPES.has(transaction.type)) return;
  span.earliest =
    span.earliest === null ? transaction.created : Math.min(span.earliest, transaction.created);
  span.latest =
    span.latest === null ? transaction.created : Math.max(span.latest, transaction.created);
  span.feeCents += transaction.fee;
}

function summarized(span: Span): PayoutSummary {
  return {
    status: "summarized",
    coveredFrom: span.earliest === null ? null : new Date(span.earliest * 1000),
    coveredTo: span.latest === null ? null : new Date(span.latest * 1000),
    feeCents: span.feeCents,
  };
}

export function stripePayoutSummaryLookup(
  config: { secretKey: string },
  fetchImpl: Fetch,
): PayoutSummaryLookup {
  const get = (stripeAccountId: string, query: URLSearchParams) =>
    fetchImpl(`https://api.stripe.com/v1/balance_transactions?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Stripe-Account": stripeAccountId,
      },
    });

  return {
    async summarize(stripeAccountId, payoutId) {
      const span: Span = { earliest: null, latest: null, feeCents: 0 };
      let startingAfter: string | null = null;
      try {
        for (let page = 0; page < MAX_PAYOUT_SUMMARY_PAGES; page += 1) {
          const query = new URLSearchParams({ payout: payoutId, limit: String(PAGE_LIMIT) });
          if (startingAfter) query.set("starting_after", startingAfter);
          const response = await get(stripeAccountId, query);
          if (!response.ok) {
            if (response.status === 429 || response.status >= 500) return { status: "failed" };
            log("stripe_payout_summary.refused", "warn", { httpStatus: response.status });
            return { status: "unavailable" };
          }
          const parsed = balanceTransactionPageSchema.safeParse(await response.json());
          if (!parsed.success) return { status: "failed" };
          for (const transaction of parsed.data.data) addTransaction(span, transaction);
          const last = parsed.data.data.at(-1);
          if (!parsed.data.has_more || !last) return summarized(span);
          startingAfter = last.id;
        }
        // Longer than this reads. A span or a fee total off part of the list
        // would be a wrong number on a page an owner reconciles against, so
        // the payout is recorded without either.
        log("stripe_payout_summary.too_long", "warn", { pages: MAX_PAYOUT_SUMMARY_PAGES });
        return { status: "unavailable" };
      } catch (error) {
        logStripeRequestThrew("summarize_payout", error);
        return { status: "failed" };
      }
    },
  };
}

const disabledPayoutSummaryLookup: PayoutSummaryLookup = {
  async summarize() {
    return { status: "unavailable" };
  },
};

/**
 * The lookup the platform key allows for an event of the given mode, on the
 * rule `paymentSourceLookupFromEnvironment` keeps: a key of the other mode
 * cannot see the payout, so it is never asked.
 */
export function payoutSummaryLookupFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: Fetch = fetch,
  event: { livemode?: boolean } = {},
): PayoutSummaryLookup {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return disabledPayoutSummaryLookup;
  const mode = keyLivemode(secretKey);
  if (event.livemode !== undefined && mode !== null && mode !== event.livemode) {
    return disabledPayoutSummaryLookup;
  }
  return stripePayoutSummaryLookup({ secretKey }, fetchImpl);
}
