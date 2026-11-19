import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { tripScheduleDays } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { createTrip, editTrip, listStaff, moveTrip } from "@/db/trips";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { buildOfflineManifestCopies } from "./payload";
import { nextOfflineManifestSnapshotRevision } from "./store";

vi.mock("@/i18n/request", () => ({ requestLocale: async () => "en-US" }));

async function fixture() {
  const pg = await postgresTestDb();
  await seedDemo(pg.db, "history");
  const shop = await getShopBySlug(pg.db, "blue-mantis");
  if (!shop) throw new Error("shop missing");
  const [staff] = await listStaff(pg.db, shop.id);
  if (!staff) throw new Error("staff missing");
  const first = new Date("2035-04-10T12:00:00.000Z");
  const days = [0, 1].map((day) => ({
    dayNumber: day + 1,
    startsAt: new Date(first.getTime() + day * 86_400_000),
    endsAt: new Date(first.getTime() + day * 86_400_000 + 4 * 3_600_000),
  }));
  const trip = await createTrip(pg.db, {
    shopId: shop.id,
    title: "Snapshot schedule race",
    startsAt: days[0].startsAt,
    endsAt: days[1].endsAt,
    capacity: 8,
    scheduleDays: days,
  });
  if (!trip) throw new Error("trip missing");
  const shifted = days.map((day) => ({
    dayNumber: day.dayNumber,
    startsAt: new Date(day.startsAt.getTime() + 3_600_000),
    endsAt: new Date(day.endsAt.getTime() + 3_600_000),
  }));
  return { pg, shop, staff, trip, days, shifted };
}

function expected(days: { startsAt: Date; endsAt: Date }[]) {
  return days.map((day) => ({
    startsAt: day.startsAt.toISOString(),
    endsAt: day.endsAt.toISOString(),
  }));
}

describePostgres("offline snapshots against meeting schedule changes", () => {
  for (const operation of ["move", "edit"] as const) {
    it(`uses committed new meeting windows when ${operation} owns the trip first`, async () => {
      const { pg, shop, staff, trip, days, shifted } = await fixture();
      const target = operation === "edit" ? [days[0], shifted[1]] : shifted;
      const gate = await holdRowLock(
        pg,
        sql`select id from trips where id = ${trip.id} for update`,
      );
      onTestFinished(async () => gate.release());
      const moved =
        operation === "move"
          ? moveTrip(pg.connect(), shop.id, trip.id, shifted[0].startsAt)
          : editTrip(pg.connect(), shop.id, trip.id, {
              title: trip.title,
              startsAt: target[0].startsAt,
              endsAt: target[1].endsAt,
              capacity: trip.capacity,
              plannedDives: trip.plannedDives,
              scheduleDays: target,
            });
      await waitForLockWaiters(pg.db, 1);
      const copied = buildOfflineManifestCopies(pg.connect(), shop, staff.person.id, [trip.id]);
      try {
        // This only establishes the contention; the payload assertions below prove coherence.
        await waitForLockWaiters(pg.db, 2);
      } finally {
        await gate.release();
      }
      expect((await moved).ok).toBe(true);
      const snapshot = await copied;
      expect(snapshot.payloads).toHaveLength(1);
      expect(snapshot.payloads[0].rollCallMeetingDays).toEqual(expected(target));
      expect(snapshot.payloads[0].manifests[0].trip.startsAt).toBe(
        target[0].startsAt.toISOString(),
      );
    });

    it(`uses old meeting windows while its trip lock holds a later ${operation}`, async () => {
      const { pg, shop, staff, trip, days, shifted } = await fixture();
      const target = operation === "edit" ? [days[0], shifted[1]] : shifted;
      await nextOfflineManifestSnapshotRevision(pg.db, shop.id, trip.id);
      const gate = await holdRowLock(
        pg,
        sql`select trip_id from offline_manifest_snapshot_revisions where trip_id = ${trip.id} for update`,
      );
      onTestFinished(async () => gate.release());
      const copied = buildOfflineManifestCopies(pg.connect(), shop, staff.person.id, [trip.id]);
      await waitForLockWaiters(pg.db, 1);
      const moved =
        operation === "move"
          ? moveTrip(pg.connect(), shop.id, trip.id, shifted[0].startsAt)
          : editTrip(pg.connect(), shop.id, trip.id, {
              title: trip.title,
              startsAt: target[0].startsAt,
              endsAt: target[1].endsAt,
              capacity: trip.capacity,
              plannedDives: trip.plannedDives,
              scheduleDays: target,
            });
      try {
        await waitForLockWaiters(pg.db, 2);
      } finally {
        await gate.release();
      }
      const snapshot = await copied;
      expect(snapshot.payloads).toHaveLength(1);
      expect(snapshot.payloads[0].rollCallMeetingDays).toEqual(expected(days));
      expect(snapshot.payloads[0].manifests[0].trip.startsAt).toBe(days[0].startsAt.toISOString());
      expect((await moved).ok).toBe(true);
      const stored = await pg.db
        .select({ startsAt: tripScheduleDays.startsAt, endsAt: tripScheduleDays.endsAt })
        .from(tripScheduleDays)
        .where(eq(tripScheduleDays.tripId, trip.id));
      expect(expected(stored)).toEqual(expected(target));
    });
  }
});
