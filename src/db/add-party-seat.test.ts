import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
import { fileScopedShopContext } from "@/test/db";
import { addPartySeat, createBooking, createBookingParty } from "./bookings";
import { bookings, tripRequirements, trips } from "./schema";
import { issuePartySeatClaims } from "./seat-claims";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

async function soloBooking() {
  const { db, shop } = ctx;
  const all = await upcomingTripsWithCounts(db, shop.id);
  const open = all.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded trip missing");
  const lead = await createBooking(db, {
    actor: "public",
    shopId: shop.id,
    tripId: open.id,
    fullName: "Nora Quinn",
    email: "nora-add-seat@example.com",
  });
  if (!lead.ok) throw new Error(`lead booking failed: ${lead.reason}`);
  return { db, shop, open, leadBookingId: lead.bookingId };
}

/**
 * **"Add a seat" from `/ready`** (UX review 2026-10-11, item 13): a diver who
 * booked alone brings a friend. The seat joins their party with a claim link,
 * through the same gates as booking one.
 */
describe("addPartySeat", () => {
  it("adds a seat to the diver's party, with a claim link for the friend", async () => {
    const { db, shop, leadBookingId } = await soloBooking();
    const outcome = await addPartySeat(db, {
      shopId: shop.id,
      leadBookingId,
      seatName: "Milo Quinn",
    });
    expect(outcome.ok).toBe(true);
    const seats = await issuePartySeatClaims(db, { shopId: shop.id, leadBookingId });
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ seatName: "Milo Quinn", claimed: false });
    expect(seats[0]?.claim?.token).toBeTruthy();
  });

  it("refuses when the boat is full, and adds nothing", async () => {
    const { db, shop, open, leadBookingId } = await soloBooking();
    const fresh = await upcomingTripsWithCounts(db, shop.id);
    const booked = fresh.find((t) => t.id === open.id)?.booked ?? 0;
    await db.update(trips).set({ capacity: booked }).where(eq(trips.id, open.id));
    const outcome = await addPartySeat(db, { shopId: shop.id, leadBookingId, seatName: "Milo" });
    expect(outcome).toMatchObject({ ok: false, reason: "trip_full" });
    expect(await issuePartySeatClaims(db, { shopId: shop.id, leadBookingId })).toHaveLength(0);
  });

  it("refuses a seat the trip's own admission rule would refuse", async () => {
    const { db, shop, open, leadBookingId } = await soloBooking();
    await db
      .update(tripRequirements)
      .set({
        minimumCertificationLevel: "divemaster",
        requiredSpecialties: [],
        requiresNitrox: false,
      })
      .where(and(eq(tripRequirements.tripId, open.id), eq(tripRequirements.shopId, shop.id)));
    const direct = await createBooking(db, {
      actor: "public",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Walk Up",
    });
    const outcome = await addPartySeat(db, { shopId: shop.id, leadBookingId, seatName: "Milo" });
    // Whatever the public form would answer for a stranger, this answers too.
    expect(outcome.ok).toBe(direct.ok);
  });

  it("refuses a held seat, a party member's seat, a cancelled one and another shop's", async () => {
    const { db, shop, open, leadBookingId } = await soloBooking();
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Ana Lead",
        email: "ana-lead@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: open.id, fullName: "Ben Member" },
    ]);
    if (!party.ok) throw new Error("party failed");
    const member = party.bookings[1]?.bookingId ?? "";
    expect(
      await addPartySeat(db, { shopId: shop.id, leadBookingId: member, seatName: "X" }),
    ).toEqual({ ok: false, reason: "lead_unavailable" });
    expect(
      await addPartySeat(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        leadBookingId,
        seatName: "X",
      }),
    ).toEqual({ ok: false, reason: "lead_unavailable" });
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Nora Q" })
      .where(eq(bookings.id, leadBookingId));
    expect(await addPartySeat(db, { shopId: shop.id, leadBookingId, seatName: "X" })).toEqual({
      ok: false,
      reason: "lead_unavailable",
    });
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null, identityBookedAs: null, status: "cancelled" })
      .where(eq(bookings.id, leadBookingId));
    expect(await addPartySeat(db, { shopId: shop.id, leadBookingId, seatName: "X" })).toEqual({
      ok: false,
      reason: "lead_unavailable",
    });
  });

  it("never grows a party past the public form's own cap", async () => {
    const { db, shop, open, leadBookingId } = await soloBooking();
    await db.update(trips).set({ capacity: 60 }).where(eq(trips.id, open.id));
    for (let i = 1; i < MAX_PUBLIC_PARTY_SIZE; i += 1) {
      const added = await addPartySeat(db, {
        shopId: shop.id,
        leadBookingId,
        seatName: `Guest ${i}`,
      });
      expect(added.ok).toBe(true);
    }
    expect(
      await addPartySeat(db, { shopId: shop.id, leadBookingId, seatName: "One more" }),
    ).toEqual({ ok: false, reason: "party_full" });
  });
});
