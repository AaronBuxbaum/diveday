import { and, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { workOrders } from "@/db/schema";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS } from "@/lib/clock";

/**
 * **The bench running behind** (ADR 20261008-work-order-follow-up): the
 * seeded in-progress ticket's promised day moved to two days ago, and the
 * ticket waiting on a part moved to ready nine days ago, so Today carries one
 * late row and one uncollected row. Dragged rather than seeded: a demo bench
 * that is always behind is a worse demo.
 */
export async function putTheBenchBehind(db: AppDb, shopId: string, now: Date, timezone: string) {
  await db
    .update(workOrders)
    .set({
      promisedOn: calendarDateInTimezone(new Date(now.getTime() - 2 * 24 * HOUR_MS), timezone),
    })
    .where(and(eq(workOrders.shopId, shopId), eq(workOrders.status, "in_progress")));
  await db
    .update(workOrders)
    .set({ status: "ready", readyAt: new Date(now.getTime() - 9 * 24 * HOUR_MS) })
    .where(and(eq(workOrders.shopId, shopId), eq(workOrders.status, "waiting_on_parts")));
}
