import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { verifyOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { fileScopedShopContext } from "@/test/db";
import {
  issueOfflineManifestSnapshot,
  nextOfflineManifestSnapshotRevision,
} from "./offline-manifest-snapshots";
import { offlineManifestSnapshotRevisions } from "./schema";
import { createDemoShop } from "./seed";
import { getShopBySlug } from "./shops";
import { upcomingTripsWithCounts } from "./trips";
import { createTrip } from "./trips-create";

const context = fileScopedShopContext();

describe("offline manifest snapshot ordering", () => {
  it("issues increasing server revisions under the erasure fence", async () => {
    const { db, shop } = context;
    const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    if (!trip) throw new Error("offline manifest trip missing");

    const first = await issueOfflineManifestSnapshot(db, shop.id, trip.id);
    const second = await issueOfflineManifestSnapshot(db, shop.id, trip.id);

    expect(first?.snapshotRevision).toBe(1);
    expect(second?.snapshotRevision).toBe(2);
    expect(
      verifyOfflineErasureEpoch({
        token: second?.erasureEpochToken,
        shopId: shop.id,
        tripId: trip.id,
        snapshotId: second?.snapshotId,
      }),
    ).toBe(shop.offlineErasureEpoch);
    const [counter] = await db
      .select({ revision: offlineManifestSnapshotRevisions.revision })
      .from(offlineManifestSnapshotRevisions)
      .where(eq(offlineManifestSnapshotRevisions.tripId, trip.id));
    expect(counter?.revision).toBe(2);
  });

  it("refuses a valid other-shop trip before writing a counter or returning a snapshot", async () => {
    const { db, shop } = context;
    const { slug } = await createDemoShop(db, { history: false });
    const otherShop = await getShopBySlug(db, slug);
    if (!otherShop) throw new Error("second test shop missing");
    const otherTrip = await createTrip(db, {
      shopId: otherShop.id,
      title: "Other shop's real trip",
      startsAt: new Date("2026-11-01T09:00:00.000Z"),
      endsAt: new Date("2026-11-01T13:00:00.000Z"),
      capacity: 6,
      plannedDives: 1,
    });
    if (!otherTrip) throw new Error("other-shop trip could not be created");

    expect(await nextOfflineManifestSnapshotRevision(db, shop.id, otherTrip.id)).toBeNull();
    expect(await issueOfflineManifestSnapshot(db, shop.id, otherTrip.id)).toBeNull();
    const crossTenantCounter = await db
      .select()
      .from(offlineManifestSnapshotRevisions)
      .where(eq(offlineManifestSnapshotRevisions.tripId, otherTrip.id));
    expect(crossTenantCounter).toEqual([]);
    await expect(
      db
        .insert(offlineManifestSnapshotRevisions)
        .values({ shopId: shop.id, tripId: otherTrip.id, revision: 1 }),
    ).rejects.toThrow();
  });
});
