import { and, asc, eq, gt, ne, notExists } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { MOVE_ASK_NOTE_MAX_LENGTH } from "@/lib/inbox";
import { fileScopedShopContext, type seededShopContext } from "@/test/db";
import {
  countUnansweredMessages,
  getInboundMessage,
  getPendingMoveAsk,
  hasMoveAsk,
  markInboundAnswered,
  recordMoveAsk,
  recordStaffReply,
  reopenInboundMessage,
} from "./inbound-messages";
import { bookings, inboundMessages, people, shops, trips } from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * "Ask to move" (H-126, H-151), split from inbound-messages.test.ts for length:
 * the same file-scoped seeded shop, the same frozen instant.
 */

const NOW = new Date("2026-07-21T13:30:00.000Z");

async function shopWithCountry(
  db: Awaited<ReturnType<typeof seededShopContext>>["db"],
  country: string,
  slug: string,
): Promise<string> {
  const [row] = await db
    .insert(shops)
    .values({ name: slug, slug, timezone: "UTC", addressCountry: country })
    .returning({ id: shops.id });
  if (!row) throw new Error("shop insert failed");
  return row.id;
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

/**
 * H-126: "Ask to move" from the booking page. One row per booking, filed on
 * the diver the booking belongs to and only inside its shop.
 */
describe("an Ask to move", () => {
  async function aBooking() {
    const { db, shop } = ctx;
    const [row] = await db
      .select({ bookingId: bookings.id, personId: bookings.personId, tripId: bookings.tripId })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.shopId, shop.id),
          eq(bookings.status, "booked"),
          gt(trips.startsAt, NOW),
          liveTrip(),
          notRehearsal(),
        ),
      )
      .limit(1);
    if (!row) throw new Error("seeded booking missing");
    return row;
  }

  it("files one page message naming the booking, as a move, from the diver on file", async () => {
    const { db, shop } = ctx;
    const { bookingId, personId } = await aBooking();
    expect(await hasMoveAsk(db, shop.id, bookingId)).toBe(false);
    const first = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      note: "  Any Saturday in August  ",
      now: NOW,
    });
    if (first.status !== "recorded") throw new Error(`expected recorded, got ${first.status}`);
    const row = await getInboundMessage(db, shop.id, first.id);
    expect(row).toMatchObject({
      channel: "page",
      keywordIntent: "move",
      bookingId,
      personId,
      body: "Any Saturday in August",
      answeredAt: null,
      senderAuthenticated: true,
    });
    expect(await hasMoveAsk(db, shop.id, bookingId)).toBe(true);
    expect(await getPendingMoveAsk(db, shop.id, bookingId)).toEqual({
      note: "Any Saturday in August",
      sentAt: NOW,
    });
    // `/ready` passes the departure it already read: the same answer.
    const [seat] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!seat) throw new Error("seeded booking missing");
    expect(await hasMoveAsk(db, shop.id, bookingId, seat.tripId)).toBe(true);
    expect(await countUnansweredMessages(db, shop.id)).toBeGreaterThan(0);

    const again = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      note: "A replacement that was not sent",
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(again.status).toBe("already");
    expect(await getPendingMoveAsk(db, shop.id, bookingId)).toEqual({
      note: "Any Saturday in August",
      sentAt: NOW,
    });
  });

  /**
   * Dive-domain review F1 of layer r4-1: the ask is about one departure. A
   * seat the desk moved can ask again about its new date, and an ask staff
   * answered or deleted no longer stands, so asking again files it anew
   * rather than vanishing into `already`.
   */
  it("stands for one departure: a moved seat asks again", async () => {
    const { db, shop } = ctx;
    const { bookingId, personId, tripId } = await aBooking();
    const first = await recordMoveAsk(db, { shopId: shop.id, bookingId, now: NOW });
    if (first.status !== "recorded") throw new Error(`expected recorded, got ${first.status}`);
    const [other] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          ne(trips.id, tripId),
          gt(trips.startsAt, NOW),
          liveTrip(),
          notRehearsal(),
          notExists(
            db
              .select({ id: bookings.id })
              .from(bookings)
              .where(and(eq(bookings.tripId, trips.id), eq(bookings.personId, personId))),
          ),
        ),
      )
      .orderBy(asc(trips.startsAt), asc(trips.id))
      .limit(1);
    if (!other) throw new Error("expected a second seeded trip");
    await db.update(bookings).set({ tripId: other.id }).where(eq(bookings.id, bookingId));
    expect(await hasMoveAsk(db, shop.id, bookingId)).toBe(false);
    expect(await getPendingMoveAsk(db, shop.id, bookingId, tripId)).toBeNull();
    const second = await recordMoveAsk(db, { shopId: shop.id, bookingId, now: NOW });
    if (second.status !== "recorded") throw new Error(`expected recorded, got ${second.status}`);
    expect(second.id).not.toBe(first.id);
    expect(await hasMoveAsk(db, shop.id, bookingId)).toBe(true);
  });

  it.each(["answered", "deleted"] as const)(
    "no longer stands once %s, and asking again files it anew",
    async (state) => {
      const { db, shop } = ctx;
      const { bookingId } = await aBooking();
      const first = await recordMoveAsk(db, { shopId: shop.id, bookingId, now: NOW });
      if (first.status !== "recorded") throw new Error(`expected recorded, got ${first.status}`);
      await db
        .update(inboundMessages)
        .set(state === "answered" ? { answeredAt: NOW } : { deletedAt: NOW })
        .where(eq(inboundMessages.id, first.id));
      expect(await hasMoveAsk(db, shop.id, bookingId)).toBe(false);
      const later = new Date(NOW.getTime() + 60_000);
      const again = await recordMoveAsk(db, {
        shopId: shop.id,
        bookingId,
        note: "Still sick, any date next month",
        now: later,
      });
      if (again.status !== "recorded") throw new Error(`expected recorded, got ${again.status}`);
      expect(await getInboundMessage(db, shop.id, again.id)).toMatchObject({
        body: "Still sick, any date next month",
        answeredAt: null,
        receivedAt: later,
      });
      expect(await getPendingMoveAsk(db, shop.id, bookingId)).toEqual({
        note: "Still sick, any date next month",
        sentAt: later,
      });
    },
  );

  it("refuses a stale Mark done form after the diver renews the same move request", async () => {
    const { db, shop } = ctx;
    const { bookingId } = await aBooking();
    const first = await recordMoveAsk(db, { shopId: shop.id, bookingId, note: "August", now: NOW });
    if (first.status !== "recorded") throw new Error("request not filed");
    await markInboundAnswered(db, shop.id, first.id, NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const renewed = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      note: "September instead",
      now: later,
    });
    if (renewed.status !== "recorded") throw new Error("renewal not filed");
    expect(renewed.id).not.toBe(first.id);
    expect(await markInboundAnswered(db, shop.id, first.id, later, NOW)).toBe(false);
    expect(await getPendingMoveAsk(db, shop.id, bookingId)).toEqual({
      note: "September instead",
      sentAt: later,
    });
    expect(await markInboundAnswered(db, shop.id, renewed.id, later, later)).toBe(true);
    expect(await getPendingMoveAsk(db, shop.id, bookingId)).toBeNull();
  });

  it.each(["done", "reopen", "sent reply"] as const)(
    "keeps a renewal at the same instant pending after a stale %s",
    async (act) => {
      const { db, shop } = ctx;
      const { bookingId, personId } = await aBooking();
      const first = await recordMoveAsk(db, {
        shopId: shop.id,
        bookingId,
        note: "August",
        now: NOW,
      });
      if (first.status !== "recorded") throw new Error("request not filed");
      await markInboundAnswered(db, shop.id, first.id, NOW);
      const renewed = await recordMoveAsk(db, {
        shopId: shop.id,
        bookingId,
        note: "September instead",
        now: NOW,
      });
      if (renewed.status !== "recorded") throw new Error("renewal not filed");
      if (act === "done") {
        expect(await markInboundAnswered(db, shop.id, first.id, NOW, NOW)).toBe(false);
      } else if (act === "reopen") {
        expect(await reopenInboundMessage(db, shop.id, first.id, NOW)).toBe(false);
      } else {
        await recordStaffReply(db, {
          shopId: shop.id,
          personId,
          inboundMessageId: first.id,
          channel: "email",
          toAddress: "diver@example.com",
          body: "Answer to August request",
          locale: "en-US",
          sentByPersonId: null,
          delivery: { status: "sent", providerMessageId: "old-move-reply" },
          sentAt: NOW,
        });
      }
      expect(await getPendingMoveAsk(db, shop.id, bookingId)).toEqual({
        note: "September instead",
        sentAt: NOW,
      });
      expect(renewed.id).not.toBe(first.id);
      expect(await getInboundMessage(db, shop.id, first.id)).toMatchObject({
        body: "August",
        answeredAt: NOW,
      });
      expect(await markInboundAnswered(db, shop.id, renewed.id, NOW, NOW)).toBe(true);
      expect(await getPendingMoveAsk(db, shop.id, bookingId)).toBeNull();
    },
  );

  it("never folds staff-only reply text into the diver's receipt", async () => {
    const { db, shop } = ctx;
    const { bookingId, personId } = await aBooking();
    const asked = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      note: "August please",
      now: NOW,
    });
    if (asked.status !== "recorded") throw new Error("request not filed");
    await recordStaffReply(db, {
      shopId: shop.id,
      personId,
      inboundMessageId: asked.id,
      channel: "email",
      toAddress: "diver@example.com",
      body: "Private failed reply about another guest",
      locale: "en-US",
      sentByPersonId: null,
      delivery: { status: "failed", detail: "Provider-private failure" },
    });
    expect(await getPendingMoveAsk(db, shop.id, bookingId)).toEqual({
      note: "August please",
      sentAt: NOW,
    });
    await markInboundAnswered(db, shop.id, asked.id, NOW);
    expect(await getPendingMoveAsk(db, shop.id, bookingId)).toBeNull();
    await reopenInboundMessage(db, shop.id, asked.id);
    expect(await getPendingMoveAsk(db, shop.id, bookingId)).toEqual({
      note: "August please",
      sentAt: NOW,
    });
  });

  it.each([
    "cancelled seat",
    "cancelled departure",
    "deleted departure",
    "held identity",
    "deleted person",
    "erased person",
  ] as const)("hides a standing receipt for a %s and refuses a stale submission", async (state) => {
    const { db, shop } = ctx;
    const { bookingId, tripId, personId } = await aBooking();
    const first = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      note: "Private dates",
      now: NOW,
    });
    expect(first.status).toBe("recorded");
    if (state === "cancelled seat")
      await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    if (state === "cancelled departure")
      await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    if (state === "deleted departure")
      await db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, tripId));
    if (state === "held identity")
      await db
        .update(bookings)
        .set({ identityUnconfirmedAt: NOW })
        .where(eq(bookings.id, bookingId));
    if (state === "deleted person")
      await db.update(people).set({ deletedAt: NOW }).where(eq(people.id, personId));
    if (state === "erased person")
      await db
        .update(people)
        .set({ anonymizedAt: NOW, deletedAt: NOW })
        .where(eq(people.id, personId));
    expect(await getPendingMoveAsk(db, shop.id, bookingId, tripId)).toBeNull();
    expect(
      await recordMoveAsk(db, { shopId: shop.id, bookingId, expectedTripId: tripId, now: NOW }),
    ).toEqual({ status: "not_found" });
  });

  it("refuses a form for the departure staff already moved the seat from", async () => {
    const { db, shop } = ctx;
    const { bookingId, personId, tripId } = await aBooking();
    const [other] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          ne(trips.id, tripId),
          notExists(
            db
              .select({ id: bookings.id })
              .from(bookings)
              .where(and(eq(bookings.tripId, trips.id), eq(bookings.personId, personId))),
          ),
        ),
      )
      .orderBy(asc(trips.startsAt), asc(trips.id))
      .limit(1);
    if (!other) throw new Error("expected another trip");
    await db.update(bookings).set({ tripId: other.id }).where(eq(bookings.id, bookingId));
    expect(
      await recordMoveAsk(db, {
        shopId: shop.id,
        bookingId,
        expectedTripId: tripId,
        note: "About the original date",
        now: NOW,
      }),
    ).toEqual({ status: "not_found" });
    expect(await hasMoveAsk(db, shop.id, bookingId)).toBe(false);
  });

  /** H-151: the called-off card's ask opens only a booked seat on a cancelled departure. */
  it.each(["live departure", "cancelled seat", "deleted departure", "held identity"] as const)(
    "refuses a called-off ask for a %s",
    async (state) => {
      const { db, shop } = ctx;
      const { bookingId, tripId } = await aBooking();
      if (state !== "live departure")
        await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
      if (state === "cancelled seat")
        await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
      if (state === "deleted departure")
        await db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, tripId));
      if (state === "held identity")
        await db
          .update(bookings)
          .set({ identityUnconfirmedAt: NOW })
          .where(eq(bookings.id, bookingId));
      const asked = await recordMoveAsk(db, {
        shopId: shop.id,
        bookingId,
        calledOff: true,
        now: NOW,
      });
      expect(asked).toEqual({ status: "not_found" });
      expect(await hasMoveAsk(db, shop.id, bookingId, undefined, { calledOff: true })).toBe(false);
    },
  );

  it("files a called-off ask on a cancelled departure, which an ordinary read never sees", async () => {
    const { db, shop } = ctx;
    const { bookingId, tripId } = await aBooking();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    const filed = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      calledOff: true,
      now: NOW,
    });
    expect(filed.status).toBe("recorded");
    expect(await hasMoveAsk(db, shop.id, bookingId, undefined, { calledOff: true })).toBe(true);
    expect(await hasMoveAsk(db, shop.id, bookingId)).toBe(false);
  });

  it("lets an ordinary ask filed before the call-off lapse, so the called-off card can ask afresh", async () => {
    const { db, shop } = ctx;
    const { bookingId, tripId } = await aBooking();
    const askedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const calledOffAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const ordinary = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      note: "Must be back by Sunday.",
      now: askedAt,
    });
    expect(ordinary.status).toBe("recorded");
    await db
      .update(trips)
      .set({ status: "cancelled", cancelledAt: calledOffAt })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shop.id)));

    // The live-boat ask was about a departure that no longer sails: it does not
    // stand on the called-off card, which keeps offering the move.
    expect(await hasMoveAsk(db, shop.id, bookingId, undefined, { calledOff: true })).toBe(false);

    const filed = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      calledOff: true,
      note: "Please move me to Two-Tank Reef, Thu 12:00.",
      now: NOW,
    });
    expect(filed.status).toBe("recorded");
    if (ordinary.status !== "recorded" || filed.status !== "recorded") return;
    // The diver's own words travel with the new ask, after the offer.
    const [fresh] = await db
      .select({ body: inboundMessages.body })
      .from(inboundMessages)
      .where(and(eq(inboundMessages.shopId, shop.id), eq(inboundMessages.id, filed.id)));
    expect(fresh?.body).toBe(
      "Please move me to Two-Tank Reef, Thu 12:00.\n\nMust be back by Sunday.",
    );
    expect(filed.id).not.toBe(ordinary.id);
    const [lapsed] = await db
      .select({
        answeredAt: inboundMessages.answeredAt,
        providerMessageId: inboundMessages.providerMessageId,
      })
      .from(inboundMessages)
      .where(and(eq(inboundMessages.shopId, shop.id), eq(inboundMessages.id, ordinary.id)));
    expect(lapsed?.answeredAt).toEqual(NOW);
    expect(lapsed?.providerMessageId).toMatch(/:superseded:/);

    // The ask filed after the call-off stands: a repeat is `already`.
    expect(await hasMoveAsk(db, shop.id, bookingId, undefined, { calledOff: true })).toBe(true);
    expect(
      await recordMoveAsk(db, { shopId: shop.id, bookingId, calledOff: true, now: NOW }),
    ).toEqual({ status: "already" });
  });

  it("keeps the offer first and the carried note within the length a note may have", async () => {
    const { db, shop } = ctx;
    const { bookingId, tripId } = await aBooking();
    const ordinary = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      note: "x".repeat(MOVE_ASK_NOTE_MAX_LENGTH),
      now: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });
    expect(ordinary.status).toBe("recorded");
    await db
      .update(trips)
      .set({ status: "cancelled", cancelledAt: new Date(NOW.getTime() - 60 * 60 * 1000) })
      .where(and(eq(trips.id, tripId), eq(trips.shopId, shop.id)));
    const offer = "Please move me to Two-Tank Reef, Thu 12:00.";
    const filed = await recordMoveAsk(db, {
      shopId: shop.id,
      bookingId,
      calledOff: true,
      note: offer,
      now: NOW,
    });
    if (filed.status !== "recorded") throw new Error(`expected recorded, got ${filed.status}`);
    const [fresh] = await db
      .select({ body: inboundMessages.body })
      .from(inboundMessages)
      .where(and(eq(inboundMessages.shopId, shop.id), eq(inboundMessages.id, filed.id)));
    expect(fresh?.body.startsWith(`${offer}\n\nx`)).toBe(true);
    expect(fresh?.body).toHaveLength(MOVE_ASK_NOTE_MAX_LENGTH);
  });

  it("finds no booking from another shop", async () => {
    const { db } = ctx;
    const { bookingId } = await aBooking();
    const elsewhere = await shopWithCountry(db, "US", "move-ask-elsewhere");
    expect(await recordMoveAsk(db, { shopId: elsewhere, bookingId, now: NOW })).toEqual({
      status: "not_found",
    });
    expect(await hasMoveAsk(db, elsewhere, bookingId)).toBe(false);
  });
});
