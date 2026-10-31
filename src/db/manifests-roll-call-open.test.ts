import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  getTripManifest,
  recordCrewRollCall,
  recordRollCall,
  rollCallOpenOnTrip,
} from "./manifests";
import { rollCallCrewEvents, rollCallEvents, shops, tripAssignments, trips } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

/**
 * **The manifest asks the writers' own question** (#2285). A cancelled trip
 * nobody has counted on refuses every roll-call write, so its page must draw
 * no control; one whose count has begun keeps taking writes (dive-domain
 * review, 2026-10-09), so its page must keep them. `rollCallOpenOnTrip` is the
 * page's reading of that gate, and every case below pairs it with what the
 * writer actually does, so the two can never disagree.
 */
async function reefDeparture() {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [booking] = await getTripRoster(db, shop.id, reef.id);
  if (!booking) throw new Error("demo booking missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  // Start from a departure nobody has counted on, whatever the seed recorded.
  await db.delete(rollCallEvents).where(eq(rollCallEvents.tripId, reef.id));
  await db.delete(rollCallCrewEvents).where(eq(rollCallCrewEvents.tripId, reef.id));
  await db
    .insert(tripAssignments)
    .values({ tripId: reef.id, personId: staff.person.id })
    .onConflictDoNothing();
  return { db, shop, reef, bookingId: booking.booking.id, staffId: staff.person.id };
}

async function cancel(tripId: string) {
  await ctx.db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
}

describe("rollCallOpenOnTrip", () => {
  it("is open on a scheduled departure, counted on or not", async () => {
    const { db, shop, reef } = await reefDeparture();
    expect(await rollCallOpenOnTrip(db, shop.id, reef.id)).toBe(true);
  });

  it("is closed on a cancelled departure nobody counted on, and the writers agree", async () => {
    const { db, shop, reef, bookingId, staffId } = await reefDeparture();
    await cancel(reef.id);
    expect(await rollCallOpenOnTrip(db, shop.id, reef.id)).toBe(false);
    const diver = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      recordedByPersonId: staffId,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    expect(diver).toEqual({ ok: false, reason: "booking_unavailable" });
    const crew = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "boarded",
    });
    expect(crew).toEqual({ ok: false, reason: "trip_unavailable" });
  });

  it("stays open on a departure cancelled after a diver was counted, and the writer agrees", async () => {
    const { db, shop, reef, bookingId, staffId } = await reefDeparture();
    const first = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      recordedByPersonId: staffId,
      status: "not_boarded",
    });
    expect(first.ok).toBe(true);
    await cancel(reef.id);
    expect(await rollCallOpenOnTrip(db, shop.id, reef.id)).toBe(true);
    const next = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      recordedByPersonId: staffId,
      status: "cleared",
    });
    expect(next.ok).toBe(true);
  });

  it("stays open when only the crew were counted", async () => {
    const { db, shop, reef, staffId } = await reefDeparture();
    const crew = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "not_boarded",
    });
    expect(crew.ok).toBe(true);
    await cancel(reef.id);
    expect(await rollCallOpenOnTrip(db, shop.id, reef.id)).toBe(true);
  });

  it("counts a retracted mark as counting, the way the writers do", async () => {
    // A `cleared` row is still a row: the crew had started. Reading "open"
    // only off a standing mark would close a page whose writers still accept.
    const { db, shop, reef, bookingId, staffId } = await reefDeparture();
    for (const status of ["boarded", "cleared"] as const) {
      const result = await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId,
        recordedByPersonId: staffId,
        status,
        checkpoint: "after_dive_1",
      });
      expect(result.ok).toBe(true);
    }
    await cancel(reef.id);
    expect(await rollCallOpenOnTrip(db, shop.id, reef.id)).toBe(true);
  });

  it("is not opened by another departure's count", async () => {
    const { db, shop, reef, staffId } = await reefDeparture();
    const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const other = upcoming.find((trip) => trip.id !== reef.id);
    if (!other) throw new Error("a second demo trip is missing");
    await db
      .insert(tripAssignments)
      .values({ tripId: other.id, personId: staffId })
      .onConflictDoNothing();
    const counted = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: other.id,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "boarded",
    });
    expect(counted.ok).toBe(true);
    await cancel(reef.id);
    expect(await rollCallOpenOnTrip(db, shop.id, reef.id)).toBe(false);
  });

  it("names no trip of another shop", async () => {
    const { db, reef } = await reefDeparture();
    const [elsewhere] = await db
      .insert(shops)
      .values({ name: "Elsewhere Divers", slug: "elsewhere-2285", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!elsewhere) throw new Error("second shop missing");
    expect(await rollCallOpenOnTrip(db, elsewhere.id, reef.id)).toBe(false);
  });

  // Records review 8: a tap made offline before the cancel still reaches the
  // record when it syncs; one made after the cancel, or live, does not.
  it("takes an offline count made before the cancel, and nothing made after it", async () => {
    const { db, shop, reef, bookingId, staffId } = await reefDeparture();
    const cancelledAt = nowDate();
    await ctx.db
      .update(trips)
      .set({ status: "cancelled", cancelledAt })
      .where(eq(trips.id, reef.id));
    const offline = (occurredAt: Date, clientEventId: string) =>
      recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: staffId,
        recordedByPersonId: staffId,
        status: "boarded",
        source: "offline",
        clientEventId,
        offlineSnapshotSavedAt: new Date(cancelledAt.getTime() - 3 * 3_600_000),
        occurredAt,
      });
    expect(
      await offline(
        new Date(cancelledAt.getTime() + 60_000),
        "eeeeeeee-2285-4285-8285-eeeeeeeeeee1",
      ),
    ).toEqual({ ok: false, reason: "trip_unavailable" });
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId,
        recordedByPersonId: staffId,
        status: "boarded",
        occurredAt: new Date(cancelledAt.getTime() - 60_000),
      }),
    ).toEqual({ ok: false, reason: "booking_unavailable" });
    const before = await offline(
      new Date(cancelledAt.getTime() - 60_000),
      "eeeeeeee-2285-4285-8285-eeeeeeeeeee2",
    );
    expect(before.ok).toBe(true);
  });

  it("carries each stored event id onto the manifest's diver and crew results", async () => {
    const { db, shop, reef, bookingId, staffId } = await reefDeparture();
    const diver = await recordRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      recordedByPersonId: staffId,
      status: "not_boarded",
    });
    const crew = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      personId: staffId,
      recordedByPersonId: staffId,
      status: "boarded",
    });
    if (!diver.ok || !crew.ok) throw new Error("roll call write refused");
    const manifest = await getTripManifest(db, shop.id, reef.id, "departure");
    expect(manifest?.divers.find((d) => d.bookingId === bookingId)?.rollCall?.eventId).toBe(
      diver.eventId,
    );
    expect(manifest?.crew.find((m) => m.id === staffId)?.rollCall?.eventId).toBe(crew.eventId);
  });
});
