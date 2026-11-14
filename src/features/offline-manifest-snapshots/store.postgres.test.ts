import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { offlineManifestSnapshotRevisions } from "../../db/schema/index";
import { seedDemo } from "../../db/seed";
import { getShopBySlug } from "../../db/shops";
import { createTrip, editTripSection, upcomingTripsWithCounts } from "../../db/trips";
import {
  describePostgres,
  holdRowLock,
  postgresTestDb,
  waitForLockWaiters,
} from "../../test/postgres";
import {
  issueOfflineManifestSnapshot,
  nextOfflineManifestSnapshotRevision,
  readOfflineManifestRoster,
} from "./store";

describePostgres("offline manifest snapshot claims on real Postgres (issue #4391)", () => {
  it("does not issue an old roster while a schedule edit wins the trip lock", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const startsAt = new Date("2099-11-01T09:00:00Z");
    const endsAt = new Date("2099-11-01T13:00:00Z");
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Schedule claim race",
      startsAt,
      endsAt,
      capacity: 6,
      plannedDives: 1,
    });
    if (!trip) throw new Error("trip missing");
    const read = await readOfflineManifestRoster(pg.db, shop.id, trip.id);
    const day = read?.meetingDays[0];
    if (!read || !day) throw new Error("meeting missing");
    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const edit = editTripSection(pg.connect(), shop.id, trip.id, {
      endsAt: new Date(endsAt.getTime() + 60_000),
      scheduleDays: [
        { id: day.id, dayNumber: 1, startsAt, endsAt: new Date(endsAt.getTime() + 60_000) },
      ],
      expectedScheduleDayIds: [day.id],
      expectedScheduleVersion: JSON.stringify([
        [day.id, startsAt.toISOString(), endsAt.toISOString()],
      ]),
    });
    let claim: ReturnType<typeof issueOfflineManifestSnapshot> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      claim = issueOfflineManifestSnapshot(pg.connect(), shop.id, trip.id, read);
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    if (!claim) throw new Error("claim did not start");
    expect(await edit).toMatchObject({ ok: true });
    expect(await claim).toEqual({ ok: false, reason: "snapshot_superseded" });
  });
  it("issues exactly one snapshot for two devices claiming the same read at once", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    if (!trip) throw new Error("trip missing");
    await nextOfflineManifestSnapshotRevision(pg.db, shop.id, trip.id);
    const read = await readOfflineManifestRoster(pg.db, shop.id, trip.id);
    if (!read) throw new Error("roster missing");
    expect(read.snapshotRevision).toBe(1);

    // Two connections, so the two transactions truly overlap on the counter row.
    const claims = await Promise.all([
      issueOfflineManifestSnapshot(pg.connect(), shop.id, trip.id, read),
      issueOfflineManifestSnapshot(pg.connect(), shop.id, trip.id, read),
    ]);

    expect(claims.filter((claim) => claim.ok)).toMatchObject([{ snapshotRevision: 2 }]);
    expect(claims.filter((claim) => !claim.ok)).toEqual([
      { ok: false, reason: "snapshot_superseded" },
    ]);
    const counter = await pg.db
      .select({ revision: offlineManifestSnapshotRevisions.revision })
      .from(offlineManifestSnapshotRevisions)
      .where(eq(offlineManifestSnapshotRevisions.tripId, trip.id));
    expect(counter).toEqual([{ revision: 2 }]);
  });

  it("issues exactly one first snapshot when two devices claim a never-saved departure at once", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    if (!trip) throw new Error("trip missing");
    const read = await readOfflineManifestRoster(pg.db, shop.id, trip.id);
    if (!read) throw new Error("roster missing");
    expect(read.snapshotRevision).toBe(0);

    const claims = await Promise.all([
      issueOfflineManifestSnapshot(pg.connect(), shop.id, trip.id, read),
      issueOfflineManifestSnapshot(pg.connect(), shop.id, trip.id, read),
    ]);

    expect(claims.filter((claim) => claim.ok)).toMatchObject([{ snapshotRevision: 1 }]);
    expect(claims.filter((claim) => !claim.ok)).toEqual([
      { ok: false, reason: "snapshot_superseded" },
    ]);
  });
});
