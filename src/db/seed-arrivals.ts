import type { DbExecutor } from "./client";
import { bookingArrivalEvents } from "./schema";

/**
 * **A seeded seat the desk saw**, written where every reader looks for it: the
 * arrival trail (issue #2702). The seat itself stays `booked`; a scenario that
 * wants "checked in" calls this instead of setting a status, because no status
 * says it any more. A direct insert, like the scenarios' roll-call rows: the
 * live writer re-reads readiness and refuses a departure that has sailed,
 * which is right for a desk and wrong for history.
 */
export async function seedArrivals(
  db: DbExecutor,
  rows: readonly {
    shopId: string;
    tripId: string;
    bookingId: string;
    recordedByPersonId: string;
    occurredAt: Date;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(bookingArrivalEvents)
    .values(rows.map((row) => ({ ...row, status: "arrived" as const, source: "live" as const })));
}
