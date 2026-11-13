import { and, eq, inArray } from "drizzle-orm";
import { shiftsCoverWindow } from "@/lib/shift-coverage";
import type { DbExecutor } from "./client";
import { shops, staffShifts, tripScheduleDays } from "./schema";

/** Advance planning only. Operational crew/roll-call writes must remain able to
 * record who is actually aboard. Caller holds the trip lock; qualifying shift
 * rows stay share-locked until the assignment commits, so a concurrent removal
 * cannot make a successful planning write rely on a deleted shift.
 */
export async function crewHaveScheduledShifts(
  tx: DbExecutor,
  shopId: string,
  trip: { id: string; startsAt: Date; endsAt: Date },
  personIds: readonly string[],
): Promise<boolean> {
  if (personIds.length === 0) return true;
  const [shop] = await tx
    .select({ enabled: shops.crewScheduleEnabled })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return false;
  if (!shop.enabled) return true;
  const days = await tx
    .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, trip.id));
  const windows = days.length ? days : [trip];
  const rows = await tx
    .select({
      personId: staffShifts.personId,
      startsAt: staffShifts.startsAt,
      endsAt: staffShifts.endsAt,
    })
    .from(staffShifts)
    .where(and(eq(staffShifts.shopId, shopId), inArray(staffShifts.personId, [...personIds])))
    .for("share");
  return personIds.every((personId) =>
    windows.every((window) =>
      shiftsCoverWindow(
        rows.filter((row) => row.personId === personId),
        window,
      ),
    ),
  );
}
