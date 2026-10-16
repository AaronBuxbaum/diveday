import { and, eq, inArray } from "drizzle-orm";
import { log } from "@/lib/log";
import { type NotificationProvider, recipientLocale } from "@/lib/notifications";
import { settledPartyPayment } from "./checkouts";
import type { AppDb } from "./client";
import { sendNotification } from "./notifications";
import {
  type BookingCheckout,
  bookingCheckoutBookings,
  bookings,
  people,
  shops,
  trips,
} from "./schema";

/**
 * **A group's card checkout, told to the lead once Stripe says it is paid**
 * (#2566, Aaron's option A). The booking confirmation goes out at booking time,
 * before Stripe reports the payment, so it cannot name the total; this is the
 * one short receipt that does.
 *
 * Called by the Stripe webhook only on the call that completed the checkout
 * (`markCheckoutPaidBySessionId`'s `firstCompletion`), so a replayed or
 * redelivered event sends nothing; the notification's own key is per checkout
 * as well. The figure is what `settledPartyPayment` reads, Stripe's reported
 * total, and it must equal the checkout's own settled total: if the two ever
 * disagree, or Stripe reported no total, nothing is sent. Nothing is computed
 * from the asked price.
 *
 * Group checkouts only (a lead plus at least one covered seat), and not a
 * deposit, which is not "what the seats cost". A single seat's card checkout
 * already gets Stripe's own receipt. Best-effort and never thrown at the
 * webhook: the money is recorded either way. Codes, never sentences.
 */
export type PartyPaymentReceiptOutcome =
  | "sent"
  | "not_sent"
  | "not_a_group"
  | "no_settled_total"
  | "no_address";

export async function sendPartyPaymentReceipt(
  db: AppDb,
  checkout: Pick<BookingCheckout, "id" | "shopId" | "isDeposit" | "settledTotalCents">,
  options: { provider?: NotificationProvider } = {},
): Promise<PartyPaymentReceiptOutcome> {
  try {
    return await send(db, checkout, options);
  } catch (error) {
    log("party_payment_receipt.failed", "error", {
      checkoutId: checkout.id,
      shopId: checkout.shopId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return "not_sent";
  }
}

async function send(
  db: AppDb,
  checkout: Pick<BookingCheckout, "id" | "shopId" | "isDeposit" | "settledTotalCents">,
  options: { provider?: NotificationProvider },
): Promise<PartyPaymentReceiptOutcome> {
  if (checkout.isDeposit) return "not_a_group";
  if (!checkout.settledTotalCents) return "no_settled_total";
  const covered = await db
    .select({ bookingId: bookingCheckoutBookings.bookingId })
    .from(bookingCheckoutBookings)
    .where(
      and(
        eq(bookingCheckoutBookings.checkoutId, checkout.id),
        eq(bookingCheckoutBookings.shopId, checkout.shopId),
      ),
    );
  if (covered.length < 2) return "not_a_group";
  const seats = await db
    .select({ id: bookings.id, partyLeadBookingId: bookings.partyLeadBookingId })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, checkout.shopId),
        inArray(
          bookings.id,
          covered.map((row) => row.bookingId),
        ),
      ),
    );
  const leads = seats.filter((seat) => seat.partyLeadBookingId === null);
  const lead = leads.length === 1 ? leads[0] : undefined;
  if (!lead) return "not_a_group";

  const paid = await settledPartyPayment(db, checkout.shopId, lead.id);
  if (!paid || paid.amountCents !== checkout.settledTotalCents) return "no_settled_total";

  const [row] = await db
    .select({ booking: bookings, person: people, trip: trips, shop: shops })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(and(eq(bookings.id, lead.id), eq(bookings.shopId, checkout.shopId)))
    .limit(1);
  if (!row || row.booking.status === "cancelled") return "not_sent";
  if (!row.person.email) return "no_address";

  const delivery = await sendNotification(
    db,
    {
      kind: "party_payment_receipt",
      checkoutId: checkout.id,
      shopId: checkout.shopId,
      to: row.person.email,
      locale: recipientLocale(row.person.locale, row.shop.defaultLocale),
      diverName: row.person.fullName,
      shopName: row.shop.name,
      tripTitle: row.trip.title,
      startsAt: row.trip.startsAt,
      timezone: row.shop.timezone,
      seats: paid.seats,
      amountCents: paid.amountCents,
      currency: paid.currency,
    },
    options.provider,
  );
  return delivery.status === "sent" ? "sent" : "not_sent";
}
