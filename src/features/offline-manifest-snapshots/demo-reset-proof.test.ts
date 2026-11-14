import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { offlineMeetingStillMatches } from "@/db/offline-meeting-proof";
import { tripScheduleDays, trips } from "@/db/schema";
import { resetDemoSchedule } from "@/db/seed";
import { upcomingTripsWithCounts } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { issueOfflineManifestSnapshot, readOfflineManifestRoster } from "./store";

const ctx = fileScopedShopContext({ history: true });

it("does not accept an old device proof after a reset recreates the same meeting", async () => {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("trip missing");
  const before = await readOfflineManifestRoster(db, shop.id, trip.id);
  if (!before) throw new Error("roster missing");
  const issued = await issueOfflineManifestSnapshot(db, shop.id, trip.id, before);
  if (!issued.ok || !issued.meetingIdentityProofs[0]) throw new Error("proof missing");
  const input = {
    shopId: shop.id,
    tripId: trip.id,
    snapshotId: issued.snapshotId,
    meetingDay: 0,
    proof: issued.meetingIdentityProofs[0],
  };
  expect(await db.transaction((tx) => offlineMeetingStillMatches(tx, input))).toBe(true);
  await resetDemoSchedule(db, shop.id, "history");
  // Model snapshot replay in the disposable test transaction, including the
  // trigger setting the real replay uses. This is not the replay implementation.
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    for (const [index, day] of before.meetingDays.entries()) {
      await tx
        .update(tripScheduleDays)
        .set({ id: day.id, startsAt: day.startsAt, endsAt: day.endsAt })
        .where(
          and(eq(tripScheduleDays.tripId, trip.id), eq(tripScheduleDays.dayNumber, index + 1)),
        );
    }
    await tx
      .update(trips)
      .set({ meetingScheduleGeneration: before.meetingDays[0].scheduleGeneration })
      .where(eq(trips.id, trip.id));
    await tx.execute(sql`set local session_replication_role = origin`);
  });
  const after = await readOfflineManifestRoster(db, shop.id, trip.id);
  if (!after) throw new Error("reset did not recreate the same trip");
  expect(after.meetingDays).toEqual(before.meetingDays);
  expect(await db.transaction((tx) => offlineMeetingStillMatches(tx, input))).toBe(false);
  expect(await issueOfflineManifestSnapshot(db, shop.id, trip.id, before)).toMatchObject({
    ok: false,
  });
  const fresh = await issueOfflineManifestSnapshot(db, shop.id, trip.id, after);
  if (!fresh.ok || !fresh.meetingIdentityProofs[0]) throw new Error("fresh proof missing");
  expect(
    await db.transaction((tx) =>
      offlineMeetingStillMatches(tx, {
        ...input,
        snapshotId: fresh.snapshotId,
        proof: fresh.meetingIdentityProofs[0],
      }),
    ),
  ).toBe(true);
});
