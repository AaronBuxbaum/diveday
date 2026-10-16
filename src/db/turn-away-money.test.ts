import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { turnAwayReasons } from "@/lib/turn-away";
import { fileScopedShopContext } from "@/test/db";
import { fakeCheckout, fakeEmail, fakeSms } from "@/test/fakes";
import { anonymizeDiver } from "./anonymize";
import { cancelBooking, createBookingParty } from "./bookings";
import { markCheckoutPaidBySessionId, startBookingCheckout } from "./checkouts";
import { markBookingNoShow } from "./no-show";
import { getBookingPayment, setBookingPayment } from "./payments";
import { getBookingReadiness } from "./readiness";
import { refundBookingOnCancellation } from "./refunds";
import { sendDueReminders } from "./reminders";
import {
  bookingCheckouts,
  bookings,
  notificationDeliveries,
  people,
  personRoles,
  tripDeskEvents,
  trips,
} from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { listStaff, upcomingTripsWithCounts, updateTrip } from "./trips";
import { turnBookingAway } from "./turn-away";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **A turned-away seat after the desk** (layer 3 review, 2026-10-16: dde-1 F2,
 * dde-2 #1, #2 and #4). The desk's writer is proven in `turn-away.test.ts`;
 * these are the readers downstream of it that treated the released seat as
 * still held (money, the night-before reminder) or forgot it (erasure). Each
 * sets the turned-away state directly, exactly as `turnBookingAway` leaves it.
 */
async function seat() {
  const { db, shop } = ctx;
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((trip) =>
    trip.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Tess Away",
      email: "turned-away-money@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  /** How `turnBookingAway` leaves the row; `status` lets a test remove it after. */
  const turnAway = (at: Date, status: "no_show" | "cancelled" = "no_show") =>
    db
      .update(bookings)
      .set({ status, turnedAwayAt: at, turnedAwayReason: "payment" })
      .where(eq(bookings.id, bookingId));
  return { db, shop, reef, bookingId, turnAway };
}

describe("a seat the desk turned away", () => {
  it("tells the crew's catch-up strip it was turned away when Remove takes it off", async () => {
    // Not "gave up a seat": the diver did not give it up, the desk refused it.
    const { db, shop, bookingId, turnAway } = await seat();
    await turnAway(nowDate());
    expect(await cancelBooking(db, shop.id, bookingId)).toMatchObject({ ok: true });
    expect(
      await db
        .select({ kind: tripDeskEvents.kind })
        .from(tripDeskEvents)
        .where(eq(tripDeskEvents.bookingId, bookingId)),
    ).toEqual([{ kind: "seat_turned_away" }]);
  });

  /** dde-2 #1: turned away for payment at 07:00, paid at 07:10 for a resold seat. */
  it("cannot be paid for", async () => {
    const { db, shop, reef, bookingId, turnAway } = await seat();
    await upsertShopStripeAccount(db, shop.id, "acct_turned_away");
    await setShopStripeAccountStatus(db, "acct_turned_away", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: 18_000,
    });
    const input = {
      shopId: shop.id,
      tripId: reef.id,
      bookingIds: [bookingId],
      customerEmail: "turned-away-money@example.com",
      successUrl: "https://diveday.example/return",
      cancelUrl: "https://diveday.example/cancel",
      describeLine: ({ tripTitle }: { tripTitle: string }) => tripTitle,
    };
    await turnAway(new Date(reef.startsAt.getTime() - HOUR_MS));
    expect(await startBookingCheckout(db, input, fakeCheckout())).toEqual({
      ok: false,
      reason: "invalid",
    });
    // The control: the same seat, held, is charged.
    await db
      .update(bookings)
      .set({ status: "booked", turnedAwayAt: null, turnedAwayReason: null })
      .where(eq(bookings.id, bookingId));
    expect(await startBookingCheckout(db, input, fakeCheckout())).toMatchObject({ ok: true });
  });

  /**
   * dde-2 #2: removed afterwards, the seat is not the diver cancelling. Past
   * the window a diver's own cancel forfeits; this one moves nothing on its
   * own and hands the money to a person.
   */
  it("hands its money to staff when removed, whatever the window says", async () => {
    const { db, shop, reef, bookingId, turnAway } = await seat();
    await db.update(trips).set({ cancellationWindowHours: 48 }).where(eq(trips.id, reef.id));
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 18_000,
      note: "cash at counter",
    });
    const pastDeadline = new Date(reef.startsAt.getTime() - HOUR_MS);
    const insideWindow = new Date(reef.startsAt.getTime() - 72 * HOUR_MS);
    // The control: an ordinary seat removed past the window forfeits.
    expect(
      await refundBookingOnCancellation(db, { shopId: shop.id, bookingId, now: pastDeadline }),
    ).toEqual({ status: "forfeit" });
    await turnAway(pastDeadline, "cancelled");
    for (const now of [pastDeadline, insideWindow]) {
      expect(await refundBookingOnCancellation(db, { shopId: shop.id, bookingId, now })).toEqual({
        status: "manual",
        reason: "turned_away",
      });
    }
    expect((await getBookingPayment(db, shop.id, bookingId))?.status).toBe("paid");
  });

  /** dde-1 F2: no "see you tomorrow" about a seat the diver no longer holds. */
  it("gets no reminder", async () => {
    const { db, reef, bookingId, turnAway } = await seat();
    const nightBefore = new Date(reef.startsAt.getTime() - 20 * HOUR_MS);
    const run = async () => {
      const email = fakeEmail();
      await sendDueReminders(db, {
        now: nightBefore,
        emailProvider: email.provider,
        smsProvider: fakeSms().provider,
        appOrigin: "https://diveday.example",
      });
      return email.sent.filter((sent) => "bookingId" in sent && sent.bookingId === bookingId);
    };
    await turnAway(nightBefore);
    expect(await run()).toHaveLength(0);
    expect(
      await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.bookingId, bookingId)),
    ).toEqual([]);
    // The control: put back on the list, the same seat is reminded.
    await db
      .update(bookings)
      .set({ status: "booked", turnedAwayAt: null, turnedAwayReason: null })
      .where(eq(bookings.id, bookingId));
    expect(await run()).toHaveLength(1);
  });

  /**
   * dde-2 #4: erasure takes the category ("medical" is a health fact about
   * the person) and keeps that the desk turned them away, so the released
   * seat never reads "did not arrive" afterwards.
   */
  it("keeps the turn-away through erasure, without its category", async () => {
    const { db, shop, reef, bookingId } = await seat();
    const at = new Date(reef.startsAt.getTime() - HOUR_MS);
    await db
      .update(bookings)
      .set({ status: "no_show", turnedAwayAt: at, turnedAwayReason: "medical" })
      .where(eq(bookings.id, bookingId));
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!owner || !row) throw new Error("fixture missing");
    expect(
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: row.personId,
        actorPersonId: owner.id,
      }),
    ).toMatchObject({ ok: true });
    const [after] = await db
      .select({
        status: bookings.status,
        reason: bookings.turnedAwayReason,
        at: bookings.turnedAwayAt,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(after).toEqual({ status: "no_show", reason: null, at });
  });
});

/**
 * Layer 3 re-review (dde-3 #3): a checkout the diver opened before the desk
 * released the seat must not charge for it afterwards. The release withdraws
 * it, as a move does, so a late completion lands on the Orders index as paid
 * after close for a person to refund, never on the released seat.
 */
describe("a checkout opened before the seat was released", () => {
  async function pendingCheckout() {
    const base = await seat();
    const { db, shop, reef, bookingId } = base;
    await upsertShopStripeAccount(db, shop.id, "acct_released");
    await setShopStripeAccountStatus(db, "acct_released", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    await updateTrip(db, shop.id, reef.id, {
      title: reef.title,
      startsAt: reef.startsAt,
      endsAt: reef.endsAt,
      capacity: reef.capacity,
      plannedDives: reef.plannedDives,
      priceCents: 18_000,
    });
    const started = await startBookingCheckout(
      db,
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingIds: [bookingId],
        customerEmail: "turned-away-money@example.com",
        successUrl: "https://diveday.example/return",
        cancelUrl: "https://diveday.example/cancel",
        describeLine: ({ tripTitle }: { tripTitle: string }) => tripTitle,
      },
      fakeCheckout(),
    );
    if (!started.ok) throw new Error(`checkout start failed: ${started.reason}`);
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seeded staff missing");
    const checkoutRow = async () => {
      const [row] = await db
        .select({
          status: bookingCheckouts.status,
          paidAfterCloseAt: bookingCheckouts.paidAfterCloseAt,
        })
        .from(bookingCheckouts)
        .where(eq(bookingCheckouts.id, started.checkout.id));
      return row;
    };
    return {
      ...base,
      staffId: staff.person.id,
      sessionId: started.checkout.stripeSessionId,
      checkoutRow,
    };
  }

  it("is withdrawn when the desk turns the diver away 30 hours ahead", async () => {
    const { db, shop, reef, bookingId, staffId, sessionId, checkoutRow } = await pendingCheckout();
    const readiness = await getBookingReadiness(db, shop.id, bookingId);
    if (!readiness) throw new Error("readiness missing");
    const [reason] = turnAwayReasons(readiness);
    if (!reason) throw new Error("seat is not blocked");
    expect(
      await turnBookingAway(db, {
        shopId: shop.id,
        bookingId,
        reason,
        recordedByPersonId: staffId,
        now: new Date(reef.startsAt.getTime() - 30 * HOUR_MS),
      }),
    ).toMatchObject({ ok: true });
    expect((await checkoutRow())?.status).toBe("expired");
    // The old tab completes anyway: the money is reported, not booked to the seat.
    expect(await markCheckoutPaidBySessionId(db, sessionId, undefined, 18_000)).toBeNull();
    expect((await checkoutRow())?.paidAfterCloseAt).not.toBeNull();
    expect((await getBookingPayment(db, shop.id, bookingId))?.status ?? "unpaid").toBe("unpaid");
  });

  it("is withdrawn when the desk marks the diver not here", async () => {
    const { db, shop, reef, bookingId, staffId, checkoutRow } = await pendingCheckout();
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId,
        recordedByPersonId: staffId,
        now: new Date(reef.startsAt.getTime() + 10 * 60 * 1000),
      }),
    ).toMatchObject({ ok: true });
    expect((await checkoutRow())?.status).toBe("expired");
  });

  it("is left alone when the desk's tap is refused", async () => {
    const { db, shop, reef, bookingId, staffId, checkoutRow } = await pendingCheckout();
    expect(
      await markBookingNoShow(db, {
        shopId: shop.id,
        bookingId,
        recordedByPersonId: staffId,
        now: new Date(reef.startsAt.getTime() - 60 * 1000),
      }),
    ).toMatchObject({ ok: false, reason: "before_departure" });
    expect((await checkoutRow())?.status).toBe("pending");
  });
});
