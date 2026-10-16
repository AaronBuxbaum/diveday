import { and, asc, eq, exists, lt } from "drizzle-orm";
import { DAY_MS } from "@/lib/clock";
import { log } from "@/lib/log";
import type { InvoicingProvider } from "@/lib/payments/invoicing";
import type { AppDb } from "./client";
import { voidOrder } from "./orders";
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
 * **Void the unpaid public package invoices older than the window**, across
 * every shop, from the nightly pass (`/api/cron/trip-series`).
 *
 * Only an order a diver raised themselves from the public pages
 * (`source = 'public'`) that bills a dive package and is still `open`: an
 * invoice a staffer raised is never touched, whatever its age, because the
 * shop may be chasing it. Each void goes through `voidOrder`, the same path a
 * staffer's Void takes: Stripe voids the invoice first, and only then does the
 * order read `void`, a status rather than a delete. A refusal leaves the
 * order open for the next night. The window is measured from the order's
 * creation against the clock passed in.
 */
export async function voidStalePublicPackageInvoices(
  db: AppDb,
  options: { now: Date; invoicing?: InvoicingProvider },
): Promise<{ considered: number; voided: number; failed: number }> {
  const invoicing = options.invoicing ?? invoicingProviderFromEnvironment();
  const cutoff = new Date(options.now.getTime() - PUBLIC_PACKAGE_INVOICE_DAYS * DAY_MS);
  const stale = await db
    .select({ id: orders.id, shopId: orders.shopId })
    .from(orders)
    .where(
      and(
        eq(orders.source, "public"),
        eq(orders.status, "open"),
        eq(orders.collection, "stripe_invoice"),
        lt(orders.createdAt, cutoff),
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
    // diveday:allow-time-id-order: a batch nobody is shown; oldest first so a
    // backlog drains in the order it built up.
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(SWEEP_LIMIT);

  let voided = 0;
  let failed = 0;
  for (const order of stale) {
    const result = await voidOrder(db, order.shopId, order.id, invoicing);
    if (result) {
      voided += 1;
      log("orders.stale_public_invoice_voided", "info", {
        shopId: order.shopId,
        orderId: order.id,
      });
    } else {
      failed += 1;
      log("orders.stale_public_invoice_void_failed", "warn", {
        shopId: order.shopId,
        orderId: order.id,
      });
    }
  }
  return { considered: stale.length, voided, failed };
}
