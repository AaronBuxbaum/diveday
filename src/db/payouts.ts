import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { PayoutSummaryLookup } from "@/lib/payments/payout-summary";
import type { AppDb, DbExecutor } from "./client";
import { type StripePayout, shopStripeAccounts, stripePayouts } from "./schema";

/** Stripe's terminal "this never reached the bank" statuses. */
const FAILED = "failed";
const CANCELED = "canceled";
const NEVER_ARRIVED = [FAILED, CANCELED] as const;

export type PayoutEvent = {
  /** The event's own `account`: the only statement of whose payout this is. */
  stripeAccountId: string;
  /** The event's `created` time — the ordering key, never delivery order. */
  occurredAt: Date;
  payout: {
    id: string;
    amountCents: number;
    currency: string;
    status: "paid" | "failed" | "canceled";
    arrivalDate: Date;
    /** Stripe itemizes only an automatic payout's balance transactions; a manual one is read for its own fee. */
    automatic: boolean;
    failureCode: string | null;
  };
};

export type PayoutOutcome =
  /** `needsSummary`: paid, and Stripe has not yet been asked what it carried. */
  | { status: "recorded"; payout: StripePayout; needsSummary: boolean }
  /** An older event than one already applied, or a paid event after a failure — nothing written. */
  | { status: "stale" }
  /** No shop holds this connected account, or the one that did has disconnected it. */
  | { status: "not_found" };

function isNeverArrived(status: string): boolean {
  return (NEVER_ARRIVED as readonly string[]).includes(status);
}

/**
 * **Record a payout Stripe made to a shop's bank** (ADR
 * 20261012-payouts-reach-diveday), from `payout.paid`, `payout.failed` or `payout.canceled`.
 *
 * The shop is the one holding the event's connected account, and still
 * connected — never anything in the payout body — and a row never moves to
 * another account once written.
 * One row per Stripe payout, upserted, ordered by the event's `created` time:
 * a replay changes nothing and a late `paid` never overwrites a `failed` or
 * `canceled` (Stripe can fail a payout after calling it paid, never the other way round).
 *
 * Writes the row and answers at once. What a paid payout carried is asked of
 * Stripe afterwards, by {@link summarizeStripePayout} from `after()`, so the
 * webhook never holds Stripe's delivery open on a page walk; `needsSummary`
 * is true until a summary has been stored.
 */
export async function recordStripePayout(db: AppDb, event: PayoutEvent): Promise<PayoutOutcome> {
  const [holder] = await db
    .select({ shopId: shopStripeAccounts.shopId })
    .from(shopStripeAccounts)
    .where(
      and(
        eq(shopStripeAccounts.stripeAccountId, event.stripeAccountId),
        // A shop that deauthorized DiveDay stops accruing payouts here.
        isNull(shopStripeAccounts.disconnectedAt),
      ),
    )
    .limit(1);
  if (!holder) return { status: "not_found" };

  const [existing] = await db
    .select()
    .from(stripePayouts)
    .where(eq(stripePayouts.stripePayoutId, event.payout.id))
    .limit(1);
  if (existing && existing.stripeAccountId !== event.stripeAccountId) return { status: "stale" };
  const neverArrives = event.payout.status !== "paid";
  if (existing && isNeverArrived(existing.status) && !neverArrives) return { status: "stale" };
  if (existing && existing.lastEventAt > event.occurredAt) return { status: "stale" };

  const failed = event.payout.status === FAILED;
  const row = {
    shopId: holder.shopId,
    stripeAccountId: event.stripeAccountId,
    stripePayoutId: event.payout.id,
    amountCents: event.payout.amountCents,
    currency: event.payout.currency,
    status: event.payout.status,
    arrivalDate: event.payout.arrivalDate,
    failureCode: failed ? event.payout.failureCode : null,
    lastEventAt: event.occurredAt,
    updatedAt: event.occurredAt,
  };
  const [written] = await db
    .insert(stripePayouts)
    .values(row)
    .onConflictDoUpdate({
      target: stripePayouts.stripePayoutId,
      // The summary columns are not in this set: a replay never clears them.
      set: {
        amountCents: row.amountCents,
        currency: row.currency,
        status: row.status,
        arrivalDate: row.arrivalDate,
        failureCode: row.failureCode,
        lastEventAt: row.lastEventAt,
        updatedAt: row.updatedAt,
      },
      // The checks above, again under the row's own conflict target, so two
      // deliveries racing past them still cannot undo a failure, apply an
      // older event, or move the row to another account.
      setWhere: and(
        eq(stripePayouts.stripeAccountId, row.stripeAccountId),
        sql`${stripePayouts.lastEventAt} <= ${row.lastEventAt}`,
        neverArrives
          ? sql`true`
          : sql`${stripePayouts.status} not in (${sql.join(
              NEVER_ARRIVED.map((status) => sql`${status}`),
              sql`, `,
            )})`,
      ),
    })
    .returning();
  if (!written) return { status: "stale" };
  const needsSummary = !neverArrives && written.feeCents === null && written.coveredFrom === null;
  return { status: "recorded", payout: written, needsSummary };
}

/** How long to wait before each further try when Stripe cannot be reached. */
export const PAYOUT_SUMMARY_RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000];

export type PayoutSummaryRun = "summarized" | "unavailable" | "failed";

/**
 * **Ask Stripe once what a paid payout carried and store the answer** (ADR
 * 20261012-payouts-reach-diveday), run after the webhook has answered.
 *
 * The write is conditional on the row still having no summary and still being
 * paid, so a duplicate run, a replay or a payout that failed meanwhile never
 * overwrites anything: asked once, kept once. Stripe being unreachable retries
 * on {@link PAYOUT_SUMMARY_RETRY_DELAYS_MS}; past those the payout stays
 * recorded without a span or fee, which pages read as "Stripe did not say",
 * and the caller reports it.
 */
export async function summarizeStripePayout(
  db: AppDb,
  lookup: PayoutSummaryLookup,
  payout: { stripeAccountId: string; payoutId: string; automatic: boolean },
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<PayoutSummaryRun> {
  let answer = await lookup.summarize(payout.stripeAccountId, payout.payoutId, {
    automatic: payout.automatic,
  });
  for (const delay of PAYOUT_SUMMARY_RETRY_DELAYS_MS) {
    if (answer.status !== "failed") break;
    await sleep(delay);
    answer = await lookup.summarize(payout.stripeAccountId, payout.payoutId, {
      automatic: payout.automatic,
    });
  }
  if (answer.status !== "summarized") return answer.status;
  await db
    .update(stripePayouts)
    .set({
      coveredFrom: answer.coveredFrom,
      coveredTo: answer.coveredTo,
      feeCents: answer.feeCents,
    })
    .where(
      and(
        eq(stripePayouts.stripePayoutId, payout.payoutId),
        eq(stripePayouts.stripeAccountId, payout.stripeAccountId),
        eq(stripePayouts.status, "paid"),
        isNull(stripePayouts.feeCents),
        isNull(stripePayouts.coveredFrom),
      ),
    );
  return "summarized";
}

/** One payout as Reports and the Orders index print it. */
export type ShopPayout = Pick<
  StripePayout,
  | "id"
  | "amountCents"
  | "currency"
  | "status"
  | "arrivalDate"
  | "coveredFrom"
  | "coveredTo"
  | "feeCents"
  | "failureCode"
>;

const SHOP_PAYOUT_COLUMNS = {
  id: stripePayouts.id,
  amountCents: stripePayouts.amountCents,
  currency: stripePayouts.currency,
  status: stripePayouts.status,
  arrivalDate: stripePayouts.arrivalDate,
  coveredFrom: stripePayouts.coveredFrom,
  coveredTo: stripePayouts.coveredTo,
  feeCents: stripePayouts.feeCents,
  failureCode: stripePayouts.failureCode,
};

/**
 * The payouts that reached (or were due to reach) the bank inside a window,
 * oldest first — Reports' month. Bounded: a shop is paid out at most daily.
 */
export async function listShopPayoutsArriving(
  db: DbExecutor,
  shopId: string,
  window: { from: Date; to: Date },
): Promise<ShopPayout[]> {
  return db
    .select(SHOP_PAYOUT_COLUMNS)
    .from(stripePayouts)
    .where(
      and(
        eq(stripePayouts.shopId, shopId),
        isNull(stripePayouts.deletedAt),
        gte(stripePayouts.arrivalDate, window.from),
        lt(stripePayouts.arrivalDate, window.to),
      ),
    )
    .orderBy(stripePayouts.arrivalDate)
    .limit(62);
}

/**
 * The Orders index's one line: the newest paid payout, and any payout that
 * failed after it (the one an owner must act on in Stripe).
 */
export async function latestShopPayouts(
  db: DbExecutor,
  shopId: string,
): Promise<{ paid: ShopPayout | null; failed: ShopPayout | null }> {
  const rows = await db
    .select(SHOP_PAYOUT_COLUMNS)
    .from(stripePayouts)
    .where(and(eq(stripePayouts.shopId, shopId), isNull(stripePayouts.deletedAt)))
    .orderBy(desc(stripePayouts.arrivalDate), desc(stripePayouts.createdAt))
    .limit(10);
  const paid = rows.find((row) => row.status === "paid") ?? null;
  const failed =
    rows.find((row) => row.status === FAILED && (!paid || row.arrivalDate >= paid.arrivalDate)) ??
    null;
  return { paid, failed };
}
