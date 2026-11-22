// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { cancelBooking, createBooking, createBookingParty } from "./bookings";
import { bookings, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

// A minor's typed age on the booking write (#4897). One seeded database for the
// file and a rolled-back transaction per test (src/test/db.ts).
const ctx = fileScopedShopContext();

async function seededContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded trip missing");
  return { db, shop, open };
}

describe("a booking's declared age", () => {
  // The age a booker types for an Under 18 seat (#4897). It belongs to a declared
  // minor's seat alone: an adult's seat never carries one, whatever was sent.
  it("keeps a declared minor's typed age on the seat, a zero included, and none on an adult's", async () => {
    const { db, shop, open } = await seededContext();
    const base = { actor: "public" as const, shopId: shop.id, tripId: open.id };
    const outcome = await createBookingParty(db, [
      // An adult with an age sent anyway: booked, and the age is dropped.
      { ...base, fullName: "Ines Marlow", email: "ines-age@example.com", declaredAge: 12 },
      { ...base, fullName: "Maya Marlow", minorDeclared: true, declaredAge: 12 },
      // Zero is an age (an infant riding along), not "no age".
      { ...base, fullName: "Bo Marlow", minorDeclared: true, declaredAge: 0 },
      { ...base, fullName: "Kit Marlow", minorDeclared: true },
    ]);
    if (!outcome.ok) throw new Error(`setup booking failed: ${outcome.reason}`);
    const seats = await db
      .select({ name: people.fullName, declaredAge: bookings.declaredAge })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(eq(bookings.tripId, open.id));
    const age = new Map(seats.map((seat) => [seat.name, seat.declaredAge]));
    expect(age.get("Ines Marlow")).toBeNull();
    expect(age.get("Maya Marlow")).toBe(12);
    expect(age.get("Bo Marlow")).toBe(0);
    expect(age.get("Kit Marlow")).toBeNull();
  });

  // A cancelled seat booked again is a new booking: it carries this booking's
  // age, and loses it when the seat comes back as an adult's.
  it("rewrites the typed age when a cancelled seat is booked again", async () => {
    const { db, shop, open } = await seededContext();
    const request = {
      actor: "public" as const,
      shopId: shop.id,
      tripId: open.id,
      fullName: "Maya Marlow",
      email: "maya-age@example.com",
    };
    const ageOf = async (bookingId: string) =>
      (
        await db
          .select({ declaredAge: bookings.declaredAge })
          .from(bookings)
          .where(eq(bookings.id, bookingId))
      )[0]?.declaredAge;
    const rebook = async (extra: { minorDeclared?: boolean; declaredAge?: number }) => {
      const booked = await createBooking(db, { ...request, ...extra });
      if (!booked.ok) throw new Error(`booking failed: ${booked.reason}`);
      return booked.bookingId;
    };

    const first = await rebook({ minorDeclared: true, declaredAge: 9 });
    expect(await ageOf(first)).toBe(9);
    await cancelBooking(db, shop.id, first);
    const again = await rebook({ minorDeclared: true, declaredAge: 0 });
    expect(again).toBe(first);
    expect(await ageOf(again)).toBe(0);
    await cancelBooking(db, shop.id, again);
    // Back as an adult, with a stray age sent: none is kept.
    const adult = await rebook({ declaredAge: 9 });
    expect(adult).toBe(first);
    expect(await ageOf(adult)).toBeNull();
    await cancelBooking(db, shop.id, adult);
    const unsaid = await rebook({ minorDeclared: true });
    expect(await ageOf(unsaid)).toBeNull();
  });
});
