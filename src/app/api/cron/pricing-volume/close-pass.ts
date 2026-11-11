import type { AppDb } from "@/db/client";
import type { BillingProvider, PercentBillingConfig } from "@/features/billing";
import {
  closePricingMonth,
  collectionCurrencies,
  listBillableShops,
  markPricingReportAttempted,
  markPricingStatementReported,
  pricingMonthsToClose,
} from "@/features/pricing-volume";
import {
  holdsLiveSubscription,
  type ShopSubscriptionRow,
  shopPricing,
  soldPricing,
} from "@/features/shop-subscriptions";
import { trialEndsAt } from "@/features/trial";
import type { PricingConfig } from "@/lib/billing/pricing-plans";
import { freePeriodEndsAt } from "@/lib/billing/standing";
import { addMonths, type MonthRef, monthKey } from "@/lib/calendar";
import { log } from "@/lib/log";
import { shopMonthBounds, utcToWallTime } from "@/lib/zoned";

export type PricingClosePassSummary = {
  /** Percent-plan shops whose last month was read: a live subscription, or one that ended in it. */
  closed: number;
  reported: number;
  alreadyReported: number;
  /** A report whose answer was lost, found on the meter and stamped with nothing re-sent. */
  reconciled: number;
  /** A subscription that ended inside the month, its fee invoiced on its own. */
  finalMonths: number;
  /** A month whose fee was zero: stamped with nothing sent. */
  nothingToReport: number;
  /** Statements written but not reported: the metered price or meter is not configured. */
  notConfigured: number;
  failed: number;
};

/**
 * How long after a statement's first send the close asks the meter before it
 * sends again. Stripe dedupes an identifier, and replays an idempotency key,
 * for 24 hours; the runs a few hours apart on the 2nd re-send inside that
 * window, and anything later is checked first.
 */
export const REPORT_RECHECK_AFTER_MS = 20 * 60 * 60 * 1000;

/** The shop-local month that ended most recently before `now`. */
export function lastClosedMonth(now: Date, timeZone: string): MonthRef {
  const wall = utcToWallTime(now, timeZone);
  return addMonths({ year: wall.year, month: wall.month }, -1);
}

/**
 * When a subscription ended, for one that is over: Stripe's own time on the
 * last subscription event applied, which for a canceled one is its end.
 */
function subscriptionEndedAt(subscription: ShopSubscriptionRow): Date | null {
  if (!subscription.stripeSubscriptionId || subscription.stripeStatus !== "canceled") return null;
  return subscription.lastSubscriptionEventAt;
}

type CloseProvider = Pick<
  BillingProvider,
  "reportMeterEvent" | "meterValueReported" | "invoiceFinalMonth"
>;

/**
 * **The percent plan's monthly close** (ADR 20261022-pricing-ab-test). For
 * every real shop on the percent plan that held a live subscription in its
 * last month: write that month's statement (`closePricingMonth`, once per shop
 * and month), bill its fee, and stamp it reported.
 *
 * - A live subscription is billed by a meter event under the statement's
 *   identifier, timestamped a minute inside the month. A send is stamped
 *   first (`first_report_attempt_at`); a later run inside Stripe's 24-hour
 *   window re-sends, which Stripe dedupes, and one past it reads the meter
 *   first and stamps what is already there instead of billing it twice.
 * - A subscription that ended inside the month has no item left to bill a
 *   meter event, so its month, read up to the end, is invoiced on its own at
 *   the numbers it was sold (`invoiceFinalMonth`).
 *
 * A reported statement is skipped, and a fee of zero is stamped without a
 * call. Logs name the shop and the month, never a figure.
 */
export async function closePercentMonths(
  db: AppDb,
  options: {
    now: Date;
    config: PricingConfig;
    provider: CloseProvider | null;
    percent: PercentBillingConfig | null;
  },
): Promise<PricingClosePassSummary> {
  const summary: PricingClosePassSummary = {
    closed: 0,
    reported: 0,
    alreadyReported: 0,
    reconciled: 0,
    finalMonths: 0,
    nothingToReport: 0,
    notConfigured: 0,
    failed: 0,
  };
  const { now, provider, percent } = options;
  for (const { shop, subscription } of await listBillableShops(db)) {
    const customerId = subscription.stripeCustomerId;
    if (!customerId) continue;
    const lastMonth = lastClosedMonth(now, shop.timezone);
    const live = holdsLiveSubscription(subscription);
    const endedAt = live ? null : subscriptionEndedAt(subscription);
    if (!live && !endedAt) continue;
    const terms = live
      ? shopPricing(subscription, options.config)
      : soldPricing(subscription, options.config);
    if (terms.plan !== "percent_of_volume") continue;
    for (const currency of await collectionCurrencies(db, shop.id)) {
      for (const month of await pricingMonthsToClose(
        db,
        shop.id,
        currency,
        lastMonth,
        shop.timezone,
      )) {
        const bounds = shopMonthBounds(month, shop.timezone);
        try {
          const statement = await closePricingMonth(db, {
            currency,
            now,
            shopId: shop.id,
            month,
            timeZone: shop.timezone,
            terms,
            freeUntil: freePeriodEndsAt({
              timeZone: shop.timezone,
              trialEndsAt: trialEndsAt(shop.createdAt),
              freeTermEndsOn: subscription.freeTermEndsOn,
            }),
            endedAt,
          });
          summary.closed += 1;
          const logged = { shopId: shop.id, month: monthKey(month), currency };
          if (statement.reportedAt) {
            summary.alreadyReported += 1;
            continue;
          }
          if (statement.feeCents === 0) {
            await markPricingStatementReported(db, statement.id, now);
            summary.nothingToReport += 1;
            continue;
          }
          // This configured meter and final-invoice path are USD only. A native
          // currency amount must never be relabeled as dollars or silently converted.
          if (statement.currency !== "usd") {
            summary.notConfigured += 1;
            log("pricing_close.currency_not_configured", "warn", logged);
            continue;
          }
          if (!provider || !percent) {
            summary.notConfigured += 1;
            continue;
          }

          if (!live) {
            if (endedAt && endedAt <= bounds.from) {
              summary.failed += 1;
              log("pricing_close.ended_subscription_adjustment", "warn", logged);
              continue;
            }
            const invoiced = await provider.invoiceFinalMonth({
              customerId,
              amountCents: statement.feeCents,
              identifier: statement.stripeMeterIdentifier,
              month: monthKey(month),
            });
            if (invoiced.status !== "ok") {
              summary.failed += 1;
              log("pricing_close.final_month_failed", "warn", logged);
              continue;
            }
            await markPricingStatementReported(db, statement.id, now);
            summary.finalMonths += 1;
            continue;
          }

          if (now.getTime() - bounds.to.getTime() > 34 * 24 * 60 * 60 * 1000) {
            summary.failed += 1;
            log("pricing_close.historical_invoice_required", "warn", logged);
            continue;
          }
          const firstAttempt = statement.firstReportAttemptAt;
          if (firstAttempt && now.getTime() - firstAttempt.getTime() >= REPORT_RECHECK_AFTER_MS) {
            const held = await provider.meterValueReported({
              priceId: percent.priceId,
              customerId,
              from: bounds.from,
              to: bounds.to,
            });
            if (held.status !== "ok") {
              summary.failed += 1;
              log("pricing_close.meter_check_failed", "warn", logged);
              continue;
            }
            if (held.value >= statement.feeCents) {
              await markPricingStatementReported(db, statement.id, now);
              summary.reconciled += 1;
              continue;
            }
            if (held.value > 0) {
              // Part of the fee on the meter is nothing this close sent: a person decides.
              summary.failed += 1;
              log("pricing_close.meter_mismatch", "warn", logged);
              continue;
            }
          }
          await markPricingReportAttempted(db, statement.id, now);
          const outcome = await provider.reportMeterEvent({
            eventName: percent.meterEventName,
            customerId,
            valueCents: statement.feeCents,
            identifier: statement.stripeMeterIdentifier,
            timestamp: new Date(bounds.to.getTime() - 60_000),
          });
          if (outcome.status !== "ok") {
            summary.failed += 1;
            log("pricing_close.report_failed", "warn", logged);
            continue;
          }
          await markPricingStatementReported(db, statement.id, now);
          summary.reported += 1;
        } catch {
          summary.failed += 1;
          log("pricing_close.statement_failed", "error", {
            shopId: shop.id,
            month: monthKey(month),
            currency,
          });
          // Never close past a failed month: repaired evidence belongs to its original month.
          break;
        }
      }
    }
  }
  return summary;
}
