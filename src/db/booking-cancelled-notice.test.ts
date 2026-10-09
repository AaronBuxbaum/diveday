import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { notificationIdempotencyKey } from "@/lib/notifications/kinds";
import { seededShopContext } from "@/test/db";
import { cancellationMoney, sendBookingCancelledNotice } from "./booking-cancelled-notice";
import { cancelBooking, createBooking } from "./bookings";
import { setBookingPayment } from "./payments";
import { bookings, notificationDeliveries, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ORIGIN = "https://diveday.example";

function capturingProvider(seen: Notification[]): NotificationProvider {
  return {
    async send(notification) {
      seen.push(notification);
      return { status: "sent", providerMessageId: `sent-${seen.length}` };
    },
  };
}

async function canceledBooking(email: string | null = "nora@example.com") {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    ...(email ? { email } : {}),
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  const cancelled = await cancelBooking(db, shop.id, booking.bookingId);
  expect(cancelled?.previousStatus).toBe("booked");
  return { db, shop, trip, bookingId: booking.bookingId };
}

async function deliveryKinds(db: Awaited<ReturnType<typeof canceledBooking>>["db"], id: string) {
  const rows = await db
    .select({ kind: notificationDeliveries.kind, status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.bookingId, id),
        eq(notificationDeliveries.kind, "booking_cancelled"),
      ),
    );
  return rows;
}

describe("sendBookingCancelledNotice", () => {
  it("tells the diver the trip and the refunded amount, and records the delivery", async () => {
    const { db, shop, trip, bookingId } = await canceledBooking();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "refunded",
      amountCents: 9_000,
      currency: "usd",
    });
    const seen: Notification[] = [];

    const outcome = await sendBookingCancelledNotice(
      db,
      {
        shopId: shop.id,
        bookingId,
        cancelledBy: "diver",
        from: "booked",
        refund: { status: "refunded", amountCents: 9_000 },
      },
      { provider: capturingProvider(seen), origin: ORIGIN },
    );

    expect(outcome).toBe("sent");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      kind: "booking_cancelled",
      to: "nora@example.com",
      tripTitle: trip.title,
      cancelledBy: "diver",
      money: { story: "refunded", amountCents: 9_000, currency: "usd" },
    });
    expect(await deliveryKinds(db, bookingId)).toEqual([
      { kind: "booking_cancelled", status: "sent" },
    ]);
  });

  it("writes in the diver's own locale, not the shop's", async () => {
    const { db, shop, bookingId } = await canceledBooking();
    await db
      .update(people)
      .set({ locale: "es-ES" })
      .where(and(eq(people.shopId, shop.id), eq(people.email, "nora@example.com")));
    const seen: Notification[] = [];

    await sendBookingCancelledNotice(
      db,
      {
        shopId: shop.id,
        bookingId,
        cancelledBy: "shop",
        from: "booked",
        refund: { status: "unpaid" },
      },
      { provider: capturingProvider(seen), origin: ORIGIN },
    );

    expect(seen[0]).toMatchObject({ locale: "es-ES", money: { story: "none" } });
  });

  it("sends nothing, and records nothing, for a seat with no address", async () => {
    const { db, shop, bookingId } = await canceledBooking(null);
    const seen: Notification[] = [];

    const outcome = await sendBookingCancelledNotice(
      db,
      {
        shopId: shop.id,
        bookingId,
        cancelledBy: "shop",
        from: "booked",
        refund: { status: "unpaid" },
      },
      { provider: capturingProvider(seen), origin: ORIGIN },
    );

    expect(outcome).toBe("no_address");
    expect(seen).toHaveLength(0);
    expect(await deliveryKinds(db, bookingId)).toEqual([]);
  });

  it("never tells a diver whose booking is not canceled", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("demo trip missing");
    const booking = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Still Coming",
      email: "still@example.com",
    });
    if (!booking.ok) throw new Error(booking.reason);
    const seen: Notification[] = [];

    const outcome = await sendBookingCancelledNotice(
      db,
      {
        shopId: shop.id,
        bookingId: booking.bookingId,
        cancelledBy: "shop",
        from: "booked",
        refund: { status: "unpaid" },
      },
      { provider: capturingProvider(seen), origin: ORIGIN },
    );

    expect(outcome).toBe("not_sent");
    expect(seen).toHaveLength(0);
  });

  it("never reaches across shops", async () => {
    const { db, bookingId } = await canceledBooking();
    const seen: Notification[] = [];

    const outcome = await sendBookingCancelledNotice(
      db,
      {
        shopId: "00000000-0000-4000-8000-000000000000",
        bookingId,
        cancelledBy: "shop",
        from: "booked",
        refund: { status: "unpaid" },
      },
      { provider: capturingProvider(seen), origin: ORIGIN },
    );

    expect(outcome).toBe("not_sent");
    expect(seen).toHaveLength(0);
  });

  it("never mails a seat that was not booked: a checked-in or no-show row taken off the roster", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("demo trip missing");
    const booking = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Already Aboard",
      email: "aboard@example.com",
    });
    if (!booking.ok) throw new Error(booking.reason);
    await db
      .update(bookings)
      .set({ status: "checked_in" })
      .where(eq(bookings.id, booking.bookingId));
    const cancelled = await cancelBooking(db, shop.id, booking.bookingId);
    expect(cancelled?.previousStatus).toBe("checked_in");
    const seen: Notification[] = [];

    const outcome = await sendBookingCancelledNotice(
      db,
      {
        shopId: shop.id,
        bookingId: booking.bookingId,
        cancelledBy: "shop",
        from: "checked_in",
        refund: { status: "unpaid" },
      },
      { provider: capturingProvider(seen), origin: ORIGIN },
    );

    expect(outcome).toBe("not_sent");
    expect(seen).toHaveLength(0);
  });

  it("keys each cancellation apart, so a seat booked again and canceled again is told again", async () => {
    const { db, shop, bookingId } = await canceledBooking();
    const seen: Notification[] = [];
    const send = (now: Date) =>
      sendBookingCancelledNotice(
        db,
        {
          shopId: shop.id,
          bookingId,
          cancelledBy: "shop",
          from: "booked",
          refund: { status: "unpaid" },
        },
        { provider: capturingProvider(seen), origin: ORIGIN, now },
      );
    await send(new Date("2026-10-01T10:00:00Z"));
    await send(new Date("2026-10-03T09:00:00Z"));
    const [first, second] = seen;
    if (!first || !second) throw new Error("two sends expected");
    expect(notificationIdempotencyKey(first)).toMatch(/^booking-cancelled\//);
    expect(notificationIdempotencyKey(first)).not.toBe(notificationIdempotencyKey(second));
  });

  it("records the send as not configured when there is no public origin", async () => {
    const { db, shop, bookingId } = await canceledBooking();
    const seen: Notification[] = [];

    const outcome = await sendBookingCancelledNotice(
      db,
      {
        shopId: shop.id,
        bookingId,
        cancelledBy: "diver",
        from: "booked",
        refund: { status: "unpaid" },
      },
      { provider: capturingProvider(seen), origin: null },
    );

    expect(outcome).toBe("not_sent");
    expect(seen).toHaveLength(0);
    expect(await deliveryKinds(db, bookingId)).toEqual([
      { kind: "booking_cancelled", status: "not_configured" },
    ]);
  });
});

describe("cancellationMoney", () => {
  const paid = { status: "paid" as const, currency: "usd" };

  it("names only the amount Stripe actually reversed", () => {
    expect(cancellationMoney({ status: "refunded", amountCents: 4_200 }, paid)).toEqual({
      story: "refunded",
      amountCents: 4_200,
      currency: "usd",
    });
  });

  it("reads the shop's policy for a seat past its window", () => {
    expect(cancellationMoney({ status: "forfeit" }, paid)).toEqual({ story: "forfeit" });
  });

  it("hands every unsettled outcome to the shop", () => {
    for (const refund of [
      { status: "no_policy" },
      { status: "manual", reason: "not_stripe" },
      { status: "in_progress" },
      { status: "needs_reconciliation" },
      { status: "failed" },
    ] as const) {
      expect(cancellationMoney(refund, paid)).toEqual({ story: "shop_will_follow_up" });
    }
  });

  it("says nothing about money when nothing was captured", () => {
    expect(cancellationMoney({ status: "unpaid" }, paid)).toEqual({ story: "none" });
    expect(cancellationMoney({ status: "not_attempted" }, null)).toEqual({ story: "none" });
    expect(
      cancellationMoney({ status: "not_attempted" }, { status: "unpaid", currency: "usd" }),
    ).toEqual({ story: "none" });
  });

  it("hands a captured seat nobody refunded to the shop", () => {
    expect(cancellationMoney({ status: "not_attempted" }, paid)).toEqual({
      story: "shop_will_follow_up",
    });
  });
});
