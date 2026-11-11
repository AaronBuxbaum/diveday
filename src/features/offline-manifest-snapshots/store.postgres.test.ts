import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { offlineManifestSnapshotRevisions } from "../../db/schema/index";
import { seedDemo } from "../../db/seed";
import { getShopBySlug } from "../../db/shops";
import { upcomingTripsWithCounts } from "../../db/trips";
import { describePostgres, postgresTestDb } from "../../test/postgres";
import {
  issueOfflineManifestSnapshot,
  nextOfflineManifestSnapshotRevision,
  readOfflineManifestRoster,
} from "./store";

describePostgres("offline manifest snapshot claims on real Postgres (issue #4391)", () => {
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
