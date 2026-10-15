import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { gearShopContext } from "./gear-test-fixtures";
import { REBOOK_WINDOW_MS, sailedRebooking } from "./sailed-rebooking";
import { createTrip } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

const DAWN = new Date("2026-09-01T11:00:00Z");
const HOME = new Date(DAWN.getTime() + 4 * HOUR_MS);

async function departure(db: AppDb, shopId: string, title: string, startsAt: Date, capacity = 8) {
  const trip = await createTrip(db, {
    shopId,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity,
    plannedDives: 2,
  });
  if (!trip) throw new Error("trip insert failed");
  return trip;
}

async function seat(db: AppDb, shopId: string, tripId: string, fullName: string) {
  const booking = await createBooking(db, {
    shopId,
    tripId,
    actor: "staff",
    fullName,
    email: `${fullName.toLowerCase().replace(/[^a-z]+/g, "-")}@example.com`,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  return booking;
}

/** Fifth-loop ideas, item 4: the sailed list becomes the rebooking list. */
describe("sailedRebooking (in-memory PGlite)", () => {
  it("names a later seat when the diver holds one, and an open day when not", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const dawn = await departure(db, shop.id, "Dawn two-tank", DAWN);
    const thursday = await departure(
      db,
      shop.id,
      "Thursday reef",
      new Date("2026-09-03T11:00:00Z"),
    );
    const saturday = await departure(
      db,
      shop.id,
      "Saturday wrecks",
      new Date("2026-09-05T15:30:00Z"),
    );
    const nadia = await seat(db, shop.id, dawn.id, "Nadia Osei");
    const theo = await seat(db, shop.id, dawn.id, "Theo Park");
    await seat(db, shop.id, saturday.id, "Theo Park");
    await seat(db, shop.id, thursday.id, "Someone Else");

    const lines = await sailedRebooking(db, {
      shopId: shop.id,
      tripId: dawn.id,
      now: new Date(HOME.getTime() + HOUR_MS),
    });
    expect(lines.get(theo.bookingId)?.next).toMatchObject({ kind: "booked", tripId: saturday.id });
    expect(lines.get(nadia.bookingId)).toMatchObject({ personName: "Nadia Osei" });
    expect(lines.get(nadia.bookingId)?.next).toMatchObject({
      kind: "open",
      tripId: thursday.id,
      seatsLeft: 7,
    });
  });

  it("offers no day the diver could not take, and says nothing when there is none", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const dawn = await departure(db, shop.id, "Dawn two-tank", DAWN);
    const full = await departure(db, shop.id, "Full boat", new Date("2026-09-02T11:00:00Z"), 1);
    await seat(db, shop.id, full.id, "Someone Else");
    // Beyond the week ahead: not a day for someone standing on the dock.
    await departure(db, shop.id, "Next month", new Date("2026-09-20T11:00:00Z"));
    const nadia = await seat(db, shop.id, dawn.id, "Nadia Osei");
    const lines = await sailedRebooking(db, {
      shopId: shop.id,
      tripId: dawn.id,
      now: new Date(HOME.getTime() + HOUR_MS),
    });
    expect(lines.has(nadia.bookingId)).toBe(false);
  });

  it("speaks only once the boat is home, and only for a day", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const dawn = await departure(db, shop.id, "Dawn two-tank", DAWN);
    await departure(db, shop.id, "Thursday reef", new Date("2026-09-03T11:00:00Z"));
    await seat(db, shop.id, dawn.id, "Nadia Osei");
    const at = (now: Date) => sailedRebooking(db, { shopId: shop.id, tripId: dawn.id, now });
    expect((await at(new Date(HOME.getTime() - HOUR_MS))).size).toBe(0);
    expect((await at(new Date(HOME.getTime() + REBOOK_WINDOW_MS + HOUR_MS))).size).toBe(0);
    expect((await at(new Date(HOME.getTime() + HOUR_MS))).size).toBe(1);
  });
});
