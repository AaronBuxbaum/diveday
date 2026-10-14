/**
 * **What the shop is owed** (fourth UX review, item 23): one figure for the
 * weekly owner job of chasing money, on the Orders page and in the Monday
 * email's money block.
 *
 * Two kinds of debt, kept apart because they are chased differently:
 *
 * - **Open orders**: invoices sent and not yet paid, what the Orders ledger's
 *   Open filter lists, with the oldest one's date, since an invoice open since
 *   September is a different call from one sent yesterday.
 * - **Seats that sailed owing** (`owedSeatsAfterSailing`): a diver who boarded
 *   without paying the rest, with no order behind the seat at all, so the
 *   ledger cannot show them.
 *
 * In the shop's own currency only: an order raised before the shop changed
 * `shops.currency` keeps its own (ADR 20260731-shop-currency), DiveDay holds no
 * exchange rates, and one figure cannot honestly add two currencies. Such an
 * order still shows on the ledger under its own currency.
 */
import { and, count, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { orders } from "./schema";
import { owedSeatsAfterSailing } from "./seat-payments";

export type Owed = {
  currency: string;
  orders: { count: number; cents: number; oldestAt: Date | null };
  seats: { count: number; cents: number };
};

export async function readOwed(
  db: DbExecutor,
  shop: { id: string; currency: string },
  now: Date,
): Promise<Owed> {
  const currency = shop.currency.toLowerCase();
  const [[openOrders], seats] = await Promise.all([
    db
      .select({
        count: count(),
        cents: sql<string>`coalesce(sum(${orders.totalCents} - ${orders.amountPaidCents}), 0)`,
        oldestAt: sql<Date | string | null>`min(${orders.createdAt})`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.shopId, shop.id),
          eq(orders.status, "open"),
          eq(sql`lower(${orders.currency})`, currency),
        ),
      ),
    owedSeatsAfterSailing(db, shop.id, now),
  ]);
  const oldest = openOrders?.oldestAt ?? null;
  return {
    currency,
    orders: {
      count: openOrders?.count ?? 0,
      cents: Number(openOrders?.cents ?? 0),
      // An aggregate comes back as text from one driver and a Date from another.
      oldestAt: oldest === null ? null : new Date(oldest),
    },
    seats,
  };
}

/** Whether there is anything owed at all; the line and the email say nothing when not. */
export function owesAnything(owed: Owed): boolean {
  return owed.orders.cents > 0 || owed.seats.cents > 0;
}
