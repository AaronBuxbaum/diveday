import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { PayoutSummaryLookup } from "@/lib/payments/payout-summary";
import type { AppDb, DbExecutor } from "./client";
import { type StripePayout, shopStripeAccounts, stripePayouts } from "./schema";

/** Stripe's terminal "this never reached the bank" status. */
const FAILED = "failed";

export type PayoutEvent = {
  /** The event's own `account`: the only statement of whose payout this is. */
  stripeAccountId: string;
  /** The event's `created` time — the ordering key, never delivery order. */
  occurredAt: Date;
  payout: {
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    arrivalDate: Date;
    /** Stripe itemizes only an automatic payout's balance transactions. */
    automatic: boolean;
    failureCode: string | null;
  };
};

export type PayoutOutcome =
  | { status: "recorded"; payout: StripePayout }
  /** An older event than one already applied, or a paid event after a failure — nothing written. */
  | { status: "stale" }
  /** No shop holds this connected account. */
  | { status: "not_found" }
  /** Stripe could not be asked what the payout carried; deliver the event again. */
  | { status: "deferred" };

/**
 * **Record a payout Stripe made to a shop's bank** (ADR
 * 20261012-payouts-reach-diveday), from `payout.paid` or `payout.failed`.
 *
 * The shop is the one holding the event's connected account — never anything
 * in the payout body — and a row never moves to another account once written.
 * One row per Stripe payout, upserted, ordered by the event's `created` time:
 * a replay changes nothing and a late `paid` never overwrites a `failed`
 * (Stripe can fail a payout after calling it paid, never the other way round).
 *
 * A paid automatic payout is itemized once, the first time it is seen paid;
 * a row that already has its summary is never asked about again. Stripe being
 * unreachable defers the whole event rather than recording a payout that will
 * never be summarized.
 */
export async function recordStripePayout(
  db: AppDb,
  event: PayoutEvent,
  lookup: PayoutSummaryLookup,
): Promise<PayoutOutcome> {
  const [holder] = await db
    .select({ shopId: shopStripeAccounts.shopId })
    .from(shopStripeAccounts)
    .where(eq(shopStripeAccounts.stripeAccountId, event.stripeAccountId))
    .limit(1);
  if (!holder) return { status: "not_found" };

  const [existing] = await db
    .select()
    .from(stripePayouts)
    .where(eq(stripePayouts.stripePayoutId, event.payout.id))
    .limit(1);
  if (existing && existing.stripeAccountId !== event.stripeAccountId) return { status: "stale" };
  if (existing?.status === FAILED && event.payout.status !== FAILED) return { status: "stale" };
  if (existing && existing.lastEventAt > event.occurredAt) return { status: "stale" };

  const failed = event.payout.status === FAILED;
  const needsSummary =
    !failed &&
    event.payout.automatic &&
    existing?.feeCents == null &&
    existing?.coveredFrom == null;
  let summary: { coveredFrom: Date | null; coveredTo: Date | null; feeCents: number | null } = {
    coveredFrom: existing?.coveredFrom ?? null,
    coveredTo: existing?.coveredTo ?? null,
    feeCents: existing?.feeCents ?? null,
  };
  if (needsSummary) {
    const answer = await lookup.summarize(event.stripeAccountId, event.payout.id);
    if (answer.status === "failed") return { status: "deferred" };
    if (answer.status === "summarized") {
      summary = {
        coveredFrom: answer.coveredFrom,
        coveredTo: answer.coveredTo,
        feeCents: answer.feeCents,
      };
    }
  }

  const row = {
    shopId: holder.shopId,
    stripeAccountId: event.stripeAccountId,
    stripePayoutId: event.payout.id,
    amountCents: event.payout.amountCents,
    currency: event.payout.currency,
    status: event.payout.status,
    arrivalDate: event.payout.arrivalDate,
    failureCode: failed ? event.payout.failureCode : null,
    ...summary,
    lastEventAt: event.occurredAt,
    updatedAt: event.occurredAt,
  };
  const [written] = await db
    .insert(stripePayouts)
    .values(row)
    .onConflictDoUpdate({
      target: stripePayouts.stripePayoutId,
      set: {
        amountCents: row.amountCents,
        currency: row.currency,
        status: row.status,
        arrivalDate: row.arrivalDate,
        failureCode: row.failureCode,
        coveredFrom: sql`coalesce(${stripePayouts.coveredFrom}, ${row.coveredFrom})`,
        coveredTo: sql`coalesce(${stripePayouts.coveredTo}, ${row.coveredTo})`,
        feeCents: sql`coalesce(${stripePayouts.feeCents}, ${row.feeCents})`,
        lastEventAt: row.lastEventAt,
        updatedAt: row.updatedAt,
      },
      // The checks above, again under the row's own conflict target, so two
      // deliveries racing past them still cannot undo a failure, apply an
      // older event, or move the row to another account.
      setWhere: and(
        eq(stripePayouts.stripeAccountId, row.stripeAccountId),
        sql`${stripePayouts.lastEventAt} <= ${row.lastEventAt}`,
        failed ? sql`true` : sql`${stripePayouts.status} <> ${FAILED}`,
      ),
    })
    .returning();
  return written ? { status: "recorded", payout: written } : { status: "stale" };
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
