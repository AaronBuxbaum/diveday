import { and, asc, desc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { realShop } from "@/features/founder-metrics";
import { fareCheckout } from "../../db/checkout-purpose";
import type { AppDb, DbExecutor } from "../../db/client";
import {
  bookingCheckouts,
  collectionEntries,
  pricingVolumeStatements,
  shopSubscriptions,
  shops,
} from "../../db/schema/index";
import { getShopCurrency } from "../../db/stripe-accounts";
import type { PlanTerms } from "../../lib/billing/pricing-plans";
import { percentFeeCents } from "../../lib/billing/pricing-plans";
import {
  addMonths,
  compareMonths,
  type MonthRef,
  monthKey,
  parseMonthKey,
} from "../../lib/calendar";
import { nowDate } from "../../lib/clock";
import { shopMonthBounds, utcToWallTime } from "../../lib/zoned";

export type PricingStatement = typeof pricingVolumeStatements.$inferSelect;

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

const MAX_COLLECTION_ENTRIES_PER_CLOSE = 50_000;

async function entriesBefore(db: DbExecutor, shopId: string, currency: string, to: Date) {
  const rows = await db
    .select()
    .from(collectionEntries)
    .where(
      and(
        eq(collectionEntries.shopId, shopId),
        eq(collectionEntries.currency, currency),
        lt(collectionEntries.recordedAt, to),
      ),
    )
    .orderBy(asc(collectionEntries.id))
    .limit(MAX_COLLECTION_ENTRIES_PER_CLOSE + 1);
  if (rows.length > MAX_COLLECTION_ENTRIES_PER_CLOSE) throw new Error("pricing_close_entry_limit");
  return rows;
}

type Entry = typeof collectionEntries.$inferSelect;
function lotReturned(entries: Entry[], id: number): number {
  const reversals = entries.filter(
    (entry) => entry.reversesEntryId === id && entry.amountCents < 0,
  );
  const restored = entries.filter(
    (entry) =>
      entry.amountCents > 0 && reversals.some((reversal) => entry.reversesEntryId === reversal.id),
  );
  return (
    -reversals.reduce((sum, entry) => sum + entry.amountCents, 0) -
    restored.reduce((sum, entry) => sum + entry.amountCents, 0)
  );
}
function collectionLots(
  entries: Entry[],
  from: Date,
  to: Date,
): Array<{ entryId: number; amountCents: number }> {
  return entries
    .filter(
      (entry) =>
        entry.amountCents > 0 &&
        entry.reversesEntryId === null &&
        entry.recordedAt >= from &&
        entry.recordedAt < to,
    )
    .map((entry) => ({
      entryId: entry.id,
      amountCents: Math.max(0, entry.amountCents - lotReturned(entries, entry.id)),
    }));
}

/** Native-currency collections actually recorded received, after same-month reversals. */
export async function processedVolumeCents(
  db: DbExecutor,
  shopId: string,
  month: MonthRef,
  timeZone: string,
  freeUntil: Date | null = null,
  endedAt: Date | null = null,
  currency?: string,
): Promise<number> {
  const window = billableWindow(month, timeZone, freeUntil, endedAt);
  if (window.from >= window.to) return 0;
  const ownCurrency = currency ?? (await getShopCurrency(db, shopId));
  return collectionLots(
    await entriesBefore(db, shopId, ownCurrency, window.to),
    window.from,
    window.to,
  ).reduce((sum, lot) => sum + lot.amountCents, 0);
}

/** A visible hold, not a guessed zero-dollar receipt. */
export async function hasIncompleteCollectionEvidence(
  db: DbExecutor,
  shopId: string,
  currency: string,
  freeUntil: Date | null = null,
): Promise<boolean> {
  // diveday:any-checkout-purpose: tips are excluded; this is a fare receipt evidence check.
  const [row] = await db
    .select({ id: bookingCheckouts.id })
    .from(bookingCheckouts)
    .where(
      and(
        eq(bookingCheckouts.shopId, shopId),
        eq(bookingCheckouts.currency, currency),
        fareCheckout(),
        or(
          and(
            eq(bookingCheckouts.status, "completed"),
            gte(bookingCheckouts.completedAt, freeUntil ?? new Date(0)),
          ),
          gte(bookingCheckouts.paidAfterCloseAt, freeUntil ?? new Date(0)),
        ),
        or(
          eq(bookingCheckouts.collectionNeedsReview, true),
          isNull(bookingCheckouts.settledTotalCents),
          and(eq(bookingCheckouts.taxEnabled, true), isNull(bookingCheckouts.taxCents)),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function collectionCurrencies(db: DbExecutor, shopId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ currency: collectionEntries.currency })
    .from(collectionEntries)
    .where(eq(collectionEntries.shopId, shopId));
  // A receipt without a lot still needs a visible hold, including after a
  // shop changes its default currency before settlement evidence arrives.
  // diveday:any-checkout-purpose: fare receipts only, never tips.
  const receipts = await db
    .selectDistinct({ currency: bookingCheckouts.currency })
    .from(bookingCheckouts)
    .where(
      and(
        eq(bookingCheckouts.shopId, shopId),
        fareCheckout(),
        or(eq(bookingCheckouts.status, "completed"), isNotNull(bookingCheckouts.paidAfterCloseAt)),
      ),
    );
  return [
    ...new Set([
      await getShopCurrency(db, shopId),
      ...rows.map((row) => row.currency),
      ...receipts.map((row) => row.currency),
    ]),
  ].sort();
}

/** Bounded new accounting progresses independently of recent provider retries. */
export async function pricingMonthsToClose(
  db: DbExecutor,
  shopId: string,
  currency: string,
  last: MonthRef,
  timeZone: string,
): Promise<MonthRef[]> {
  const where = and(
    eq(pricingVolumeStatements.shopId, shopId),
    eq(pricingVolumeStatements.currency, currency),
  );
  const retries = await db
    .select({ month: pricingVolumeStatements.month })
    .from(pricingVolumeStatements)
    .where(and(where, isNull(pricingVolumeStatements.reportedAt)))
    .orderBy(desc(pricingVolumeStatements.month))
    .limit(8);
  const [latest] = await db
    .select({ month: pricingVolumeStatements.month })
    .from(pricingVolumeStatements)
    .where(where)
    .orderBy(desc(pricingVolumeStatements.month))
    .limit(1);
  const latestMonth = parseMonthKey(latest?.month.slice(0, 7));
  let start = latestMonth ? addMonths(latestMonth, 1) : last;
  if (!latest) {
    const [first] = await db
      .select({ at: collectionEntries.recordedAt })
      .from(collectionEntries)
      .where(and(eq(collectionEntries.shopId, shopId), eq(collectionEntries.currency, currency)))
      .orderBy(asc(collectionEntries.recordedAt))
      .limit(1);
    const receiptWhere = and(
      eq(bookingCheckouts.shopId, shopId),
      eq(bookingCheckouts.currency, currency),
      fareCheckout(),
    );
    const [completed] = await db
      .select({ at: bookingCheckouts.completedAt })
      .from(bookingCheckouts)
      .where(
        and(
          receiptWhere,
          fareCheckout(),
          eq(bookingCheckouts.status, "completed"),
          isNotNull(bookingCheckouts.completedAt),
        ),
      )
      .orderBy(asc(bookingCheckouts.completedAt))
      .limit(1);
    const [late] = await db
      .select({ at: bookingCheckouts.paidAfterCloseAt })
      .from(bookingCheckouts)
      .where(and(receiptWhere, fareCheckout(), isNotNull(bookingCheckouts.paidAfterCloseAt)))
      .orderBy(asc(bookingCheckouts.paidAfterCloseAt))
      .limit(1);
    const dates = [first?.at, completed?.at, late?.at].filter(
      (at): at is Date => at instanceof Date,
    );
    if (dates.length) {
      const wall = utcToWallTime(new Date(Math.min(...dates.map((at) => at.getTime()))), timeZone);
      start = { year: wall.year, month: wall.month };
    }
  }
  const months = retries
    .map((row) => parseMonthKey(row.month.slice(0, 7)))
    .filter((month): month is MonthRef => month !== null && compareMonths(month, last) <= 0);
  for (
    let month = start;
    compareMonths(month, last) <= 0 && months.length < 24;
    month = addMonths(month, 1)
  )
    months.push(month);
  if (months.length === 0 && latestMonth && compareMonths(latestMonth, last) === 0)
    months.push(last);
  return months.sort(compareMonths);
}

export function meterIdentifier(shopId: string, month: MonthRef, currency = "usd"): string {
  return `diveday-fee-${shopId}-${monthKey(month)}-${currency}`;
}
export function statementMonth(month: MonthRef): string {
  return `${monthKey(month)}-01`;
}

/**
 * One immutable statement per shop, month and currency. The shop row serializes
 * all closes, not only two closes of the same month. Credits are fee amounts
 * computed at the original statement's rate and rounding, never old volume
 * repriced at today's rate. A linked reversal cannot refund a free collection.
 */
export async function closePricingMonth(
  db: AppDb,
  input: {
    shopId: string;
    month: MonthRef;
    timeZone: string;
    terms: PlanTerms;
    freeUntil: Date | null;
    endedAt?: Date | null;
    currency?: string;
    now?: Date;
  },
): Promise<PricingStatement> {
  const month = statementMonth(input.month);
  const currency = input.currency ?? (await getShopCurrency(db, input.shopId));
  return db.transaction(async (tx) => {
    const [shop] = await tx
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .for("no key update");
    if (!shop) throw new Error("pricing_close_shop_missing");
    const existing = await getPricingStatement(tx, input.shopId, month, currency);
    if (existing) return existing;
    const earlier = await tx
      .select()
      .from(pricingVolumeStatements)
      .where(
        and(
          eq(pricingVolumeStatements.shopId, input.shopId),
          eq(pricingVolumeStatements.currency, currency),
        ),
      )
      .orderBy(desc(pricingVolumeStatements.month));
    if (earlier.some((row) => row.month > month)) throw new Error("pricing_close_out_of_order");
    const bounds = shopMonthBounds(input.month, input.timeZone);
    if (bounds.to > (input.now ?? nowDate())) throw new Error("pricing_close_month_not_finished");
    const window = billableWindow(
      input.month,
      input.timeZone,
      input.freeUntil,
      input.endedAt ?? null,
    );
    const [incomplete] = await tx
      .select({ id: bookingCheckouts.id })
      .from(bookingCheckouts)
      .where(
        and(
          eq(bookingCheckouts.shopId, input.shopId),
          eq(bookingCheckouts.currency, currency),
          fareCheckout(),
          or(
            and(
              eq(bookingCheckouts.status, "completed"),
              gte(bookingCheckouts.completedAt, input.freeUntil ?? new Date(0)),
              lt(bookingCheckouts.completedAt, window.to),
            ),
            and(
              gte(bookingCheckouts.paidAfterCloseAt, input.freeUntil ?? new Date(0)),
              lt(bookingCheckouts.paidAfterCloseAt, window.to),
            ),
          ),
          or(
            eq(bookingCheckouts.collectionNeedsReview, true),
            and(
              eq(bookingCheckouts.status, "completed"),
              isNull(bookingCheckouts.settledTotalCents),
            ),
            and(eq(bookingCheckouts.taxEnabled, true), isNull(bookingCheckouts.taxCents)),
          ),
        ),
      )
      .limit(1);
    if (incomplete) throw new Error("pricing_close_incomplete_settlement");
    const entries = await entriesBefore(tx, input.shopId, currency, bounds.to);
    const closedMonths = new Set(earlier.map((row) => row.month));
    if (
      entries.some((entry) => {
        if (
          entry.amountCents <= 0 ||
          entry.reversesEntryId !== null ||
          entry.recordedAt >= bounds.from ||
          entry.recordedAt < (input.freeUntil ?? new Date(0)) ||
          (input.endedAt && entry.recordedAt >= input.endedAt)
        )
          return false;
        const wall = utcToWallTime(entry.recordedAt, input.timeZone);
        return !closedMonths.has(statementMonth({ year: wall.year, month: wall.month }));
      })
    )
      throw new Error("pricing_close_missing_earlier_month");
    const collections = collectionLots(entries, window.from, window.to);
    const monthCollectedCents = collections.reduce((sum, lot) => sum + lot.amountCents, 0);
    const credits: PricingStatement["credits"] = [];
    for (const original of earlier) {
      let cumulativeReturned = 0;
      for (const lot of original.collections) {
        const totalReturned = lotReturned(entries, lot.entryId);
        const positive = entries.find((entry) => entry.id === lot.entryId);
        // The lot's allocation already netted same-month refunds. Only the
        // amount returned after that net balance can produce a late credit.
        const returnedBefore = positive ? positive.amountCents - lot.amountCents : 0;
        cumulativeReturned += Math.min(lot.amountCents, totalReturned - returnedBefore);
      }
      const credited = earlier
        .flatMap((row) => row.credits)
        .filter((credit) => credit.statementId === original.id);
      const alreadyBasis = credited.reduce((sum, credit) => sum + credit.basisCents, 0);
      const alreadyFee = credited.reduce((sum, credit) => sum + credit.feeCents, 0);
      const basisCents = cumulativeReturned - alreadyBasis;
      const feeCents =
        original.grossFeeCents -
        percentFeeCents(
          Math.max(0, original.volumeCents - cumulativeReturned),
          original.basisPoints,
        ) -
        alreadyFee;
      if (basisCents !== 0 || feeCents !== 0)
        credits.push({ statementId: original.id, basisCents, feeCents });
    }
    const grossFeeCents = percentFeeCents(monthCollectedCents, input.terms.basisPoints);
    const refundCreditCents =
      (earlier[0]?.feeCreditCarryCents ?? 0) +
      credits.reduce((sum, credit) => sum + credit.feeCents, 0);
    const [row] = await tx
      .insert(pricingVolumeStatements)
      .values({
        shopId: input.shopId,
        month,
        currency,
        collections,
        credits,
        monthCollectedCents,
        volumeCents: monthCollectedCents,
        basisPoints: input.terms.basisPoints,
        lateRefundCents: credits.reduce((sum, credit) => sum + credit.basisCents, 0),
        grossFeeCents,
        refundCreditCents,
        feeCreditCarryCents: Math.max(0, refundCreditCents - grossFeeCents),
        feeCents: Math.max(0, grossFeeCents - refundCreditCents),
        stripeMeterIdentifier: meterIdentifier(input.shopId, input.month, currency),
        createdAt: nowDate(),
      })
      .returning();
    if (!row) throw new Error("pricing_close_statement_missing");
    return row;
  });
}

export async function getPricingStatement(
  db: DbExecutor,
  shopId: string,
  month: string,
  currency?: string,
): Promise<PricingStatement | null> {
  const [row] = await db
    .select()
    .from(pricingVolumeStatements)
    .where(
      and(
        eq(pricingVolumeStatements.shopId, shopId),
        eq(pricingVolumeStatements.month, month),
        currency ? eq(pricingVolumeStatements.currency, currency) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The shop's most recent closed month, for Settings > Billing. */
export async function latestPricingStatement(
  db: DbExecutor,
  shopId: string,
  currency?: string,
): Promise<PricingStatement | null> {
  const [row] = await db
    .select()
    .from(pricingVolumeStatements)
    .where(
      and(
        eq(pricingVolumeStatements.shopId, shopId),
        currency ? eq(pricingVolumeStatements.currency, currency) : undefined,
      ),
    )
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
