import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { offlineManifestSnapshotRevisions } from "../../db/schema/index";
import { createDemoShop } from "../../db/seed";
import { getShopBySlug, getShopOfflineErasureEpoch } from "../../db/shops";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "../../db/trips";
import { createTrip } from "../../db/trips-create";
import { verifyOfflineErasureEpoch } from "../../lib/offline-erasure-epoch";
import { fileScopedShopContext } from "../../test/db";
import { anonymizeDiver } from "../anonymize/store";
import {
  issueOfflineManifestSnapshot,
  nextOfflineManifestSnapshotRevision,
  readOfflineManifestRoster,
} from "./store";

const context = fileScopedShopContext();

async function revisionRows(tripId: string) {
  return context.db
    .select({ revision: offlineManifestSnapshotRevisions.revision })
    .from(offlineManifestSnapshotRevisions)
    .where(eq(offlineManifestSnapshotRevisions.tripId, tripId));
}

describe("offline manifest snapshot ordering", () => {
  it("reads the roster and the erasure epoch it was read at, writing no revision (issue #4391)", async () => {
    const { db, shop } = context;
    const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    if (!trip) throw new Error("offline manifest trip missing");

    const roster = await readOfflineManifestRoster(db, shop.id, trip.id);

    expect(roster?.manifests[0]?.trip.id).toBe(trip.id);
    expect(roster?.erasureEpoch).toBe(shop.offlineErasureEpoch);
    expect(await revisionRows(trip.id)).toEqual([]);
  });

  it("issues increasing server revisions under the erasure fence", async () => {
    const { db, shop } = context;
    const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    if (!trip) throw new Error("offline manifest trip missing");
    const epoch = shop.offlineErasureEpoch;

    const first = await issueOfflineManifestSnapshot(db, shop.id, trip.id, epoch);
    const second = await issueOfflineManifestSnapshot(db, shop.id, trip.id, epoch);
    if (!first.ok || !second.ok) throw new Error("snapshot was not issued");

    expect(first.snapshotRevision).toBe(1);
    expect(second.snapshotRevision).toBe(2);
    expect(
      verifyOfflineErasureEpoch({
        token: second.erasureEpochToken,
        shopId: shop.id,
        tripId: trip.id,
        snapshotId: second.snapshotId,
      }),
    ).toBe(shop.offlineErasureEpoch);
    expect(await revisionRows(trip.id)).toEqual([{ revision: 2 }]);
  });

  it("refuses a valid other-shop trip before writing a counter or returning a snapshot", async () => {
    const { db, shop } = context;
    const { slug } = await createDemoShop(db, { shape: "lean" });
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
    expect(await readOfflineManifestRoster(db, shop.id, otherTrip.id)).toBeNull();
    expect(
      await issueOfflineManifestSnapshot(db, shop.id, otherTrip.id, shop.offlineErasureEpoch),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await revisionRows(otherTrip.id)).toEqual([]);
    await expect(
      db
        .insert(offlineManifestSnapshotRevisions)
        .values({ shopId: shop.id, tripId: otherTrip.id, revision: 1 }),
    ).rejects.toThrow();
  });

  it("refuses to sign rows read before an erasure, writing no revision, and signs a fresh read (issue #4391)", async () => {
    const { db, shop } = context;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((candidate) => candidate.title.startsWith("Two-Tank Reef — Molasses"));
    if (!trip) throw new Error("demo reef trip missing");
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
    if (!seat || !owner) throw new Error("erasure fixture missing");

    // The screen's rows, read while the diver still had a name.
    const before = await readOfflineManifestRoster(db, shop.id, trip.id);
    if (!before) throw new Error("roster missing");
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: seat.booking.personId,
      actorPersonId: owner.person.id,
    });
    expect(erased).toMatchObject({ ok: true });
    const revisionsBefore = await revisionRows(trip.id);

    // A device saving those rows now would carry a pre-erasure name under a
    // token the server could not tell from a fresh one: refused, and nothing
    // is written.
    expect(await issueOfflineManifestSnapshot(db, shop.id, trip.id, before.erasureEpoch)).toEqual({
      ok: false,
      reason: "erasure_epoch_moved",
    });
    expect(await revisionRows(trip.id)).toEqual(revisionsBefore);

    // The page's next read carries the new epoch, and that one is signed.
    const after = await readOfflineManifestRoster(db, shop.id, trip.id);
    if (!after) throw new Error("roster missing after erasure");
    expect(after.erasureEpoch).toBe(before.erasureEpoch + 1);
    expect(after.erasureEpoch).toBe(await getShopOfflineErasureEpoch(db, shop.id));
    const issued = await issueOfflineManifestSnapshot(db, shop.id, trip.id, after.erasureEpoch);
    if (!issued.ok) throw new Error("fresh snapshot was refused");
    expect(
      verifyOfflineErasureEpoch({
        token: issued.erasureEpochToken,
        shopId: shop.id,
        tripId: trip.id,
        snapshotId: issued.snapshotId,
      }),
    ).toBe(after.erasureEpoch);
  });
});
