import { eq } from "drizzle-orm";
import { getTripManifest } from "@/db/manifests";
import { tripAssignments, tripScheduleDays } from "@/db/schema";
import { nowMs } from "@/lib/clock";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import { meetingGeneration, meetingIncarnation } from "./meeting-generation";
import { manifestContext } from "./substrate-fixtures/db/manifests-test-fixtures";

export const HOUR = 60 * 60 * 1000;

export { meetingGeneration, meetingIncarnation } from "./meeting-generation";

export async function shownContext(
  db: Parameters<typeof getTripManifest>[0],
  shopId: string,
  tripId: string,
  bookingId: string,
) {
  const context = (await getTripManifest(db, shopId, tripId, "after_dive_1"))?.divers.find(
    (row) => row.bookingId === bookingId,
  )?.rollCallContext;
  if (!context) throw new Error("expected displayed diver context");
  return context;
}

export async function shownCrewContext(
  db: Parameters<typeof getTripManifest>[0],
  shopId: string,
  tripId: string,
  personId: string,
) {
  const context = (await getTripManifest(db, shopId, tripId, "after_dive_1"))?.crew.find(
    (row) => row.id === personId,
  )?.rollCallContext;
  if (!context) throw new Error("expected displayed crew context");
  return context;
}

export async function twoDayCourse() {
  const ctx = await manifestContext();
  const { db, reef, staff } = ctx;
  const now = nowMs();
  await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, reef.id));
  await db.insert(tripScheduleDays).values([
    {
      tripId: reef.id,
      dayNumber: 1,
      startsAt: new Date(now - 26 * HOUR),
      endsAt: new Date(now - 22 * HOUR),
    },
    {
      tripId: reef.id,
      dayNumber: 2,
      startsAt: new Date(now - 2 * HOUR),
      endsAt: new Date(now + 2 * HOUR),
    },
  ]);
  await db
    .insert(tripAssignments)
    .values({ tripId: reef.id, personId: staff.id })
    .onConflictDoNothing();
  return { ...ctx, now };
}

export async function capturedMeeting(
  db: Parameters<typeof getTripManifest>[0],
  shopId: string,
  tripId: string,
  meetingDay: number,
) {
  const days = await db.select().from(tripScheduleDays).where(eq(tripScheduleDays.tripId, tripId));
  const day = days.find((entry) => entry.dayNumber === meetingDay + 1);
  if (!day) throw new Error("fixture meeting missing");
  const offlineSnapshotId = crypto.randomUUID();
  return {
    offlineSnapshotId,
    offlineMeetingIdentityProof: signOfflineMeetingIdentity({
      scheduleGeneration: await meetingGeneration(db, tripId),
      datasetIncarnation: await meetingIncarnation(db, tripId),
      shopId,
      tripId,
      snapshotId: offlineSnapshotId,
      meetingId: day.id,
      startsAt: day.startsAt,
      endsAt: day.endsAt,
      meetingDay,
    }),
  };
}
