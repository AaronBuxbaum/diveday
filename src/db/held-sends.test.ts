import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SEND_HOLD_MS } from "@/lib/held-sends";
import { seededShopContext } from "@/test/db";
import { claimDueHeldSends, claimHeldSend, holdSend, undoHeldSend } from "./held-sends";
import { bookings, heldSends, people, personRoles, trips } from "./schema";

async function fixture() {
  const { db, shop } = await seededShopContext();
  const [seat] = await db
    .select({ bookingId: bookings.id, tripId: trips.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(eq(bookings.shopId, shop.id))
    .limit(1);
  const [owner] = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!seat || !owner) throw new Error("fixture needs a booking and an owner");
  return { db, shop, seat, owner };
}

const now = new Date("2026-08-27T10:14:00Z");

/**
 * ADR 20260906-before-you-ask, decision 2: a send you can take back. The row
 * exists for the length of the hold and leaves on either exit.
 */
describe("held sends", () => {
  it("holds a send eight seconds and lets Undo take it back before it is due", async () => {
    const { db, shop, seat, owner } = await fixture();
    const held = await holdSend(db, {
      shopId: shop.id,
      actorPersonId: owner.personId,
      now,
      payload: {
        kind: "waiver_send",
        bookingIds: [seat.bookingId],
        channel: "email",
        surface: "roster",
        tripId: seat.tripId,
      },
    });
    expect(held.runAt.getTime() - now.getTime()).toBe(SEND_HOLD_MS);

    // Not yet: the client asks at zero, the server still says pending.
    expect(await claimHeldSend(db, shop.id, held.id, now)).toEqual({ status: "pending" });
    // Undo before it is due deletes the row: nothing was sent, nothing is logged.
    expect(await undoHeldSend(db, shop.id, held.id, new Date(now.getTime() + 3_000))).toBe(true);
    expect(await db.select().from(heldSends).where(eq(heldSends.id, held.id))).toHaveLength(0);
    expect(await claimHeldSend(db, shop.id, held.id, held.runAt)).toEqual({ status: "gone" });
  });

  it("refuses an undo once the hold has drained, and claims exactly once", async () => {
    const { db, shop, seat, owner } = await fixture();
    const held = await holdSend(db, {
      shopId: shop.id,
      actorPersonId: owner.personId,
      now,
      payload: { kind: "waitlist_invite", tripId: seat.tripId, entryId: seat.bookingId },
    });
    expect(await undoHeldSend(db, shop.id, held.id, held.runAt)).toBe(false);
    const first = await claimHeldSend(db, shop.id, held.id, held.runAt);
    expect(first.status).toBe("claimed");
    if (first.status === "claimed") {
      expect(first.row.payload).toEqual({
        kind: "waitlist_invite",
        tripId: seat.tripId,
        entryId: seat.bookingId,
      });
      expect(first.row.actorPersonId).toBe(owner.personId);
    }
    // The cron sweep and a second client both find nothing left to send.
    expect(await claimHeldSend(db, shop.id, held.id, held.runAt)).toEqual({ status: "gone" });
    expect(await claimDueHeldSends(db, held.runAt)).toEqual([]);
  });

  it("belongs to one shop: another shop can neither undo nor claim it", async () => {
    const { db, shop, seat, owner } = await fixture();
    const held = await holdSend(db, {
      shopId: shop.id,
      actorPersonId: owner.personId,
      now,
      payload: {
        kind: "last_minute_deal",
        tripId: seat.tripId,
        discountPercent: 20,
        recipientPersonIds: [owner.personId],
      },
    });
    const otherShop = "00000000-0000-4000-8000-000000000000";
    expect(await undoHeldSend(db, otherShop, held.id, now)).toBe(false);
    expect(await claimHeldSend(db, otherShop, held.id, held.runAt)).toEqual({ status: "gone" });
    expect(await claimHeldSend(db, shop.id, held.id, held.runAt)).toMatchObject({
      status: "claimed",
    });
  });

  it("sweeps every drained hold for the cron, and none that is still running", async () => {
    const { db, shop, seat, owner } = await fixture();
    const payload = {
      kind: "waiver_send" as const,
      bookingIds: [seat.bookingId],
      channel: "email" as const,
      surface: "today" as const,
    };
    const early = await holdSend(db, {
      shopId: shop.id,
      actorPersonId: owner.personId,
      now,
      payload,
    });
    const late = await holdSend(db, {
      shopId: shop.id,
      actorPersonId: owner.personId,
      now: new Date(now.getTime() + 5_000),
      payload,
    });
    const swept = await claimDueHeldSends(db, early.runAt);
    expect(swept.map((row) => row.id)).toEqual([early.id]);
    expect(await db.select().from(heldSends).where(eq(heldSends.id, late.id))).toHaveLength(1);
  });
});
