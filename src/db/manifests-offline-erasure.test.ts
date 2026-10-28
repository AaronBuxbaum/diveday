import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { fileScopedShopContext } from "@/test/db";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { rollCallCrewEvents, rollCallEvents, shops } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

const context = fileScopedShopContext();

async function fixture() {
  const { db, shop } = context;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((candidate) => candidate.title.startsWith("Two-Tank Reef — Molasses"));
  if (!trip) throw new Error("demo reef trip missing");
  const [booking] = await getTripRoster(db, shop.id, trip.id);
  const [staff] = await listStaff(db, shop.id);
  const manifest = await getTripManifest(db, shop.id, trip.id);
  if (!booking || !staff || !manifest?.crew[0]) throw new Error("roll-call fixture missing");
  return { db, shop, trip, booking, staff: staff.person, crew: manifest.crew[0] };
}

describe("offline roll-call notes after erasure", () => {
  it("keeps a crew mark but drops its note when its signed snapshot predates erasure", async () => {
    const { db, shop, trip, staff, crew } = await fixture();
    const issuedEpoch = shop.offlineErasureEpoch;
    const snapshotId = "33333333-3333-4333-8333-333333333333";
    const occurredAt = nowDate();
    await db
      .update(shops)
      .set({ offlineErasureEpoch: issuedEpoch + 1 })
      .where(eq(shops.id, shop.id));

    const result = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      source: "offline",
      clientEventId: "44444444-4444-4444-8444-444444444444",
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 1_000),
      offlineSnapshotId: snapshotId,
      offlineErasureEpochToken: signOfflineErasureEpoch({
        shopId: shop.id,
        tripId: trip.id,
        snapshotId,
        epoch: issuedEpoch,
      }),
      occurredAt,
      note: "Maya Rivera was seen at the ladder.",
    });

    expect(result).toMatchObject({ ok: true, noteDisposition: "discarded_erasure_cutoff" });
    const [event] = await db
      .select({
        note: rollCallCrewEvents.note,
        status: rollCallCrewEvents.status,
        occurredAt: rollCallCrewEvents.occurredAt,
      })
      .from(rollCallCrewEvents)
      .where(eq(rollCallCrewEvents.clientEventId, "44444444-4444-4444-8444-444444444444"));
    expect(event).toEqual({ note: null, status: "not_boarded", occurredAt });
  });

  it("keeps a diver mark and tap time but drops a note from a pre-erasure snapshot", async () => {
    const { db, shop, trip, booking, staff } = await fixture();
    const issuedEpoch = shop.offlineErasureEpoch;
    const snapshotId = "11111111-1111-4111-8111-111111111111";
    const occurredAt = nowDate();
    await db
      .update(shops)
      .set({ offlineErasureEpoch: issuedEpoch + 1 })
      .where(eq(shops.id, shop.id));

    const result = await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      source: "offline",
      clientEventId: "22222222-2222-4222-8222-222222222222",
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 1_000),
      offlineSnapshotId: snapshotId,
      offlineErasureEpochToken: signOfflineErasureEpoch({
        shopId: shop.id,
        tripId: trip.id,
        snapshotId,
        epoch: issuedEpoch,
      }),
      occurredAt,
      note: "Maya Rivera was seen at the ladder.",
    });

    expect(result).toMatchObject({ ok: true, noteDisposition: "discarded_erasure_cutoff" });
    const [event] = await db
      .select({
        note: rollCallEvents.note,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
      })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.clientEventId, "22222222-2222-4222-8222-222222222222"));
    expect(event).toEqual({ note: null, status: "not_boarded", occurredAt });
  });
});
