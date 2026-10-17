import { and, asc, eq, exists, isNull, lt, or, sql } from "drizzle-orm";
import { DAY_MS } from "@/lib/clock";
import { log } from "@/lib/log";
import type { InvoicingProvider } from "@/lib/payments/invoicing";
import type { AppDb } from "./client";
import { refreshOrderStatus, voidOrder } from "./orders";
import { orderLineItems, orders } from "./schema";
import { invoicingProviderFromEnvironment } from "./stripe-providers";

/**
 * **How long a dive package bought on the shop's public pages may sit unpaid**
 * before it is voided (issue #2304): 7 days, the product owner's call of
 * 2026-10-13 (over a proposed 14). The invoice is due in a day
 * (`createDiverPackageOrder`), so a week is a diver who meant to pay and
 * forgot, not one still deciding; after it the order is a dead row in the
 * Orders index's open list.
 */
export const PUBLIC_PACKAGE_INVOICE_DAYS = 7;

/** At most this many voids a night; a backlog drains over the following nights. */
const SWEEP_LIMIT = 100;

/**
 * Nights a refused void waits before it is tried again. A refusal Stripe will
 * repeat (an invoice deleted at Stripe, a disconnected account) would
 * otherwise come back first every night, and a hundred of them would hold the
 * whole batch.
 */
const RETRY_AFTER_DAYS = 3;

/**
 * Refusals after which an invoice is reported for a person to look at, once:
 * the cron raises it to Sentry. It is still tried after that, at the same pace.
 */
export const STALE_VOID_ALERT_AFTER = 3;

/**
 * **Void the unpaid public package invoices older than the window**, across
 * every shop, from the nightly pass (`/api/cron/trip-series`).
 *
 * Only an order a diver raised themselves from the public pages
 * (`source = 'public'`) that bills a dive package and is still `open`: an
 * invoice a staffer raised is never touched, whatever its age, because the
 * shop may be chasing it. Each void goes through `voidOrder`, the same path a
 * staffer's Void takes: Stripe voids the invoice first, and only then does the
 * order read `void`, a status rather than a delete. A refusal is read back
 * from Stripe (a paid invoice is recorded paid); otherwise the order stays
 * open, stamped, and waits {@link RETRY_AFTER_DAYS} nights. The window is measured from the order's
 * creation against the clock passed in.
 */
export async function voidStalePublicPackageInvoices(
  db: AppDb,
  options: { now: Date; invoicing?: InvoicingProvider },
): Promise<{
  considered: number;
  voided: number;
  /** Stripe would not void it because it is no longer open (paid, mostly): recorded as Stripe has it. */
  refreshed: number;
  failed: number;
  /** Refused for the {@link STALE_VOID_ALERT_AFTER}th time on this pass. */
  stuck: number;
}> {
  const invoicing = options.invoicing ?? invoicingProviderFromEnvironment();
  const cutoff = new Date(options.now.getTime() - PUBLIC_PACKAGE_INVOICE_DAYS * DAY_MS);
  const retryBefore = new Date(options.now.getTime() - RETRY_AFTER_DAYS * DAY_MS);
  const stale = await db
    .select({ id: orders.id, shopId: orders.shopId, failures: orders.autoVoidFailures })
    .from(orders)
    .where(
      and(
        eq(orders.source, "public"),
        eq(orders.status, "open"),
        eq(orders.collection, "stripe_invoice"),
        lt(orders.createdAt, cutoff),
        or(isNull(orders.autoVoidFailedAt), lt(orders.autoVoidFailedAt, retryBefore)),
        exists(
          db
            .select({ id: orderLineItems.id })
            .from(orderLineItems)
            .where(
              and(
                eq(orderLineItems.orderId, orders.id),
                eq(orderLineItems.shopId, orders.shopId),
                eq(orderLineItems.kind, "dive_package"),
              ),
            ),
        ),
      ),
    )
    // diveday:allow-time-id-order: a batch nobody is shown. Never-refused
    // first, then oldest first, so a backlog drains in the order it built up
    // and a refused invoice goes to the back.
    .orderBy(sql`${orders.autoVoidFailedAt} asc nulls first`, asc(orders.createdAt), asc(orders.id))
    .limit(SWEEP_LIMIT);

  const summary = { considered: stale.length, voided: 0, refreshed: 0, failed: 0, stuck: 0 };
  for (const order of stale) {
    const result = await voidOrder(db, order.shopId, order.id, invoicing);
    if (result) {
      summary.voided += 1;
      log("orders.stale_public_invoice_voided", "info", {
        shopId: order.shopId,
        orderId: order.id,
      });
      continue;
    }
    // Stripe refuses to void an invoice that was paid meanwhile, before its
    // webhook arrived: read it back and record what Stripe has.
    const refreshed = await refreshOrderStatus(db, order.shopId, order.id, invoicing);
    if (refreshed && refreshed.status !== "open") {
      summary.refreshed += 1;
      log("orders.stale_public_invoice_refreshed", "info", {
        shopId: order.shopId,
        orderId: order.id,
        status: refreshed.status,
      });
      continue;
    }
    const failures = order.failures + 1;
    await db
      .update(orders)
      .set({ autoVoidFailedAt: options.now, autoVoidFailures: failures })
      .where(and(eq(orders.id, order.id), eq(orders.shopId, order.shopId)));
    summary.failed += 1;
    if (failures === STALE_VOID_ALERT_AFTER) summary.stuck += 1;
    log("orders.stale_public_invoice_void_failed", "warn", {
      shopId: order.shopId,
      orderId: order.id,
      failures,
    });
  }
  return summary;
}
