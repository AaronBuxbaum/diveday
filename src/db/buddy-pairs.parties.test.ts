import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { formPartyTeams, listTripBuddyTeams, listTripParties } from "./buddy-pairs";
import { bookings } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/** The Benwood reef trip, three booked divers and no teams, as `buddy-pairs.test.ts` uses it. */
async function buddyContext() {
  const { db, shop } = ctx;
  const tripRows = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = tripRows.find((row) => row.title.startsWith("Two-Tank Reef — Benwood"));
  if (!trip) throw new Error("demo Benwood trip missing");
  const [a, b, c] = await getTripRoster(db, shop.id, trip.id);
  if (!a || !b || !c) throw new Error("expected three Benwood bookings");
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, trip, a, b, c, staff: staff.person };
}

describe("party teams (fifth-loop ideas, item 50)", () => {
  it("keys each seat to its party and teams a party of two once, never the diver who came alone", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    await db
      .update(bookings)
      .set({ partyLeadBookingId: a.booking.id })
      .where(eq(bookings.id, b.booking.id));

    const parties = await listTripParties(db, shop.id, trip.id);
    expect(parties.get(a.booking.id)).toBe(a.booking.id);
    expect(parties.get(b.booking.id)).toBe(a.booking.id);
    expect(parties.get(c.booking.id)).toBe(c.booking.id);

    const input = { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id };
    expect(await formPartyTeams(db, input)).toBe(1);
    const teams = await listTripBuddyTeams(db, shop.id, trip.id);
    expect(teams).toHaveLength(1);
    expect(
      teams[0]?.members.flatMap((member) => (member.kind === "diver" ? [member.bookingId] : [])),
    ).toEqual(expect.arrayContaining([a.booking.id, b.booking.id]));
    // A second tap finds nobody left to team: the party is already a team.
    expect(await formPartyTeams(db, input)).toBe(0);
  });

  it("leaves a party of four or more for the divemaster to split", async () => {
    const { db, shop, trip, a, b, c, staff } = await buddyContext();
    await db
      .update(bookings)
      .set({ partyLeadBookingId: a.booking.id })
      .where(inArray(bookings.id, [b.booking.id, c.booking.id]));
    const [extra] = await db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        personId: staff.id,
        status: "booked",
        bookedAs: "diver",
        partyLeadBookingId: a.booking.id,
      })
      .returning({ id: bookings.id });
    expect(extra).toBeDefined();
    expect(
      await formPartyTeams(db, { shopId: shop.id, tripId: trip.id, recordedByPersonId: staff.id }),
    ).toBe(0);
    expect(await listTripBuddyTeams(db, shop.id, trip.id)).toHaveLength(0);
  });
});
