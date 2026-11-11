import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { cancelBooking, createBookingParty } from "@/db/bookings";
import { bookings } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { getGroupClaimPageData, issueGroupSeatClaim } from "./group";
import { claimPartySeat } from "./store";

const ctx = fileScopedShopContext();
async function party() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Christ of the Abyss",
  );
  if (!trip) throw new Error("trip missing");
  const result = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Group Lead",
      email: "group-lead@example.com",
    },
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Guest 2", unnamedGuest: true },
    { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Guest 3", unnamedGuest: true },
  ]);
  if (!result.ok) throw new Error(result.reason);
  return {
    db,
    shop,
    trip,
    lead: result.bookings[0],
    one: result.bookings[1],
    two: result.bookings[2],
  };
}
describe("group seat sharing", () => {
  it("shares only unclaimed companion claim links and cannot authorize readiness", async () => {
    const { db, shop, lead, one } = await party();
    const link = await issueGroupSeatClaim(db, { shopId: shop.id, leadBookingId: lead.bookingId });
    if (!link) throw new Error("expected group link");
    const data = await getGroupClaimPageData(db, link.token);
    if (!data) throw new Error("expected group data");
    expect(data?.seats.map((seat) => seat.seatName)).toEqual(["Guest 2", "Guest 3"]);
    expect(Object.keys(data.seats[0]).sort()).toEqual(["claim", "seatName"]);
    expect(
      await verifyBookingCapability(db, { token: link.token, purpose: "readiness" }),
    ).toBeNull();
    const claimed = await claimPartySeat(db, {
      token: data.seats[0].claim.token,
      fullName: "Group Member",
      email: "group-member@example.com",
    });
    expect(claimed.ok).toBe(true);
    expect((await getGroupClaimPageData(db, link.token))?.seats).toHaveLength(1);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, one.bookingId));
    expect(row.identityUnconfirmedAt).toBeNull();
  });
  it("does not mint from another shop, a companion or an identity-held organizer", async () => {
    const { db, shop, lead, one } = await party();
    expect(
      await issueGroupSeatClaim(db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        leadBookingId: lead.bookingId,
      }),
    ).toBeNull();
    expect(
      await issueGroupSeatClaim(db, { shopId: shop.id, leadBookingId: one.bookingId }),
    ).toBeNull();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: new Date("2026-11-11T10:00:00Z") })
      .where(eq(bookings.id, lead.bookingId));
    expect(
      await issueGroupSeatClaim(db, { shopId: shop.id, leadBookingId: lead.bookingId }),
    ).toBeNull();
  });
  it("refuses readiness tokens and canceled organizers", async () => {
    const { db, shop, lead } = await party();
    const ready = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: lead.bookingId,
      purpose: "readiness",
    });
    if (!ready) throw new Error("expected ready link");
    expect(await getGroupClaimPageData(db, ready.token)).toBeNull();
    const group = await issueGroupSeatClaim(db, { shopId: shop.id, leadBookingId: lead.bookingId });
    if (!group) throw new Error("expected group link");
    await cancelBooking(db, shop.id, lead.bookingId);
    expect(await getGroupClaimPageData(db, group.token)).toBeNull();
  });
});
