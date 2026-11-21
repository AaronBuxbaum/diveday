import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { loadActiveStaffRoles } from "../../../db/authz";
import type { AppDb } from "../../../db/client";
import { activityEvents, orders } from "../../../db/schema";
import { isStaff } from "../../../lib/authz";
import { calendarDateInTimezone, isValidCalendarDate } from "../../../lib/calendar-date";
import { nowDate } from "../../../lib/clock";
import { shopDaysBounds } from "../../../lib/zoned";
import { retentionCutoff } from "../../records/retention";

function add(sum: number | null, amount: number): number | null {
  return sum !== null &&
    Number.isSafeInteger(amount) &&
    amount >= 0 &&
    Number.isSafeInteger(sum + amount)
    ? sum + amount
    : null;
}
/** Original receipt methods, not cash movement or provider settlement. Returns remain separate. */
export async function recordedPurchaseDay(
  db: AppDb,
  shop: { id: string; timezone: string },
  actorPersonId: string,
  requestedDay?: string,
) {
  const roles = await loadActiveStaffRoles(db, shop.id, actorPersonId);
  if (!roles || !isStaff(roles)) return null;
  const day =
    requestedDay && isValidCalendarDate(requestedDay)
      ? requestedDay
      : calendarDateInTimezone(nowDate(), shop.timezone);
  const { from, to } = shopDaysBounds(day, day, shop.timezone);
  const receipts = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shop.id),
        isNotNull(orders.counterReceipt),
        gte(orders.paidAt, from),
        lt(orders.paidAt, to),
      ),
    );
  const returns = await db
    .select({
      amount: sql<string | null>`${activityEvents.params} ->> 'amountCents'`,
      currency: orders.currency,
    })
    .from(activityEvents)
    .innerJoin(
      orders,
      and(
        eq(orders.id, activityEvents.orderId),
        eq(orders.shopId, shop.id),
        isNotNull(orders.counterReceipt),
      ),
    )
    // diveday:allow-staff-events: receipt-return aggregates use financial facts only, never notes or names.
    .where(
      and(
        eq(activityEvents.shopId, shop.id),
        eq(activityEvents.code, "order_refunded"),
        gte(activityEvents.occurredAt, from),
        lt(activityEvents.occurredAt, to),
      ),
    );
  const groups = new Map<
    string,
    {
      currency: string;
      method: string;
      count: number;
      grossCents: number | null;
      taxCents: number | null;
      tipCents: number | null;
      unknownTax: number;
    }
  >();
  let voided = 0;
  for (const order of receipts) {
    if (order.status === "void") {
      voided += 1;
      continue;
    }
    const key = `${order.currency}:${order.collection}`;
    const group = groups.get(key) ?? {
      currency: order.currency,
      method: order.collection,
      count: 0,
      grossCents: 0,
      taxCents: 0,
      tipCents: 0,
      unknownTax: 0,
    };
    group.count += 1;
    group.grossCents = add(group.grossCents, order.totalCents);
    group.taxCents = add(group.taxCents, order.counterReceipt?.taxCents ?? 0);
    group.tipCents = add(group.tipCents, order.counterReceipt?.tipCents ?? 0);
    if (!order.counterReceipt?.taxKnown) group.unknownTax += 1;
    groups.set(key, group);
  }
  const returned = new Map<
    string,
    { currency: string; count: number; amountCents: number | null; unknownAmount: number }
  >();
  for (const row of returns) {
    const group = returned.get(row.currency) ?? {
      currency: row.currency,
      count: 0,
      amountCents: 0,
      unknownAmount: 0,
    };
    group.count += 1;
    const raw = row.amount;
    if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      group.unknownAmount += 1;
      group.amountCents = null;
    } else group.amountCents = add(group.amountCents, Number(raw));
    returned.set(row.currency, group);
  }
  return {
    day,
    timezone: shop.timezone,
    receipts: [...groups.values()].sort(
      (a, b) => a.currency.localeCompare(b.currency) || a.method.localeCompare(b.method),
    ),
    returns: [...returned.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    voided,
    historyMayBePruned: from < retentionCutoff("activity_events", nowDate()),
  };
}
export type RecordedPurchaseDay = NonNullable<Awaited<ReturnType<typeof recordedPurchaseDay>>>;
