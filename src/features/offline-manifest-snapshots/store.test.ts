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
import { seatDiver } from "../seat-diver/store";
import {
  issueOfflineManifestSnapshot,
  latestOfflineManifestSnapshotRevisions,
  nextOfflineManifestSnapshotRevision,
  readOfflineManifestRoster,
} from "./store";
import { offlineSyncInstants } from "./sync-instants";

const context = fileScopedShopContext();

async function revisionRows(tripId: string) {
  return context.db
    .select({ revision: offlineManifestSnapshotRevisions.revision })
    .from(offlineManifestSnapshotRevisions)
    .where(eq(offlineManifestSnapshotRevisions.tripId, tripId));
}

async function tripTitled(prefix: string) {
  const { db, shop } = context;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((candidate) => candidate.title.startsWith(prefix));
  if (!trip) throw new Error(`demo trip ${prefix} missing`);
  return trip;
}

describe("offline manifest snapshot ordering", () => {
  it("reads a new seat and then removes the erased name on later reads", async () => {
    const { db, shop } = context;
    const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
    if (!owner) throw new Error("owner missing");
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Roster freshness test",
      startsAt: new Date("2099-11-01T09:00:00.000Z"),
      endsAt: new Date("2099-11-01T13:00:00.000Z"),
      capacity: 6,
      plannedDives: 1,
    });
    if (!trip) throw new Error("trip missing");
    const before = await readOfflineManifestRoster(db, shop.id, trip.id);
    expect(before?.manifests[0]?.divers).toHaveLength(0);
    const seated = await seatDiver(db, {
      shopId: shop.id,
      tripId: trip.id,
      actorPersonId: owner.person.id,
      diver: { fullName: "Freshness Test Diver", email: "freshness-test@example.com" },
      entry: "roster",
      refusals: "coarse",
    });
    expect(seated.ok).toBe(true);
    const afterSeat = await readOfflineManifestRoster(db, shop.id, trip.id);
    expect(afterSeat?.manifests[0]?.divers.map((diver) => diver.fullName)).toContain(
      "Freshness Test Diver",
    );
    const [seat] = await getTripRoster(db, shop.id, trip.id);
    if (!seat) throw new Error("seat missing");
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: seat.booking.personId,
        actorPersonId: owner.person.id,
      }),
    ).toMatchObject({ ok: true });
    const afterErasure = await readOfflineManifestRoster(db, shop.id, trip.id);
    expect(afterErasure?.manifests[0]?.divers.map((diver) => diver.fullName)).not.toContain(
      "Freshness Test Diver",
    );
  });

  it("returns no stored instants for an empty retry request", async () => {
    const { db, shop } = context;
    expect(await offlineSyncInstants(db, shop.id, [])).toEqual(new Map());
  });

  it("reads the roster, the erasure epoch and the snapshot revision it was read at, writing nothing (issue #4391)", async () => {
    const { db, shop } = context;
    const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    if (!trip) throw new Error("offline manifest trip missing");

    const roster = await readOfflineManifestRoster(db, shop.id, trip.id);

    expect(roster?.manifests[0]?.trip.id).toBe(trip.id);
    expect(roster?.erasureEpoch).toBe(shop.offlineErasureEpoch);
    // No snapshot was ever issued for this trip: the read says so, and writes no counter.
    expect(roster?.snapshotRevision).toBe(0);
    expect(await revisionRows(trip.id)).toEqual([]);
  });

  it("issues increasing server revisions under the erasure fence, each for the read before it", async () => {
    const { db, shop } = context;
    const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    if (!trip) throw new Error("offline manifest trip missing");
    const epoch = shop.offlineErasureEpoch;

    const first = await issueOfflineManifestSnapshot(db, shop.id, trip.id, {
      erasureEpoch: epoch,
      snapshotRevision: 0,
    });
    const read = await readOfflineManifestRoster(db, shop.id, trip.id);
    if (!read) throw new Error("roster missing");
    expect(read.snapshotRevision).toBe(1);
    const second = await issueOfflineManifestSnapshot(db, shop.id, trip.id, read);
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

  it("refuses rows read before another snapshot was issued, writing nothing (dock-operator review)", async () => {
    const { db, shop } = context;
    const trip = await tripTitled("Two-Tank Reef — Christ");

    // The page's rows, read before any copy of this departure existed.
    const read = await readOfflineManifestRoster(db, shop.id, trip.id);
    if (!read) throw new Error("roster missing");
    const base = read.snapshotRevision;
    // A newer read is issued first: the layout's board, under the fence.
    expect(await nextOfflineManifestSnapshotRevision(db, shop.id, trip.id)).toBe(base + 1);

    // Signing the older read now would order it after the newer copy.
    expect(await issueOfflineManifestSnapshot(db, shop.id, trip.id, read)).toEqual({
      ok: false,
      reason: "snapshot_superseded",
    });
    expect(await revisionRows(trip.id)).toEqual([{ revision: base + 1 }]);

    // Two claims from the same read: the first is issued, the second refused
    // (the concurrent case is `store.postgres.test.ts`).
    const reread = await readOfflineManifestRoster(db, shop.id, trip.id);
    if (!reread) throw new Error("roster missing");
    expect(await issueOfflineManifestSnapshot(db, shop.id, trip.id, reread)).toMatchObject({
      ok: true,
      snapshotRevision: base + 2,
    });
    expect(await issueOfflineManifestSnapshot(db, shop.id, trip.id, reread)).toEqual({
      ok: false,
      reason: "snapshot_superseded",
    });
    expect(await revisionRows(trip.id)).toEqual([{ revision: base + 2 }]);
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
      await issueOfflineManifestSnapshot(db, shop.id, otherTrip.id, {
        erasureEpoch: shop.offlineErasureEpoch,
        snapshotRevision: 0,
      }),
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
    const trip = await tripTitled("Two-Tank Reef — Molasses");
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
    expect(await issueOfflineManifestSnapshot(db, shop.id, trip.id, before)).toEqual({
      ok: false,
      reason: "erasure_epoch_moved",
    });
    expect(await revisionRows(trip.id)).toEqual(revisionsBefore);

    // The page's next read carries the new epoch, and that one is signed.
    const after = await readOfflineManifestRoster(db, shop.id, trip.id);
    if (!after) throw new Error("roster missing after erasure");
    expect(after.erasureEpoch).toBe(before.erasureEpoch + 1);
    expect(after.erasureEpoch).toBe(await getShopOfflineErasureEpoch(db, shop.id));
    const issued = await issueOfflineManifestSnapshot(db, shop.id, trip.id, after);
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

  it("answers each departure's latest revision, 0 before any, and nothing for another shop", async () => {
    const { db, shop } = context;
    const board = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const [issued, untouched] = [board.at(-1), board.at(-2)];
    if (!issued || !untouched) throw new Error("offline manifest trips missing");
    const before = (await latestOfflineManifestSnapshotRevisions(db, shop.id, [issued.id]))[
      issued.id
    ];
    await nextOfflineManifestSnapshotRevision(db, shop.id, issued.id);
    await nextOfflineManifestSnapshotRevision(db, shop.id, issued.id);

    const latest = await latestOfflineManifestSnapshotRevisions(db, shop.id, [
      issued.id,
      untouched.id,
    ]);
    expect(latest[issued.id]).toBe((before ?? 0) + 2);
    expect(latest[untouched.id]).toBeGreaterThanOrEqual(0);
    expect(await latestOfflineManifestSnapshotRevisions(db, shop.id, [])).toEqual({});
    // Another shop's id reads as no copy ever issued: the row is scoped by shop.
    const elsewhere = "00000000-0000-4000-8000-000000000000";
    expect(await latestOfflineManifestSnapshotRevisions(db, elsewhere, [issued.id])).toEqual({
      [issued.id]: 0,
    });
  });
});
