import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { countingShopContext } from "@/test/query-count";
import { createBoat } from "../features/crew-and-boats/boats/store";
import { type BookingRequest, cancelBooking, createBooking, createBookingParty } from "./bookings";
import { bookings, trips } from "./schema";
import { createTrip, listStaff, setTripCrew } from "./trips";

const ctx = fileScopedShopContext();
const HOUR = 3_600_000;

async function departure(
  extra: Partial<Parameters<typeof createTrip>[1]> & { capacity: number },
  title = "Party gate departure",
) {
  const { db, shop } = ctx;
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId: shop.id,
    title,
    plannedDives: 1,
    startsAt: new Date(now.getTime() + 72 * HOUR),
    endsAt: new Date(now.getTime() + 76 * HOUR),
    ...extra,
  });
  if (!trip) throw new Error("departure missing");
  return trip;
}

function seats(
  tripId: string,
  count: number,
  actor: BookingRequest["actor"] = "public",
  tag = "p",
): BookingRequest[] {
  return Array.from({ length: count }, (_, n) => ({
    actor,
    shopId: ctx.shop.id,
    tripId,
    fullName: `Party ${tag} ${n + 1}`,
    email: `party-${tag}-${n + 1}@example.test`,
  }));
}

async function liveSeats(tripId: string) {
  const rows = await ctx.db.select().from(bookings).where(eq(bookings.tripId, tripId));
  return rows.filter((row) => row.status !== "cancelled");
}

/**
 * **A party books its departure's checks once** (issue #4396). The trip is locked,
 * its holds expired and its capacity and requirements read once for the whole
 * party; the party counts its own seats as it writes them. Capacity is the
 * most safety-sensitive gate in the app, so each case below is a way the
 * hoisted count could let one seat too many through, or refuse an honest one.
 */
describe("party booking, trip-level checks", () => {
  it("locks the trip once, however many seats the party has, and never updates a seat to link it", async () => {
    const counting = await countingShopContext();
    const now = nowDate();
    const trip = await createTrip(counting.uncounted, {
      shopId: counting.shop.id,
      title: "Counted party departure",
      capacity: 40,
      plannedDives: 1,
      startsAt: new Date(now.getTime() + 72 * HOUR),
      endsAt: new Date(now.getTime() + 76 * HOUR),
    });
    if (!trip) throw new Error("departure missing");
    const tripLocks: number[] = [];
    for (const size of [1, 3, 6]) {
      counting.reset();
      const requests = seats(trip.id, size, "public", `c${size}`).map((request) => ({
        ...request,
        shopId: counting.shop.id,
      }));
      const outcome = await createBookingParty(counting.db, requests);
      expect(outcome.ok).toBe(true);
      tripLocks.push(
        counting.statements.filter((sql) => /"trips"/.test(sql) && /for no key update/i.test(sql))
          .length,
      );
      expect(
        counting.statements.filter((sql) =>
          /^update "bookings" set "party_lead_booking_id"/i.test(sql),
        ),
      ).toHaveLength(0);
    }
    expect(tripLocks).toEqual([1, 1, 1]);
  });

  it("sells a party that exactly fills the boat", async () => {
    const trip = await departure({ capacity: 4 });
    const outcome = await createBookingParty(ctx.db, seats(trip.id, 4));
    expect(outcome.ok).toBe(true);
    expect(await liveSeats(trip.id)).toHaveLength(4);
  });

  it("refuses a party that would overflow partway, whole, naming the seat that did not fit", async () => {
    const trip = await departure({ capacity: 3 });
    const outcome = await createBookingParty(ctx.db, seats(trip.id, 4));
    expect(outcome).toEqual({ ok: false, reason: "trip_full", failedIndex: 3 });
    expect(await liveSeats(trip.id)).toHaveLength(0);
  });

  it("counts seats already sold before the party's first", async () => {
    const trip = await departure({ capacity: 4 });
    const alone = await createBooking(
      ctx.db,
      seats(trip.id, 1, "public", "solo")[0] as BookingRequest,
    );
    expect(alone.ok).toBe(true);
    const outcome = await createBookingParty(ctx.db, seats(trip.id, 4));
    expect(outcome).toEqual({ ok: false, reason: "trip_full", failedIndex: 3 });
    expect(await liveSeats(trip.id)).toHaveLength(1);
    expect((await createBookingParty(ctx.db, seats(trip.id, 3, "public", "fits"))).ok).toBe(true);
    expect(await liveSeats(trip.id)).toHaveLength(4);
  });

  it("stops at the divers-only limit even when the boat has room", async () => {
    const trip = await departure({ capacity: 10 });
    await ctx.db.update(trips).set({ diverCapacity: 2 }).where(eq(trips.id, trip.id));
    const outcome = await createBookingParty(ctx.db, seats(trip.id, 3));
    expect(outcome).toEqual({ ok: false, reason: "divers_full", failedIndex: 2 });
    expect(await liveSeats(trip.id)).toHaveLength(0);
  });

  it("measures the party against the boat's passenger places after crew", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Four aboard", 4);
    const trip = await departure({ capacity: 10, boatId: boat.id }, "Crewed party departure");
    const staff = await listStaff(db, shop.id);
    const crew = staff[0];
    if (!crew) throw new Error("seeded staff required");
    expect(await setTripCrew(db, shop.id, trip.id, [crew.person.id])).toBe(true);
    // Four places on the hull less one for crew: a party of four does not fit.
    expect(await createBookingParty(db, seats(trip.id, 4))).toEqual({
      ok: false,
      reason: "trip_full",
      failedIndex: 3,
    });
    expect((await createBookingParty(db, seats(trip.id, 3, "public", "three"))).ok).toBe(true);
  });

  it("writes the lead's id on every later seat in the insert, and nothing on the lead", async () => {
    const trip = await departure({ capacity: 6 });
    const outcome = await createBookingParty(ctx.db, seats(trip.id, 3, "staff"));
    if (!outcome.ok) throw new Error("party refused");
    const [lead, ...rest] = outcome.bookings;
    if (!lead) throw new Error("lead missing");
    const rows = await liveSeats(trip.id);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(lead.bookingId)?.partyLeadBookingId).toBeNull();
    expect(byId.get(lead.bookingId)?.claimedAt).toBeNull();
    for (const seat of rest) {
      const row = byId.get(seat.bookingId);
      expect(row?.partyLeadBookingId).toBe(lead.bookingId);
      // A staff typed every name, so no claim link may re-point it.
      expect(row?.claimedAt).not.toBeNull();
    }
  });

  it("leaves public seats claimable, and marks a declared minor's contact as typed by the lead", async () => {
    const trip = await departure({ capacity: 6 });
    const requests = seats(trip.id, 3);
    const minor = requests[2];
    if (!minor) throw new Error("seat missing");
    requests[2] = { ...minor, minorDeclared: true };
    const outcome = await createBookingParty(ctx.db, requests);
    if (!outcome.ok) throw new Error("party refused");
    const rows = new Map((await liveSeats(trip.id)).map((row) => [row.id, row]));
    const [, adult, child] = outcome.bookings;
    expect(rows.get(adult?.bookingId ?? "")?.claimedAt).toBeNull();
    expect(rows.get(adult?.bookingId ?? "")?.contactTypedByLeadAt).toBeNull();
    expect(rows.get(child?.bookingId ?? "")?.contactTypedByLeadAt).not.toBeNull();
  });

  it("counts a cancelled seat the party reopens once, so a full boat still takes the whole party", async () => {
    const trip = await departure({ capacity: 2 });
    const [first] = seats(trip.id, 1, "staff", "again");
    if (!first) throw new Error("seat missing");
    const booked = await createBooking(ctx.db, first);
    if (!booked.ok) throw new Error("setup booking failed");
    expect((await cancelBooking(ctx.db, ctx.shop.id, booked.bookingId)).ok).toBe(true);
    const [second] = seats(trip.id, 1, "staff", "fresh");
    if (!second) throw new Error("seat missing");
    const outcome = await createBookingParty(ctx.db, [first, second]);
    expect(outcome.ok).toBe(true);
    expect(await liveSeats(trip.id)).toHaveLength(2);
    // And a third still does not fit.
    const [third] = seats(trip.id, 1, "staff", "third");
    if (!third) throw new Error("seat missing");
    expect(await createBooking(ctx.db, third)).toEqual({ ok: false, reason: "trip_full" });
  });

  it("refuses seats that name different departures, before anything is written", async () => {
    const one = await departure({ capacity: 4 }, "One");
    const two = await departure({ capacity: 4 }, "Two");
    const mixed = [...seats(one.id, 1, "public", "a"), ...seats(two.id, 1, "public", "b")];
    expect(await createBookingParty(ctx.db, mixed)).toEqual({
      ok: false,
      reason: "trip_unavailable",
      failedIndex: 1,
    });
    expect(await liveSeats(one.id)).toHaveLength(0);
    expect(await liveSeats(two.id)).toHaveLength(0);
  });

  it("refuses a party for a departure that is not there", async () => {
    const outcome = await createBookingParty(
      ctx.db,
      seats("00000000-0000-4000-8000-000000000000", 2),
    );
    expect(outcome).toEqual({ ok: false, reason: "trip_unavailable", failedIndex: 0 });
  });
});
