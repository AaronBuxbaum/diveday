/** One booking's status, for the seat a no-show releases and a boarding takes back. */

/** Every code on this booking's trail. */
import { asc, eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { activityEvents, bookings } from "./schema";

export async function statusOf(db: AppDb, bookingId: string) {
  const [row] = await db
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row?.status;
}

export async function activityCodesFor(db: AppDb, bookingId: string) {
  // diveday:allow-unscoped-event: inspect this isolated test booking's complete audit trail, including evidence that a writer did not append an event.
  const rows = await db
    .select({ code: activityEvents.code, occurredAt: activityEvents.occurredAt })
    .from(activityEvents)
    .where(eq(activityEvents.bookingId, bookingId))
    // diveday:allow-time-id-order: test-only audit inspection; no staff or diver list is rendered from this order.
    .orderBy(asc(activityEvents.occurredAt), asc(activityEvents.id));
  return rows.map((row) => row.code);
}
