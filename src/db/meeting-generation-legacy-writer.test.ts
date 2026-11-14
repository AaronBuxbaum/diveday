import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import { meetingIncarnation } from "@/test/meeting-generation";
import { meetingGeneration, twoDayCourse } from "@/test/offline-meeting-test-support";
import { offlineMeetingStillMatches } from "./offline-meeting-proof";
import { tripScheduleDays, trips } from "./schema";

it("does not revive a proof after an older writer changes and restores a meeting window", async () => {
  const { db, shop, reef } = await twoDayCourse();
  const [day] = await db
    .select()
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, reef.id));
  if (!day) throw new Error("meeting missing");
  const snapshotId = crypto.randomUUID();
  const [trip] = await db
    .select({ generation: trips.meetingScheduleGeneration })
    .from(trips)
    .where(eq(trips.id, reef.id));
  if (!trip) throw new Error("trip missing");
  const proof = signOfflineMeetingIdentity({
    shopId: shop.id,
    tripId: reef.id,
    snapshotId,
    meetingId: day.id,
    meetingDay: 0,
    scheduleGeneration: trip.generation,
    datasetIncarnation: await meetingIncarnation(db, reef.id),
    startsAt: day.startsAt,
    endsAt: day.endsAt,
  });
  expect(
    await offlineMeetingStillMatches(db, {
      shopId: shop.id,
      tripId: reef.id,
      snapshotId,
      meetingDay: 0,
      proof,
    }),
  ).toBe(true);
  // Represents a server binary predating the application-maintained counter.
  await db
    .update(tripScheduleDays)
    .set({ endsAt: new Date(day.endsAt.getTime() + 60_000) })
    .where(eq(tripScheduleDays.id, day.id));
  await db
    .update(tripScheduleDays)
    .set({ endsAt: day.endsAt })
    .where(eq(tripScheduleDays.id, day.id));
  expect(
    await offlineMeetingStillMatches(db, {
      shopId: shop.id,
      tripId: reef.id,
      snapshotId,
      meetingDay: 0,
      proof,
    }),
  ).toBe(false);
});

it("does not advance for an unchanged day and rolls back a failed legacy edit", async () => {
  const { db, reef } = await twoDayCourse();
  const [day] = await db
    .select()
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, reef.id));
  if (!day) throw new Error("meeting missing");
  const before = await meetingGeneration(db, reef.id);
  await db
    .update(tripScheduleDays)
    .set({ endsAt: day.endsAt })
    .where(eq(tripScheduleDays.id, day.id));
  expect(await meetingGeneration(db, reef.id)).toBe(before);
  await expect(
    db.transaction(async (tx) => {
      await tx
        .update(tripScheduleDays)
        .set({ endsAt: new Date(day.endsAt.getTime() + 60_000) })
        .where(eq(tripScheduleDays.id, day.id));
      throw new Error("abort edit");
    }),
  ).rejects.toThrow("abort edit");
  expect(await meetingGeneration(db, reef.id)).toBe(before);
  const [after] = await db.select().from(tripScheduleDays).where(eq(tripScheduleDays.id, day.id));
  expect(after?.endsAt).toEqual(day.endsAt);
});

it("does not permit a stale writer to decrease the generation", async () => {
  const { db, reef } = await twoDayCourse();
  const before = await meetingGeneration(db, reef.id);
  expect(before).toBeGreaterThan(0);
  await expect(
    db.transaction(async (tx) => {
      await tx
        .update(trips)
        .set({ meetingScheduleGeneration: before - 1 })
        .where(eq(trips.id, reef.id));
    }),
  ).rejects.toThrow();
  expect(await meetingGeneration(db, reef.id)).toBe(before);
});

it("invalidates an old proof when a legacy trip-time writer moves away and back", async () => {
  const { db, shop, reef } = await twoDayCourse();
  const [day] = await db
    .select()
    .from(tripScheduleDays)
    .where(eq(tripScheduleDays.tripId, reef.id));
  const [trip] = await db.select().from(trips).where(eq(trips.id, reef.id));
  if (!day || !trip) throw new Error("fixture missing");
  const snapshotId = crypto.randomUUID();
  const proof = signOfflineMeetingIdentity({
    shopId: shop.id,
    tripId: reef.id,
    snapshotId,
    meetingId: day.id,
    meetingDay: 0,
    scheduleGeneration: trip.meetingScheduleGeneration,
    datasetIncarnation: await meetingIncarnation(db, reef.id),
    startsAt: day.startsAt,
    endsAt: day.endsAt,
  });
  expect(
    await offlineMeetingStillMatches(db, {
      shopId: shop.id,
      tripId: reef.id,
      snapshotId,
      meetingDay: 0,
      proof,
    }),
  ).toBe(true);
  await db
    .update(trips)
    .set({ endsAt: new Date(trip.endsAt.getTime() + 60_000) })
    .where(eq(trips.id, reef.id));
  await db.update(trips).set({ endsAt: trip.endsAt }).where(eq(trips.id, reef.id));
  expect(
    await offlineMeetingStillMatches(db, {
      shopId: shop.id,
      tripId: reef.id,
      snapshotId,
      meetingDay: 0,
      proof,
    }),
  ).toBe(false);
});

it("advances on a truncated day table and rolls the generation back with the transaction", async () => {
  const { db, reef } = await twoDayCourse();
  const before = await meetingGeneration(db, reef.id);
  await expect(
    db.transaction(async (tx) => {
      await tx.execute(sql`truncate table trip_schedule_days`);
      expect(await meetingGeneration(tx, reef.id)).toBeGreaterThan(before);
      throw new Error("roll back truncate");
    }),
  ).rejects.toThrow("roll back truncate");
  expect(await meetingGeneration(db, reef.id)).toBe(before);
  expect(
    await db.select().from(tripScheduleDays).where(eq(tripScheduleDays.tripId, reef.id)),
  ).toHaveLength(2);
});
