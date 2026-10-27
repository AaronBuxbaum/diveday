import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { recordFlySafeTold } from "./fly-safe-correction";
import { bookings, trips as tripRows } from "./schema";
import { createTrip, upcomingTripsWithCounts } from "./trips";
import { updateTrip } from "./trips-record";

/**
 * **Every save that marks decompression diving corrects the fly-safe figure**
 * (issue #2927, domain review): the correction lives in `updateTrip`, after
 * the commit, so no door that sets the flag skips it, and a send that throws
 * never turns a saved departure into a failed save.
 */

const hooks = vi.hoisted(() => ({ explode: false }));

vi.mock("./fly-safe-correction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fly-safe-correction")>();
  return {
    ...actual,
    correctFlySafeForTripChange: async (
      ...args: Parameters<typeof actual.correctFlySafeForTripChange>
    ) => {
      if (hooks.explode) throw new Error("database went away");
      return actual.correctFlySafeForTripChange(...args);
    },
  };
});

const ctx = fileScopedShopContext();

async function toldOnReef(email: string) {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    { actor: "staff", shopId: shop.id, tripId: reef.id, fullName: "Rae Record", email },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  await recordFlySafeTold(db, { shopId: shop.id, bookingId, hours: 24, recipientEmail: email });
  const [trip] = await db.select().from(tripRows).where(eq(tripRows.id, reef.id));
  if (!trip) throw new Error("trip missing");
  return { db, shop, trip, bookingId };
}

function markDecoPatch(trip: typeof tripRows.$inferSelect, on: boolean) {
  return {
    title: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    capacity: trip.capacity,
    plannedDives: trip.plannedDives,
    exceedsNoDecoLimits: on,
  };
}

describe("updateTrip and the fly-safe correction (#2927)", () => {
  it("attempts the correction for each seat told a figure when the save marks decompression", async () => {
    const { db, shop, trip, bookingId } = await toldOnReef("record-deco@example.com");
    hooks.explode = false;
    const outcome = await updateTrip(db, shop.id, trip.id, markDecoPatch(trip, true));
    if (!outcome.ok) throw new Error(`save refused: ${outcome.reason}`);
    expect(outcome.flySafe).toBeDefined();
    if (!outcome.flySafe || outcome.flySafe === "failed") throw new Error("no pass ran");
    const { told, failed, unreached } = outcome.flySafe;
    // Whatever the test environment's provider answers, the one seat was tried.
    expect(told + failed + unreached.length).toBeGreaterThanOrEqual(1);
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.flySafeHoursTold).toBe(24);
  });

  it("rechecks a later reminder when an earlier trip becomes decompression", async () => {
    const { db, shop, trip } = await toldOnReef("itinerary-record@example.com");
    const startsAt = new Date(trip.startsAt.getTime() + 24 * 60 * 60 * 1000);
    const later = await createTrip(db, {
      shopId: shop.id,
      title: "Later itinerary",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 1,
    });
    if (!later) throw new Error("later trip missing");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: later.id,
        fullName: "Rae Record",
        email: "itinerary-record@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`later seat failed: ${party.reason}`);
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId: party.bookings[0].bookingId,
      hours: 24,
      recipientEmail: "itinerary-record@example.com",
    });
    const outcome = await updateTrip(db, shop.id, trip.id, markDecoPatch(trip, true));
    if (!outcome.ok || !outcome.flySafe || outcome.flySafe === "failed")
      throw new Error("correction pass missing");
    expect(outcome.flySafe.told + outcome.flySafe.failed).toBeGreaterThanOrEqual(1);
    expect(outcome.flySafe.unreached).toContain("Rae Record");
    const [laterSeat] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, party.bookings[0].bookingId));
    expect(laterSeat?.flySafeCorrectionAttempts).toBeGreaterThan(0);
  });

  it("runs no pass when the departure is not marked", async () => {
    const { db, shop, trip } = await toldOnReef("record-nodeco@example.com");
    hooks.explode = false;
    const outcome = await updateTrip(db, shop.id, trip.id, markDecoPatch(trip, false));
    expect(outcome.ok && outcome.flySafe).toBeFalsy();
  });

  it("keeps the save when sending the corrections throws", async () => {
    const { db, shop, trip } = await toldOnReef("record-throw@example.com");
    hooks.explode = true;
    const outcome = await updateTrip(db, shop.id, trip.id, markDecoPatch(trip, true));
    hooks.explode = false;
    expect(outcome).toMatchObject({ ok: true, flySafe: "failed" });
    const [saved] = await db.select().from(tripRows).where(eq(tripRows.id, trip.id));
    expect(saved?.exceedsNoDecoLimits).toBe(true);
  });
});
