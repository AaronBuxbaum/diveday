import type { AppDb } from "@/db/client";
import {
  closePricingMonth,
  listBillableShops,
  markPricingStatementReported,
} from "@/db/pricing-volume";
import { holdsLiveSubscription, shopPricing } from "@/db/shop-subscriptions";
import type { PricingConfig } from "@/lib/billing/pricing-plans";
import { freeTimeEndsAt } from "@/lib/billing/standing";
import type { BillingProvider, PercentBillingConfig } from "@/lib/billing/stripe-billing";
import { addMonths, type MonthRef, monthKey } from "@/lib/calendar";
import { log } from "@/lib/log";
import { trialEndsAt } from "@/lib/trial";
import { shopMonthBounds, utcToWallTime } from "@/lib/zoned";

export type PricingClosePassSummary = {
  /** Percent-plan shops with a live subscription, whose last month was read. */
  closed: number;
  reported: number;
  alreadyReported: number;
  /** A month whose fee was zero: stamped with nothing sent. */
  nothingToReport: number;
  /** Statements written but not reported: the metered price or meter is not configured. */
  notConfigured: number;
  failed: number;
};

/** The shop-local month that ended most recently before `now`. */
export function lastClosedMonth(now: Date, timeZone: string): MonthRef {
  const wall = utcToWallTime(now, timeZone);
  return addMonths({ year: wall.year, month: wall.month }, -1);
}

/**
 * **The percent plan's monthly close** (ADR 20261022-pricing-ab-test). For
 * every real shop holding a live subscription on the percent plan: write last
 * month's statement (`closePricingMonth`, once per shop and month), then report
 * its fee to Stripe's meter, and stamp it reported.
 *
 * A re-run is a no-op: a reported statement is skipped, and an unreported one
 * is reported with the figures and identifier it was written with, which
 * Stripe deduplicates as well. A fee of zero is stamped without a call. The
 * event's timestamp sits a minute inside the month it bills. Logs name the
 * shop and the month, never a figure.
 */
export async function closePercentMonths(
  db: AppDb,
  options: {
    now: Date;
    config: PricingConfig;
    provider: Pick<BillingProvider, "reportMeterEvent"> | null;
    percent: PercentBillingConfig | null;
  },
): Promise<PricingClosePassSummary> {
  const summary: PricingClosePassSummary = {
    closed: 0,
    reported: 0,
    alreadyReported: 0,
    nothingToReport: 0,
    notConfigured: 0,
    failed: 0,
  };
  for (const { shop, subscription } of await listBillableShops(db)) {
    if (!holdsLiveSubscription(subscription) || !subscription.stripeCustomerId) continue;
    const terms = shopPricing(shop.id, subscription, options.config);
    if (terms.plan !== "percent_of_volume") continue;
    const month = lastClosedMonth(options.now, shop.timezone);
    const bounds = shopMonthBounds(month, shop.timezone);
    const statement = await closePricingMonth(db, {
      shopId: shop.id,
      month,
      timeZone: shop.timezone,
      terms,
      freeUntil: freeTimeEndsAt({
        now: bounds.from,
        timeZone: shop.timezone,
        trialEndsAt: trialEndsAt(shop.createdAt),
        freeTermEndsOn: subscription.freeTermEndsOn,
      }),
    });
    summary.closed += 1;
    if (statement.reportedAt) {
      summary.alreadyReported += 1;
      continue;
    }
    if (statement.feeCents === 0) {
      await markPricingStatementReported(db, statement.id, options.now);
      summary.nothingToReport += 1;
      continue;
    }
    if (!options.provider || !options.percent) {
      summary.notConfigured += 1;
      continue;
    }
    const outcome = await options.provider.reportMeterEvent({
      eventName: options.percent.meterEventName,
      customerId: subscription.stripeCustomerId,
      valueCents: statement.feeCents,
      identifier: statement.stripeMeterIdentifier,
      timestamp: new Date(bounds.to.getTime() - 60_000),
    });
    if (outcome.status !== "ok") {
      summary.failed += 1;
      log("pricing_close.report_failed", "warn", { shopId: shop.id, month: monthKey(month) });
      continue;
    }
    await markPricingStatementReported(db, statement.id, options.now);
    summary.reported += 1;
  }
  return summary;
}
