import { and, eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import {
  type NotificationProvider,
  notificationProviderSignal,
  publicAppUrl,
} from "@/lib/notifications";
import { type Notification, recipientLocale } from "@/lib/notifications/kinds";
import { isCapturedPaymentStatus, type PaymentStatusValue } from "@/lib/payment-source";
import { publicSchedulePath } from "@/lib/public-routes";
import type { AppDb } from "./client";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import { recordNotificationDelivery, sendAndRecordNotification } from "./notifications";
import { getBookingPayment } from "./payments";
import type { CancellationRefundOutcome } from "./refunds";
import type { Booking } from "./schema";
import { bookings, people, shops, trips } from "./schema";

type CancellationMoney = Extract<Notification, { kind: "booking_cancelled" }>["money"];

/**
 * What the refund step did, as the caller saw it. `not_attempted` is a staff
 * member without refund permission (H-14), or a refund step that threw: the
 * seat is canceled and the money question is still open.
 */
export type CancellationRefundSeen = CancellationRefundOutcome | { status: "not_attempted" };

/**
 * **The money sentence's code, from the refund step's outcome.** A table of
 * cases rather than a default arm, so a new refund outcome is a compile error
 * here instead of a diver told nothing about a charge.
 *
 * Only `refunded` names an amount, and it is the amount Stripe actually
 * reversed. Every outcome where money was captured and not settled here reads
 * "the shop will be in touch": it is true whichever of them it was, and the
 * diver has nothing to do in any of them.
 */
export function cancellationMoney(
  refund: CancellationRefundSeen,
  payment: { status: PaymentStatusValue; currency: string } | null,
): CancellationMoney {
  switch (refund.status) {
    case "refunded":
      return payment
        ? { story: "refunded", amountCents: refund.amountCents, currency: payment.currency }
        : { story: "shop_will_follow_up" };
    case "forfeit":
      return { story: "forfeit" };
    case "unpaid":
      return { story: "none" };
    case "no_policy":
    case "manual":
    case "in_progress":
    case "needs_reconciliation":
    case "failed":
      return { story: "shop_will_follow_up" };
    case "not_attempted":
      return payment && isCapturedPaymentStatus(payment.status)
        ? { story: "shop_will_follow_up" }
        : { story: "none" };
  }
}

/**
 * **Tell the diver their booking is canceled, and what happened to the money.**
 *
 * Called after the cancellation and its refund step, by the diver's own
 * trip-prep link, by a reply's confirm code (src/db/reply-keywords.ts), and by
 * the roster's Remove. Never by the blow-out or the
 * minimum-head-count sweep, which cancel the whole departure and carry their
 * own message.
 *
 * Transactional, so it goes whatever the diver's choice about optional email:
 * it answers something done to their booking. It is sent only to the address
 * on the diver's own record, in their own locale. A seat with no address (a
 * walk-in seated on a name) gets nothing, and nothing is recorded, because
 * there is no one the shop failed to tell.
 *
 * Never throws: the seat is already released, and a mail failure must not turn
 * a done cancellation into an error page. The delivery row says what happened.
 */
export async function sendBookingCancelledNotice(
  db: AppDb,
  input: BookingCancelledNoticeInput,
  options: BookingCancelledNoticeOptions = {},
): Promise<"sent" | "not_sent" | "no_address"> {
  try {
    return await sendNotice(db, input, options);
  } catch (error) {
    log("booking_cancelled_notice.failed", "error", {
      bookingId: input.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return "not_sent";
  }
}

type BookingCancelledNoticeInput = {
  shopId: string;
  bookingId: string;
  cancelledBy: "diver" | "shop";
  /**
   * The seat's status just before the cancel (`cancelBooking`'s
   * `previousStatus`). Only `booked` is a diver who expected to come: a
   * checked-in or no-show row taken off the roster, or one already canceled,
   * is roster tidying the diver is not told about.
   */
  from: Booking["status"];
  refund: CancellationRefundSeen;
  /** A lead's cancel: the party seats that went with it and the ones that stayed. */
  party?: { cancelled: number; stayed: number };
};

type BookingCancelledNoticeOptions = {
  provider?: NotificationProvider;
  origin?: string | null;
  /** The moment of the cancel; injectable for tests, defaults to now. */
  now?: Date;
};

async function sendNotice(
  db: AppDb,
  input: BookingCancelledNoticeInput,
  options: BookingCancelledNoticeOptions,
): Promise<"sent" | "not_sent" | "no_address"> {
  if (input.from !== "booked") return "not_sent";
  const [observed] = await db
    .select({ booking: bookings, person: people, trip: trips, shop: shops })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!observed) return "not_sent";
  if (!observed.person.email) return "no_address";

  const fenced = await withErasureCoordinatedBookingSend(
    db,
    {
      shopId: input.shopId,
      bookingId: input.bookingId,
      expectedPersonId: observed.person.id,
      expectedTripId: observed.trip.id,
      expectedEmail: observed.person.email,
      allowCancelled: true,
    },
    async (tx) => {
      const [row] = await tx
        .select({ booking: bookings, person: people, trip: trips, shop: shops })
        .from(bookings)
        .innerJoin(
          people,
          and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)),
        )
        .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
        .innerJoin(shops, eq(shops.id, bookings.shopId))
        .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
        .limit(1);
      if (row?.booking.status !== "cancelled") return "not_sent" as const;
      if (!row.person.email) return "no_address" as const;
      const origin = options.origin === undefined ? publicAppUrl() : options.origin;
      if (!origin) {
        await recordNotificationDelivery(tx, {
          shopId: input.shopId,
          bookingId: input.bookingId,
          kind: "booking_cancelled",
          delivery: { status: "not_configured" },
        });
        return "not_sent" as const;
      }
      const payment = await getBookingPayment(tx, input.shopId, input.bookingId);
      const delivery = await sendAndRecordNotification(
        tx,
        {
          kind: "booking_cancelled",
          bookingId: input.bookingId,
          shopId: input.shopId,
          to: row.person.email,
          locale: recipientLocale(row.person.locale, row.shop.defaultLocale),
          diverName: row.person.fullName,
          shopName: row.shop.name,
          tripTitle: row.trip.title,
          startsAt: row.trip.startsAt,
          timezone: row.shop.timezone,
          cancelledBy: input.cancelledBy,
          cancelledAt: options.now ?? nowDate(),
          money: cancellationMoney(input.refund, payment ?? null),
          ...(input.party ? { party: input.party } : {}),
          scheduleUrl: new URL(publicSchedulePath(row.shop.slug), `${origin}/`).toString(),
        },
        { provider: options.provider, signal: notificationProviderSignal() },
      );
      return delivery.status === "sent" ? "sent" : "not_sent";
    },
  );
  return fenced ?? "not_sent";
}
