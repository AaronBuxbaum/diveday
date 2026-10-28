import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { verifyOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { fileScopedShopContext } from "@/test/db";
import {
  issueOfflineManifestSnapshot,
  nextOfflineManifestSnapshotRevision,
} from "./offline-manifest-snapshots";
import { offlineManifestSnapshotRevisions } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

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

  it("rejects a counter row for a shop that does not own a valid tenant key", async () => {
    const { db } = context;
    const [trip] = await upcomingTripsWithCounts(db, context.shop.id, new Date(0));
    if (!trip) throw new Error("offline manifest trip missing");

    await expect(nextOfflineManifestSnapshotRevision(db, randomUUID(), trip.id)).rejects.toThrow();
  });
});
