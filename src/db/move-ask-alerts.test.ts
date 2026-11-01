import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { markInboundAnswered, recordMoveAsk } from "./inbound-messages";
import { alertStaffToMoveAsk } from "./move-ask-alerts";
import {
  bookings,
  inboundMessages,
  people,
  personRoles,
  shops,
  trips,
  userAccounts,
} from "./schema";
import { liveTrip, notRehearsal } from "./trips-live";

/**
 * **An "Ask to move" close to its boat emails owners and managers** (issue
 * #2667): within a day of the departure, one email to each active owner or
 * manager login and to nobody else; farther out, from a demo shop, or once
 * the ask was answered, none. The mail never carries who asked or what they
 * wrote.
 */
const ctx = fileScopedShopContext();
const ORIGIN = "https://diveday.example";

function recorder() {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return { status: "sent", providerMessageId: `msg-${sent.length}` };
    },
  };
  return { sent, provider };
}

async function ownerAndManagerEmails() {
  const { db, shop } = ctx;
  const rows = await db
    .selectDistinct({ email: userAccounts.email })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.shopId, shop.id),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        eq(userAccounts.status, "active"),
        inArray(personRoles.role, ["owner", "manager"]),
      ),
    );
  return rows.map((row) => row.email).sort();
}

/** File an ask on the `index`th eligible seat; the diver's words ride in the note. */
async function anAsk(index: number) {
  const { db, shop } = ctx;
  const seats = await db
    .select({ bookingId: bookings.id, startsAt: trips.startsAt, fullName: people.fullName })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        eq(bookings.status, "booked"),
        isNull(bookings.identityUnconfirmedAt),
        ne(trips.status, "cancelled"),
        liveTrip(),
        notRehearsal(),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
      ),
    )
    .orderBy(bookings.id);
  const seat = seats[index];
  if (!seat) throw new Error("seeded booking missing");
  const filed = await recordMoveAsk(db, {
    shopId: shop.id,
    bookingId: seat.bookingId,
    note: "Secret note about my ears",
    now: new Date(seat.startsAt.getTime() - 3 * HOUR_MS),
  });
  if (filed.status !== "recorded") throw new Error(`expected recorded, got ${filed.status}`);
  return { messageId: filed.id, startsAt: seat.startsAt, fullName: seat.fullName };
}

async function setDemo(isDemo: boolean) {
  const { db, shop } = ctx;
  await db.update(shops).set({ isDemo }).where(eq(shops.id, shop.id));
}

describe("alertStaffToMoveAsk", () => {
  it("emails each owner and manager, and only them, within a day of the boat", async () => {
    const { db, shop } = ctx;
    await setDemo(false);
    const ask = await anAsk(0);
    const { sent, provider } = recorder();

    const outcome = await alertStaffToMoveAsk(db, {
      shopId: shop.id,
      messageId: ask.messageId,
      now: new Date(ask.startsAt.getTime() - 3 * HOUR_MS),
      origin: ORIGIN,
      provider,
    });

    const staff = await ownerAndManagerEmails();
    expect(staff.length).toBeGreaterThan(0);
    expect(outcome).toEqual({ status: "sent", sent: staff.length, failed: 0 });
    expect(sent.map((notification) => notification.to).sort()).toEqual(staff);
    for (const notification of sent) {
      expect(notification).toMatchObject({
        kind: "move_ask_soon",
        shopId: shop.id,
        messageId: ask.messageId,
        startsAt: ask.startsAt,
        inboxUrl: `${ORIGIN}/shop/${shop.slug}/inbox`,
      });
      // Who asked and what they wrote stay behind the sign-in.
      const payload = JSON.stringify(notification);
      expect(payload).not.toContain("Secret note");
      expect(payload).not.toContain(ask.fullName);
    }
  });

  it("sends nothing more than a day out", async () => {
    const { db, shop } = ctx;
    await setDemo(false);
    const ask = await anAsk(1);
    const { sent, provider } = recorder();
    const outcome = await alertStaffToMoveAsk(db, {
      shopId: shop.id,
      messageId: ask.messageId,
      now: new Date(ask.startsAt.getTime() - 25 * HOUR_MS),
      origin: ORIGIN,
      provider,
    });
    expect(outcome).toEqual({ status: "not_soon" });
    expect(sent).toEqual([]);
  });

  it("sends nothing about a departure that has already sailed", async () => {
    const { db, shop } = ctx;
    await setDemo(false);
    const ask = await anAsk(2);
    const { sent, provider } = recorder();
    const outcome = await alertStaffToMoveAsk(db, {
      shopId: shop.id,
      messageId: ask.messageId,
      now: new Date(ask.startsAt.getTime() + HOUR_MS),
      origin: ORIGIN,
      provider,
    });
    expect(outcome).toEqual({ status: "not_soon" });
    expect(sent).toEqual([]);
  });

  it("tells nobody from a demo shop", async () => {
    const { db, shop } = ctx;
    await setDemo(true);
    const ask = await anAsk(3);
    const { sent, provider } = recorder();
    const outcome = await alertStaffToMoveAsk(db, {
      shopId: shop.id,
      messageId: ask.messageId,
      now: new Date(ask.startsAt.getTime() - HOUR_MS),
      origin: ORIGIN,
      provider,
    });
    expect(outcome).toEqual({ status: "demo" });
    expect(sent).toEqual([]);
  });

  it("sends nothing once the ask was answered, or for another shop's ask", async () => {
    const { db, shop } = ctx;
    await setDemo(false);
    const ask = await anAsk(4);
    const now = new Date(ask.startsAt.getTime() - HOUR_MS);
    const { sent, provider } = recorder();
    expect(
      await alertStaffToMoveAsk(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        messageId: ask.messageId,
        now,
        origin: ORIGIN,
        provider,
      }),
    ).toEqual({ status: "not_found" });
    await markInboundAnswered(db, shop.id, ask.messageId, now);
    expect(
      await alertStaffToMoveAsk(db, {
        shopId: shop.id,
        messageId: ask.messageId,
        now,
        origin: ORIGIN,
        provider,
      }),
    ).toEqual({ status: "not_found" });
    expect(sent).toEqual([]);
  });

  it("emails nobody about a rehearsal's ask", async () => {
    const { db, shop } = ctx;
    await setDemo(false);
    const ask = await anAsk(5);
    const [seat] = await db
      .select({ tripId: bookings.tripId })
      .from(bookings)
      .innerJoin(inboundMessages, eq(inboundMessages.bookingId, bookings.id))
      .where(eq(inboundMessages.id, ask.messageId));
    if (!seat) throw new Error("ask's seat missing");
    // A rehearsal is always private (`trips_rehearsal_is_private`).
    const [before] = await db
      .select({ isPrivate: trips.isPrivate })
      .from(trips)
      .where(eq(trips.id, seat.tripId));
    await db
      .update(trips)
      .set({ isRehearsal: true, isPrivate: true })
      .where(eq(trips.id, seat.tripId));
    const { sent, provider } = recorder();
    const outcome = await alertStaffToMoveAsk(db, {
      shopId: shop.id,
      messageId: ask.messageId,
      now: new Date(ask.startsAt.getTime() - HOUR_MS),
      origin: ORIGIN,
      provider,
    });
    await db
      .update(trips)
      .set({ isRehearsal: false, isPrivate: before?.isPrivate ?? false })
      .where(eq(trips.id, seat.tripId));
    expect(outcome).toEqual({ status: "not_found" });
    expect(sent).toEqual([]);
  });
});
