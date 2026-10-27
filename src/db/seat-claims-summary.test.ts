// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import type { AppDb } from "./client";
import { markBookingNoShow } from "./no-show";
import { bookings } from "./schema";
import { issuePartySeatClaims } from "./seat-claims";
import { createTrip, listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

async function seededContext() {
  const { db, shop } = ctx;
  const tripRows = await upcomingTripsWithCounts(db, shop.id);
  const open = tripRows.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded trip missing");
  return { db, shop, open };
}

/** A party of three: the organizer plus two seats typed by the organizer. */
async function bookParty(db: AppDb, shopId: string, tripId: string) {
  const outcome = await createBookingParty(db, [
    {
      actor: "public",
      shopId,
      tripId,
      fullName: "Orla Organizer",
      email: "orla@example.com",
      phone: "+1-305-555-0100",
    },
    { actor: "public", shopId, tripId, fullName: "Milo Member" },
    { actor: "public", shopId, tripId, fullName: "Pia Member" },
  ]);
  if (!outcome.ok) throw new Error(`party booking failed: ${outcome.reason}`);
  const [lead, memberOne, memberTwo] = outcome.bookings;
  if (!lead || !memberOne || !memberTwo) throw new Error("party booking incomplete");
  return { lead, memberOne, memberTwo };
}

describe("claim-panel history versus the current group summary", () => {
  async function releaseAt(db: AppDb, shopId: string, bookingId: string, now: Date) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("seeded staff missing");
    expect(
      await markBookingNoShow(db, { shopId, bookingId, recordedByPersonId: staff.person.id, now }),
    ).toMatchObject({ ok: true });
  }

  it("retains an ordinary released row for the existing panel but marks it outside held-seat counts", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);
    const now = new Date(open.startsAt.getTime() + 60_000);
    await releaseAt(db, shop.id, memberOne.bookingId, now);
    await db
      .update(bookings)
      .set({ status: "checked_in", claimedAt: now })
      .where(eq(bookings.id, memberTwo.bookingId));
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      now,
    });
    expect(seats).toHaveLength(2);
    expect(seats.find((seat) => seat.bookingId === memberOne.bookingId)).toMatchObject({
      seatHeld: false,
      claimed: false,
      claim: null,
      differentDeparture: false,
    });
    expect(seats.find((seat) => seat.bookingId === memberTwo.bookingId)).toMatchObject({
      seatHeld: true,
      claimed: true,
    });
    expect(seats.filter((seat) => seat.seatHeld).map((seat) => seat.bookingId)).toEqual([
      memberTwo.bookingId,
    ]);
  });

  it("preserves all released companions in the panel while no held companion remains", async () => {
    const { db, shop, open } = await seededContext();
    const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);
    const now = new Date(open.startsAt.getTime() + 60_000);
    await releaseAt(db, shop.id, memberOne.bookingId, now);
    await releaseAt(db, shop.id, memberTwo.bookingId, now);
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      now,
    });
    expect(seats.map((seat) => seat.bookingId).sort()).toEqual(
      [memberOne.bookingId, memberTwo.bookingId].sort(),
    );
    expect(seats.every((seat) => !seat.seatHeld && seat.claim === null)).toBe(true);
  });

  it.each([false, true])(
    "projects a moved companion’s actual held state, released=%s",
    async (released) => {
      const { db, shop, open } = await seededContext();
      const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);
      const earlier = await createTrip(db, {
        shopId: shop.id,
        title: "Earlier group departure",
        startsAt: new Date(open.startsAt.getTime() - 86_400_000),
        endsAt: new Date(open.startsAt.getTime() - 72_000_000),
        capacity: 6,
        plannedDives: 2,
      });
      if (!earlier) throw new Error("earlier departure missing");
      await db
        .update(bookings)
        .set({ tripId: earlier.id })
        .where(eq(bookings.id, memberOne.bookingId));
      const now = new Date(earlier.startsAt.getTime() + 60_000);
      if (released) await releaseAt(db, shop.id, memberOne.bookingId, now);
      await db.update(bookings).set({ claimedAt: now }).where(eq(bookings.id, memberTwo.bookingId));
      const seats = await issuePartySeatClaims(db, {
        shopId: shop.id,
        leadBookingId: lead.bookingId,
        now,
      });
      expect(seats).toHaveLength(2);
      expect(seats.find((seat) => seat.bookingId === memberOne.bookingId)).toMatchObject({
        seatHeld: !released,
        differentDeparture: true,
        claimed: false,
        claim: null,
      });
      expect(seats.find((seat) => seat.bookingId === memberTwo.bookingId)).toMatchObject({
        seatHeld: true,
        differentDeparture: false,
        claimed: true,
      });
    },
  );
});

it("projects claimed seats on the lead departure and unclaimed seats moved elsewhere", async () => {
  const { db, shop, open } = await seededContext();
  const { lead, memberOne, memberTwo } = await bookParty(db, shop.id, open.id);
  const other = (await upcomingTripsWithCounts(db, shop.id)).find((trip) => trip.id !== open.id);
  if (!other) throw new Error("expected a second seeded trip");
  await db.update(bookings).set({ tripId: other.id }).where(eq(bookings.id, memberTwo.bookingId));
  await db
    .update(bookings)
    .set({ claimedAt: new Date(nowMs()) })
    .where(eq(bookings.id, memberOne.bookingId));
  const projected = await issuePartySeatClaims(db, {
    shopId: shop.id,
    leadBookingId: lead.bookingId,
  });
  expect(projected).toHaveLength(2);
  expect(projected.find((seat) => seat.bookingId === memberOne.bookingId)).toMatchObject({
    claimed: true,
    differentDeparture: false,
  });
  expect(projected.find((seat) => seat.bookingId === memberTwo.bookingId)).toMatchObject({
    claimed: false,
    differentDeparture: true,
  });
});
