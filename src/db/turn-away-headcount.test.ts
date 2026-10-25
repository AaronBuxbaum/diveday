import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { inHorizonReadiness } from "./blockers";
import { getTripManifest } from "./manifests";
import { getTodayWork } from "./today";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { turnBookingAway } from "./turn-away";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **A turned-away seat leaves every head count and Today's work** (issue
 * #2907), read through the real loaders: the manifest keeps her row and the
 * reason category, and counts her nowhere; Today neither counts her blocked
 * nor offers to send her a waiver.
 */
async function turnedAwaySeat() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (candidate) => candidate.title === "Two-Tank Reef — Molasses & French",
  );
  if (!trip) throw new Error("seeded reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("seeded staff missing");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  if (!seat) throw new Error("seeded booking missing");
  const now = new Date(trip.startsAt.getTime() - HOUR_MS);
  const before = await getTripManifest(db, shop.id, trip.id);
  const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
  const result = await turnBookingAway(db, {
    shopId: shop.id,
    bookingId: seat.booking.id,
    reason: "waiver",
    recordedByPersonId: staff.person.id,
    now,
  });
  expect(result).toMatchObject({ ok: true });
  return { db, shop, trip, bookingId: seat.booking.id, now, before, work };
}

describe("a seat the desk turned away (#2907)", () => {
  it("keeps her row on the manifest, with the category, and counts her nowhere", async () => {
    const { db, shop, trip, bookingId, before } = await turnedAwaySeat();
    const manifest = await getTripManifest(db, shop.id, trip.id);
    if (!manifest || !before) throw new Error("manifest missing");
    const row = manifest.divers.find((diver) => diver.bookingId === bookingId);
    expect(row).toMatchObject({ notHere: true, turnedAway: true, turnedAwayReason: "waiver" });
    expect(manifest.divers).toHaveLength(before.divers.length);
    expect(manifest.summary.totalDivers).toBe(before.summary.totalDivers - 1);
    expect(manifest.summary.awaiting).toBe(before.summary.awaiting - 1);
    expect(manifest.summary.notHere).toBe(0);
  });

  it("drops her from Today's readiness, its blocked count and its waiver sends", async () => {
    const { db, shop, trip, bookingId, now, work: before } = await turnedAwaySeat();
    const evidence = await inHorizonReadiness(db, shop.id, now);
    expect(evidence.readinessByTrip.get(trip.id)?.map((row) => row.booking.id)).not.toContain(
      bookingId,
    );
    const work = await getTodayWork(db, shop.id, shop.slug, shop.timezone, now);
    const card = (w: typeof work) => w.departures.find((departure) => departure.tripId === trip.id);
    expect(card(work)?.blocked).toBe((card(before)?.blocked ?? 0) - 1);
    const aboutHer = work.actions.filter(
      (action) =>
        action.id.includes(bookingId) || action.waiver?.bookingIds.includes(bookingId) === true,
    );
    expect(aboutHer).toEqual([]);
    // The seat was chased before the desk turned her away: the test is not vacuous.
    expect(
      before.actions.some(
        (action) =>
          action.id.includes(bookingId) || action.waiver?.bookingIds.includes(bookingId) === true,
      ),
    ).toBe(true);
  });
});
