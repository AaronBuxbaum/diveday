// @vitest-environment node
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { capabilityExpiryFor } from "@/lib/booking-capabilities";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { issueBookingCapability } from "./booking-capabilities";
import { createBooking, moveBooking } from "./bookings";
import type { AppDb } from "./client";
import { bookingCapabilities, trips } from "./schema";
import { editTripSection, moveTrip, upcomingTripsWithCounts } from "./trips";

/**
 * **Every live link of a moved departure follows its new end** (issue #2711,
 * code security review finding 4). A link lives until its trip's end plus the
 * grace, so when the boat moves, the confirm, claim, browser and mailed links
 * all move with it — not only the one the reschedule notice re-sends. Moved
 * earlier, a link left behind would outlive its trip; moved later, the
 * confirmation would die before the boat sails. A handoff keeps its ten
 * minutes, and a receipt its own window.
 */
const ctx = fileScopedShopContext();

async function bookedLinks(db: AppDb, shopId: string) {
  const [trip] = await upcomingTripsWithCounts(db, shopId);
  if (!trip) throw new Error("expected a seeded trip");
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!outcome.ok) throw new Error("expected booking");
  const bookingId = outcome.bookingId;
  const base = { shopId, bookingId };
  await issueBookingCapability(db, { ...base, purpose: "readiness" });
  await issueBookingCapability(db, { ...base, purpose: "readiness", delivered: true });
  await issueBookingCapability(db, { ...base, purpose: "confirm" });
  await issueBookingCapability(db, { ...base, purpose: "claim" });
  await issueBookingCapability(db, { ...base, purpose: "handoff" });
  return { trip, bookingId };
}

async function expiries(db: AppDb, bookingId: string) {
  const rows = await db
    .select({ purpose: bookingCapabilities.purpose, expiresAt: bookingCapabilities.expiresAt })
    .from(bookingCapabilities)
    .where(
      and(eq(bookingCapabilities.bookingId, bookingId), isNull(bookingCapabilities.revokedAt)),
    );
  return rows;
}

describe("a moved departure's links", () => {
  it("all follow the new end when the boat moves", async () => {
    const { db, shop } = ctx;
    const { trip, bookingId } = await bookedLinks(db, shop.id);
    const handoffBefore = (await expiries(db, bookingId)).find((row) => row.purpose === "handoff");
    const later = new Date(trip.startsAt.getTime() + 20 * DAY_MS);

    const moved = await moveTrip(db, shop.id, trip.id, later);
    if (!moved.ok) throw new Error(`expected the move to land: ${moved.reason}`);

    const target = capabilityExpiryFor(moved.trip.endsAt, nowDate()).getTime();
    const rows = await expiries(db, bookingId);
    for (const row of rows.filter((r) => r.purpose !== "handoff")) {
      expect(row.expiresAt.getTime(), row.purpose).toBe(target);
    }
    expect(rows.find((row) => row.purpose === "handoff")?.expiresAt).toEqual(
      handoffBefore?.expiresAt,
    );
  });

  it("follow an edit that changes only the end", async () => {
    const { db, shop } = ctx;
    const { trip, bookingId } = await bookedLinks(db, shop.id);
    const endsAt = new Date(trip.endsAt.getTime() + 3 * DAY_MS);

    const edited = await editTripSection(db, shop.id, trip.id, { endsAt });
    expect(edited.ok).toBe(true);

    const [saved] = await db
      .select({ endsAt: trips.endsAt })
      .from(trips)
      .where(eq(trips.id, trip.id));
    if (!saved) throw new Error("expected the trip");
    const target = capabilityExpiryFor(saved.endsAt, nowDate()).getTime();
    for (const row of (await expiries(db, bookingId)).filter((r) => r.purpose !== "handoff")) {
      expect(row.expiresAt.getTime(), row.purpose).toBe(target);
    }
  });

  it("follow a seat moved to another departure", async () => {
    const { db, shop } = ctx;
    const { trip, bookingId } = await bookedLinks(db, shop.id);
    const other = (await upcomingTripsWithCounts(db, shop.id)).find(
      (t) => t.id !== trip.id && t.endsAt.getTime() !== trip.endsAt.getTime(),
    );
    if (!other) throw new Error("expected a second departure");

    const moved = await moveBooking(db, {
      shopId: shop.id,
      fromTripId: trip.id,
      toTripId: other.id,
      bookingId,
    });
    if (!moved.ok) throw new Error(`expected the move to land: ${moved.reason}`);

    const target = capabilityExpiryFor(other.endsAt, nowDate()).getTime();
    for (const row of (await expiries(db, bookingId)).filter((r) => r.purpose !== "handoff")) {
      expect(row.expiresAt.getTime(), row.purpose).toBe(target);
    }
  });
});
