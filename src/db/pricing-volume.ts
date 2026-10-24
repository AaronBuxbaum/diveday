import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { PlanTerms } from "@/lib/billing/pricing-plans";
import { percentFeeCents } from "@/lib/billing/pricing-plans";
import { type MonthRef, monthKey, parseMonthKey } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { shopMonthBounds } from "@/lib/zoned";
import type { AppDb, DbExecutor } from "./client";
import { realShop } from "./founder-metrics";
import { cardMoneyThroughDiveDayCents } from "./report-lines";
import { pricingVolumeStatements, shopSubscriptions, shops } from "./schema";

/**
 * **The percent plan's volume and its monthly statements** (ADR
 * 20261022-pricing-ab-test).
 *
 * Volume is card money the shop took through DiveDay in its own calendar
 * month, by the rules the Reports page's money-by-line already applies
 * (`cardMoneyThroughDiveDayCents` in `./report-lines.ts`): never tips, tax,
 * pass-through fees, money taken at the counter or imported history, and net
 * of the refunds recorded by the time it is read. Money taken while the shop
 * was still in its free time is not billed, so a month is read from the later
 * of its first instant and the end of the shop's free time.
 */

export type PricingStatement = typeof pricingVolumeStatements.$inferSelect;

/**
 * The shop-local month as UTC bounds, its start moved past the shop's free
 * time and its end, for a subscription that ended inside it, back to the end.
 */
export function billableWindow(
  month: MonthRef,
  timeZone: string,
  freeUntil: Date | null,
  endedAt: Date | null = null,
): { from: Date; to: Date } {
  const bounds = shopMonthBounds(month, timeZone);
  const to = endedAt && endedAt.getTime() < bounds.to.getTime() ? endedAt : bounds.to;
  const from = freeUntil && freeUntil.getTime() > bounds.from.getTime() ? freeUntil : bounds.from;
  return { from: from.getTime() < to.getTime() ? from : to, to };
}

/**
 * Card money paid through DiveDay in the shop's calendar month, in cents,
 * from `freeUntil` on when the month began inside the shop's free time. A
 * window that has not started (a month entirely free) is zero.
 */
export async function processedVolumeCents(
  db: DbExecutor,
  shopId: string,
  month: MonthRef,
  timeZone: string,
  freeUntil: Date | null = null,
  endedAt: Date | null = null,
): Promise<number> {
  const window = billableWindow(month, timeZone, freeUntil, endedAt);
  if (window.from.getTime() >= window.to.getTime()) return 0;
  return cardMoneyThroughDiveDayCents(db, shopId, window.from, window.to);
}

/** The meter event's identifier: one per shop per month, so Stripe deduplicates a retry too. */
export function meterIdentifier(shopId: string, month: MonthRef): string {
  return `diveday-fee-${shopId}-${monthKey(month)}`;
}

/** The month as the statement's `month` column holds it: its first day. */
export function statementMonth(month: MonthRef): string {
  return `${monthKey(month)}-01`;
}

/**
 * Close one month for one shop: the statement, written once. A second call
 * for the same month returns the row the first wrote, figures unchanged, so a
 * re-run never re-reads a month whose late refund would move its fee after
 * Stripe was told.
 *
 * **A refund recorded after its month closed nets in the month it is
 * recorded** (issue 3024). Each earlier statement keeps the card money it
 * read (`monthCardCents`) and how much of it later statements have already
 * credited (`refundedSinceCloseCents`); what its month reads now falls short
 * of that by the refunds nobody has credited yet. This statement takes them,
 * with what the one before carried, off its own card money, never below
 * zero: the rest carries to the next statement. Reading cumulative figures
 * rather than individual refunds is what keeps a refund from being credited
 * twice or lost, however the closes and refunds interleave.
 */
export async function closePricingMonth(
  db: AppDb,
  input: {
    shopId: string;
    month: MonthRef;
    timeZone: string;
    terms: PlanTerms;
    freeUntil: Date | null;
    /** A subscription that ended inside the month: its volume is read up to here. */
    endedAt?: Date | null;
  },
): Promise<PricingStatement> {
  const month = statementMonth(input.month);
  const existing = await getPricingStatement(db, input.shopId, month);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(pricingVolumeStatements)
      .values({
        shopId: input.shopId,
        month,
        volumeCents: 0,
        basisPoints: input.terms.basisPoints,
        feeCents: 0,
        stripeMeterIdentifier: meterIdentifier(input.shopId, input.month),
        createdAt: nowDate(),
      })
      .onConflictDoNothing({
        target: [pricingVolumeStatements.shopId, pricingVolumeStatements.month],
      })
      .returning({ id: pricingVolumeStatements.id });
    if (!claimed) {
      const row = await getPricingStatement(tx, input.shopId, month);
      if (!row) throw new Error("closePricingMonth: statement missing after insert");
      return row;
    }
    const monthCardCents = await processedVolumeCents(
      tx,
      input.shopId,
      input.month,
      input.timeZone,
      input.freeUntil,
      input.endedAt ?? null,
    );
    const late = await creditLateRefunds(tx, input, month);
    const lateRefundCents = late.newlyRefundedCents + late.carriedInCents;
    const volumeCents = Math.max(0, monthCardCents - lateRefundCents);
    const [row] = await tx
      .update(pricingVolumeStatements)
      .set({
        monthCardCents,
        lateRefundCents,
        refundCarryCents: Math.max(0, lateRefundCents - monthCardCents),
        volumeCents,
        feeCents: percentFeeCents(volumeCents, input.terms.basisPoints),
      })
      .where(eq(pricingVolumeStatements.id, claimed.id))
      .returning();
    if (!row) throw new Error("closePricingMonth: statement missing after insert");
    return row;
  });
}

/**
 * Re-read every earlier statement's month, mark what has been refunded since
 * it closed as credited, and return that with the carry of the latest one.
 */
async function creditLateRefunds(
  tx: DbExecutor,
  input: { shopId: string; timeZone: string; freeUntil: Date | null },
  month: string,
): Promise<{ newlyRefundedCents: number; carriedInCents: number }> {
  const earlier = await tx
    .select()
    .from(pricingVolumeStatements)
    .where(
      and(
        eq(pricingVolumeStatements.shopId, input.shopId),
        lt(pricingVolumeStatements.month, month),
      ),
    )
    .orderBy(desc(pricingVolumeStatements.month));
  let newlyRefundedCents = 0;
  for (const statement of earlier) {
    const ref = parseMonthKey(statement.month.slice(0, 7));
    if (!ref) throw new Error(`closePricingMonth: unreadable month ${statement.month}`);
    const readsNow = await processedVolumeCents(
      tx,
      input.shopId,
      ref,
      input.timeZone,
      input.freeUntil,
    );
    const newly = statement.monthCardCents - statement.refundedSinceCloseCents - readsNow;
    if (newly <= 0) continue;
    newlyRefundedCents += newly;
    await tx
      .update(pricingVolumeStatements)
      .set({ refundedSinceCloseCents: statement.refundedSinceCloseCents + newly })
      .where(eq(pricingVolumeStatements.id, statement.id));
  }
  return { newlyRefundedCents, carriedInCents: earlier[0]?.refundCarryCents ?? 0 };
}

export async function getPricingStatement(
  db: DbExecutor,
  shopId: string,
  month: string,
): Promise<PricingStatement | null> {
  const [row] = await db
    .select()
    .from(pricingVolumeStatements)
    .where(
      and(eq(pricingVolumeStatements.shopId, shopId), eq(pricingVolumeStatements.month, month)),
    )
    .limit(1);
  return row ?? null;
}

/** The shop's most recent closed month, for Settings > Billing. */
export async function latestPricingStatement(
  db: DbExecutor,
  shopId: string,
): Promise<PricingStatement | null> {
  const [row] = await db
    .select()
    .from(pricingVolumeStatements)
    .where(eq(pricingVolumeStatements.shopId, shopId))
    .orderBy(desc(pricingVolumeStatements.month))
    .limit(1);
  return row ?? null;
}

/**
 * Stamp a statement as reported to Stripe. Only an unstamped row is stamped,
 * so the first report's instant is the one kept.
 */
export async function markPricingStatementReported(
  db: AppDb,
  statementId: string,
  at: Date,
): Promise<void> {
  await db
    .update(pricingVolumeStatements)
    .set({ reportedAt: at })
    .where(
      and(eq(pricingVolumeStatements.id, statementId), isNull(pricingVolumeStatements.reportedAt)),
    );
}

/**
 * Stamp the first time a statement's fee is sent to Stripe, before the call.
 * Only the first attempt is kept: it is what Stripe's 24-hour identifier
 * window runs from.
 */
export async function markPricingReportAttempted(
  db: AppDb,
  statementId: string,
  at: Date,
): Promise<void> {
  await db
    .update(pricingVolumeStatements)
    .set({ firstReportAttemptAt: at })
    .where(
      and(
        eq(pricingVolumeStatements.id, statementId),
        isNull(pricingVolumeStatements.firstReportAttemptAt),
      ),
    );
}

/**
 * Real shops (not a demo, not a seeded row nobody can sign into) that hold a
 * Stripe customer: the candidates the monthly close reads. Which of them is on
 * the percent plan is `effectivePricing`'s call, made by the caller.
 */
export async function listBillableShops(db: DbExecutor) {
  return db
    .select({
      shop: {
        id: shops.id,
        timezone: shops.timezone,
        createdAt: shops.createdAt,
      },
      subscription: shopSubscriptions,
    })
    .from(shopSubscriptions)
    .innerJoin(shops, eq(shops.id, shopSubscriptions.shopId))
    .where(and(realShop(), isNotNull(shopSubscriptions.stripeCustomerId)));
}
