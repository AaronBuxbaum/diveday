import { and, asc, eq } from "drizzle-orm";
import { verifyOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import type { DbExecutor } from "./client";
import { shops, tripScheduleDays, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** Call only while holding the trip lock, after duplicate detection. */
export async function offlineMeetingStillMatches(
  tx: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    snapshotId?: string;
    meetingDay?: number;
    proof?: string;
  },
): Promise<boolean> {
  if (input.meetingDay === undefined || !input.snapshotId) return false;
  const [ownedTrip] = await tx
    .select({
      generation: trips.meetingScheduleGeneration,
      datasetIncarnation: shops.offlineDatasetIncarnation,
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
    .limit(1);
  if (!ownedTrip) return false;
  const verified = verifyOfflineMeetingIdentity({
    token: input.proof,
    shopId: input.shopId,
    tripId: input.tripId,
    snapshotId: input.snapshotId,
    meetingDay: input.meetingDay,
    scheduleGeneration: ownedTrip.generation,
    datasetIncarnation: ownedTrip.datasetIncarnation,
  });
  if (!verified) return false;
  const days = await tx
    .select({
      id: tripScheduleDays.id,
      startsAt: tripScheduleDays.startsAt,
      endsAt: tripScheduleDays.endsAt,
    })
    .from(tripScheduleDays)
    .innerJoin(trips, eq(trips.id, tripScheduleDays.tripId))
    .where(
      and(eq(tripScheduleDays.tripId, input.tripId), eq(trips.shopId, input.shopId), liveTrip()),
    )
    .orderBy(asc(tripScheduleDays.dayNumber));
  const [implicit] =
    days.length === 0
      ? await tx
          .select({ id: trips.id, startsAt: trips.startsAt, endsAt: trips.endsAt })
          .from(trips)
          .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
          .limit(1)
      : [];
  const day = days[input.meetingDay] ?? (input.meetingDay === 0 ? implicit : undefined);
  return (
    day?.id === verified.meetingId &&
    day.startsAt.getTime() === verified.startsAt &&
    day.endsAt.getTime() === verified.endsAt
  );
}
