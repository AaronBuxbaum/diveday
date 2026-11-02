import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { issueOfflineManifestSnapshot } from "./offline-manifest-snapshots";
import { listChecklistItems, recordPreDepartureCheck } from "./pre-departure-check";
import { preDepartureCheckEvents } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

const context = fileScopedShopContext();

async function fixture() {
  const { db, shop } = context;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((candidate) => candidate.title.startsWith("Two-Tank Reef — Molasses"));
  if (!trip) throw new Error("demo reef trip missing");
  const [booking] = await getTripRoster(db, shop.id, trip.id);
  const owner = (await listStaff(db, shop.id)).find((entry) => entry.roles.includes("owner"));
  const [item] = await listChecklistItems(db, shop.id);
  if (!booking || !owner || !item) throw new Error("checklist erasure fixture missing");
  return { db, shop, trip, booking, owner: owner.person, item };
}

describe("pre-departure checklist notes and diver erasure", () => {
  it("keeps a stale offline checklist note: it is nobody's own data (issue #3569)", async () => {
    const { db, shop, trip, booking, owner, item } = await fixture();
    const issuedEpoch = shop.offlineErasureEpoch;
    const snapshotId = "11111111-1111-4111-8111-111111111111";
    const occurredAt = nowDate();
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.booking.personId,
      actorPersonId: owner.id,
    });

    const result = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: trip.id,
      checklistItemId: item.id,
      recordedByPersonId: owner.id,
      status: "checked",
      source: "offline",
      clientEventId: "22222222-2222-4222-8222-222222222222",
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 1_000),
      offlineSnapshotId: snapshotId,
      offlineErasureEpochToken: signOfflineErasureEpoch({
        shopId: shop.id,
        tripId: trip.id,
        snapshotId,
        epoch: issuedEpoch,
        snapshotRevision: 1,
      }),
      occurredAt,
      note: "Oxygen kit checked at the dock.",
    });

    expect(result).toMatchObject({ ok: true });
    expect(result).not.toHaveProperty("noteDisposition");
    const [event] = await db
      .select({
        note: preDepartureCheckEvents.note,
        status: preDepartureCheckEvents.status,
        occurredAt: preDepartureCheckEvents.occurredAt,
      })
      .from(preDepartureCheckEvents)
      .where(eq(preDepartureCheckEvents.clientEventId, "22222222-2222-4222-8222-222222222222"));
    expect(event).toEqual({
      note: "Oxygen kit checked at the dock.",
      status: "checked",
      occurredAt,
    });
  });

  it("still drops an offline checklist note whose snapshot token does not verify", async () => {
    const { db, shop, trip, owner, item } = await fixture();
    const occurredAt = nowDate();

    const result = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: trip.id,
      checklistItemId: item.id,
      recordedByPersonId: owner.id,
      status: "checked",
      source: "offline",
      clientEventId: "44444444-4444-4444-8444-444444444444",
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 1_000),
      offlineSnapshotId: "55555555-5555-4555-8555-555555555555",
      offlineErasureEpochToken: "not-a-signed-epoch",
      occurredAt,
      note: "Oxygen kit checked at the dock.",
    });

    expect(result).toMatchObject({ ok: true, noteDisposition: "discarded_unverified_snapshot" });
    const [event] = await db
      .select({ note: preDepartureCheckEvents.note, status: preDepartureCheckEvents.status })
      .from(preDepartureCheckEvents)
      .where(eq(preDepartureCheckEvents.clientEventId, "44444444-4444-4444-8444-444444444444"));
    expect(event).toEqual({ note: null, status: "checked" });
  });

  it("leaves a diver name in already-saved checklist notes (staff prose, not their data)", async () => {
    const { db, shop, trip, booking, owner, item } = await fixture();
    await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: trip.id,
      checklistItemId: item.id,
      recordedByPersonId: owner.id,
      status: "checked",
      note: `${booking.person.fullName} was named before erasure.`,
    });

    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.booking.personId,
      actorPersonId: owner.id,
    });

    const [event] = await db
      .select({ note: preDepartureCheckEvents.note, status: preDepartureCheckEvents.status })
      .from(preDepartureCheckEvents)
      .where(eq(preDepartureCheckEvents.tripId, trip.id));
    expect(event).toEqual({
      note: `${booking.person.fullName} was named before erasure.`,
      status: "checked",
    });
  });

  it("accepts a note from a fresh snapshot issued after erasure", async () => {
    const { db, shop, trip, booking, owner, item } = await fixture();
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.booking.personId,
      actorPersonId: owner.id,
    });
    const snapshot = await issueOfflineManifestSnapshot(db, shop.id, trip.id);
    if (!snapshot) throw new Error("fresh offline snapshot missing");
    const occurredAt = nowDate();

    const result = await recordPreDepartureCheck(db, {
      shopId: shop.id,
      tripId: trip.id,
      checklistItemId: item.id,
      recordedByPersonId: owner.id,
      status: "checked",
      source: "offline",
      clientEventId: "33333333-3333-4333-8333-333333333333",
      offlineSnapshotSavedAt: occurredAt,
      offlineSnapshotId: snapshot.snapshotId,
      offlineErasureEpochToken: snapshot.erasureEpochToken,
      occurredAt,
      note: "Fresh post-erasure checklist context.",
    });

    expect(result).toMatchObject({ ok: true });
    expect(result).not.toHaveProperty("noteDisposition");
    const [event] = await db
      .select({ note: preDepartureCheckEvents.note, status: preDepartureCheckEvents.status })
      .from(preDepartureCheckEvents)
      .where(eq(preDepartureCheckEvents.clientEventId, "33333333-3333-4333-8333-333333333333"));
    expect(event).toEqual({ note: "Fresh post-erasure checklist context.", status: "checked" });
  });
});
