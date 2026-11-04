// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { recordLostItem, tellLostItemOwner } from "./lost-items";
import { lostItems } from "./schema";
import { claimPartySeat, issuePartySeatClaims } from "./seat-claims";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **A claimed seat takes its found item with it** (review of #3809, third
 * path): the item copies its owner from the seat, so the claimant owns it and
 * a Tell sent to the placeholder is not a Tell to them.
 */
describe("claimPartySeat and a found item on the seat", () => {
  it("moves the item to the claimant and clears the told mark", async () => {
    const { db, shop } = ctx;
    const open = (await upcomingTripsWithCounts(db, shop.id)).find(
      (t) => t.title === "Two-Tank Reef — Christ of the Abyss",
    );
    if (!open) throw new Error("expected seeded trip missing");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: open.id,
        fullName: "Orla Organizer",
        email: "orla@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: open.id, fullName: "Milo Member" },
    ]);
    if (!party.ok) throw new Error("setup party failed");
    const [lead, member] = party.bookings;
    if (!lead || !member) throw new Error("setup party failed");
    const recorded = await recordLostItem(db, {
      shopId: shop.id,
      tripId: open.id,
      bookingId: member.bookingId,
      description: "Blue mask in a red case",
      actorPersonId: null,
    });
    if (!recorded.ok) throw new Error(`lost item refused: ${recorded.reason}`);
    const placeholder = recorded.item.personId;
    // Told while the seat still read as the placeholder's.
    await db
      .update(lostItems)
      .set({ toldAt: nowDate(), toldChannel: "email" })
      .where(eq(lostItems.id, recorded.item.id));

    const seats = await issuePartySeatClaims(db, {
      shopId: shop.id,
      leadBookingId: lead.bookingId,
    });
    const token = seats.find((seat) => seat.bookingId === member.bookingId)?.claim?.token;
    if (!token) throw new Error("expected a claim link");
    const claimed = await claimPartySeat(db, {
      token,
      fullName: "Milo Actual",
      email: "milo-actual@example.com",
    });
    if (!claimed.ok) throw new Error(`claim refused: ${claimed.reason}`);

    const [item] = await db.select().from(lostItems).where(eq(lostItems.id, recorded.item.id));
    expect(item?.personId).toBe(claimed.personId);
    expect(item?.personId).not.toBe(placeholder);
    expect(item).toMatchObject({ toldAt: null, toldChannel: null });
    const email = fakeEmail();
    expect(
      await tellLostItemOwner(
        db,
        { shopId: shop.id, itemId: recorded.item.id },
        { emailProvider: email.provider },
      ),
    ).toEqual({ ok: true, channel: "email" });
    expect(email.sent.map((sent) => sent.to)).toEqual(["milo-actual@example.com"]);
  });
});
