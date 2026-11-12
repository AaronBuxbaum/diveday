import { eq } from "drizzle-orm";
import { isShopDayParam } from "@/lib/calendar-date";
import { verifyDayWindows } from "@/lib/schedule-day-proof";
import { shopDaysBounds } from "@/lib/zoned";
import type { DbExecutor } from "./client";
import { tripScheduleDays } from "./schema";

/** Recheck a view's day against the legs after its departure row is locked. */
export type ExpectedScheduleDay = {
  day: string;
  timeZone: string;
  fromProof?: string;
  toProof?: string;
};

export async function departureOccupiesDay(
  tx: DbExecutor,
  trip: { id: string; startsAt: Date; endsAt: Date },
  expected: ExpectedScheduleDay,
  shopId: string,
  proof?: string,
): Promise<boolean> {
  if (!isShopDayParam(expected.day)) return false;
  const { from, to } = shopDaysBounds(expected.day, expected.day, expected.timeZone);
  const days = await tx
    .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, trip.id));
  const windows = days.length ? days : [trip];
  if (
    proof !== undefined &&
    !verifyDayWindows(proof, shopId, trip.id, expected.day, expected.timeZone, windows)
  )
    return false;
  return windows.some((day) => day.startsAt < to && day.endsAt > from);
}
