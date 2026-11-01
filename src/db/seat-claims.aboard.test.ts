// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty, previewPartyCancel } from "./bookings";
import { rollCallEvents } from "./schema";
import { issuePartySeatClaims } from "./seat-claims";
import { listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **The party-cancel preview mirrors the cancel** (H-20261015-aboard-diver-removal-at): a seat counted
 * aboard a boat past its time stays with the crew, as
 * `cancelUnclaimedPartySeats` keeps it, so the confirm never lists it as going.
 */
describe("issuePartySeatClaims and a seat counted aboard", () => {
  async function party() {
    const { db, shop } = ctx;
    const open = (await upcomingTripsWithCounts(db, shop.id)).find(
      (t) => t.title === "Two-Tank Reef — Christ of the Abyss",
    );
    if (!open) throw new Error("expected seeded trip missing");
    const outcome = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Orla Organizer",
        email: "orla@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: open.id, fullName: "Milo Member" },
      { actor: "public", shopId: shop.id, tripId: open.id, fullName: "Pia Member" },
    ]);
    if (!outcome.ok) throw new Error("setup party failed");
    const [lead, memberOne, memberTwo] = outcome.bookings;
    if (!lead || !memberOne || !memberTwo) throw new Error("setup party failed");
    return { db, shop, open, lead, memberOne, memberTwo };
  }

  it("lists a seat counted aboard a boat past its time as staying, as the cancel keeps it (H-20261015-aboard-diver-removal-at)", async () => {
    const { db, shop, open, lead, memberOne, memberTwo } = await party();
    const [recorder] = await listStaff(db, shop.id);
    if (!recorder) throw new Error("seeded staff missing");
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: open.id,
      bookingId: memberOne.bookingId,
      recordedByPersonId: recorder.person.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date(open.startsAt.getTime() + 5 * 60 * 1000),
    });
    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      // Twenty minutes past its time: the boat has left, `hasSailed` not yet.
      now: new Date(open.startsAt.getTime() + 20 * 60 * 1000),
    });
    const goes = new Map(seats.map((seat) => [seat.bookingId, seat.cancelsWithLead]));
    expect(goes.get(memberOne.bookingId)).toBe(false);
    expect(goes.get(memberTwo.bookingId)).toBe(true);
  });
  it("counts that seat as staying in the text-reply preview too (H-20261015-aboard-diver-removal-at)", async () => {
    const { db, shop, open, lead, memberOne } = await party();
    const [recorder] = await listStaff(db, shop.id);
    if (!recorder) throw new Error("seeded staff missing");
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: open.id,
      bookingId: memberOne.bookingId,
      recordedByPersonId: recorder.person.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date(open.startsAt.getTime() + 5 * 60 * 1000),
    });
    const preview = await previewPartyCancel(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
      now: new Date(open.startsAt.getTime() + 20 * 60 * 1000),
    });
    expect(preview).toEqual({ goes: 1, stays: 1 });
  });
});
