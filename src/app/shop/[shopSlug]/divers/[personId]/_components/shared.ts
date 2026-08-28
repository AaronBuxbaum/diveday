import type { BadgeTone } from "@/components/ui/badge";
import type { getDiverProfile } from "@/db/divers";
import type { CertificationAgency, PaymentStatus } from "@/db/schema";
import type { getShopById } from "@/db/shops";
import type { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import { needsImportConfirm } from "@/lib/certification-cards";

export type DiverProfile = NonNullable<Awaited<ReturnType<typeof getDiverProfile>>>;
export type Shop = NonNullable<Awaited<ReturnType<typeof getShopById>>>;
export type UpcomingTrip = Awaited<
  ReturnType<typeof pagedUpcomingTripsWithCounts>
>["trips"][number];

/**
 * Every value resolves to a `StaffMessageKey` now, not a rendered word — see
 * `divers.shared.*`.
 *
 * Keyed by the pg enum (`CertificationAgency`), so an agency added to the
 * column is a compile error here until it has words in every locale — which is
 * the only thing standing between "the database accepts CMAS" and a picker that
 * still cannot offer it (DOM-L1). Declaration order is the order the cert forms
 * render the `<select>` in, which is why `other` is last.
 */
export const AGENCY_KEYS: Record<CertificationAgency, StaffMessageKey> = {
  padi: "divers.shared.agencies.padi",
  ssi: "divers.shared.agencies.ssi",
  naui: "divers.shared.agencies.naui",
  sdi: "divers.shared.agencies.sdi",
  tdi: "divers.shared.agencies.tdi",
  cmas: "divers.shared.agencies.cmas",
  raid: "divers.shared.agencies.raid",
  gue: "divers.shared.agencies.gue",
  bsac: "divers.shared.agencies.bsac",
  other: "divers.shared.agencies.other",
};

export const PAYMENT_STATUS_KEYS: Record<PaymentStatus, StaffMessageKey> = {
  unpaid: "divers.shared.paymentStatus.unpaid",
  deposit_paid: "divers.shared.paymentStatus.depositPaid",
  paid: "divers.shared.paymentStatus.paid",
  waived: "divers.shared.paymentStatus.waived",
  partly_refunded: "divers.shared.paymentStatus.partlyRefunded",
  refunded: "divers.shared.paymentStatus.refunded",
};

/**
 * The booking-payment half of the same question `ORDER_STATUS_TONES` answers
 * (`src/i18n/order-labels.ts`) — a booking with no order still shows a money
 * word on its row, and it has to agree with the order vocabulary rather than
 * quietly meaning something else in the same colour.
 *
 * `refunded` is `warning` here for exactly the reason it is there: one refund
 * may not read as two different facts because two different tables recorded
 * it. `unpaid` is the shop's chase list, so it earns the same caution;
 * `deposit_paid` is money genuinely in flight, like an `open` order; `waived`
 * is neutral rather than green, because nothing was collected — calling a
 * written-off seat a success is the one reading of that word a shop's books
 * cannot afford.
 */
export const PAYMENT_STATUS_TONES: Record<PaymentStatus, BadgeTone> = {
  unpaid: "warning",
  deposit_paid: "primary",
  paid: "success",
  waived: "neutral",
  // Warning, like `refunded` and like the order half of the same question:
  // money went back out, and how much is left does not change what a staffer
  // reconciling the day needs to notice (issue #699).
  partly_refunded: "warning",
  refunded: "warning",
};

/**
 * What one booking owes and what has been raised against it.
 *
 * Upcoming and Past both show a booking's money state on the row, so they read
 * it from here rather than each reaching into `diver.orders` and
 * `diver.bookingPayments` their own way — which is how the two lists would
 * drift into disagreeing about the same seat.
 */
export function bookingMoney(diver: DiverProfile, bookingId: string) {
  return {
    order: diver.orders.find((row) => row.order.bookingId === bookingId) ?? null,
    payment: diver.bookingPayments.find((row) => row.booking.id === bookingId) ?? null,
  };
}

/**
 * The one status word a booking's money wears: the order's if an order exists
 * (it is the billing record of record), otherwise the booking's own payment
 * status, otherwise nothing has been raised at all.
 */
export function bookingMoneyStatusKey(
  money: ReturnType<typeof bookingMoney>,
): StaffMessageKey | null {
  if (money.order) return ORDER_STATUS_KEYS[money.order.order.status] ?? null;
  if (money.payment) return PAYMENT_STATUS_KEYS[money.payment.payment.status] ?? null;
  return null;
}

/**
 * The tone that word wears — read from the same row, in the same order, so the
 * badge on a booking can never be coloured by one record and labelled by the
 * other. `neutral` when nothing has been raised at all: "No order" is the
 * absence of a fact, not a bad one (see `unpaidBookingCount` — nothing is owed
 * until something is raised).
 */
export function bookingMoneyStatusTone(money: ReturnType<typeof bookingMoney>): BadgeTone {
  if (money.order) return ORDER_STATUS_TONES[money.order.order.status] ?? "neutral";
  if (money.payment) return PAYMENT_STATUS_TONES[money.payment.payment.status] ?? "neutral";
  return "neutral";
}

/**
 * **Seats with money still owed.**
 *
 * A booking counts when something has been raised against it and is not
 * settled: an order still `open`, or — with no order — a booking payment row
 * still sitting at `unpaid`. A seat nobody has billed at all is deliberately
 * not counted: nothing is owed until something is raised, and calling an
 * un-invoiced booking "unpaid" would put a permanent red mark on every shop
 * that settles at the counter. Same `bookingMoney` reading the rows themselves
 * use, so the summary at the top and the rows below can never disagree.
 *
 * Cancelled seats are excluded — a refund or a void is a different fact, and
 * neither is somebody standing at the counter owing money.
 */
export function unpaidBookingCount(diver: DiverProfile): number {
  return diver.bookings.filter(({ booking }) => {
    if (booking.status === "cancelled") return false;
    const money = bookingMoney(diver, booking.id);
    if (money.order) return money.order.order.status === "open";
    return money.payment?.payment.status === "unpaid";
  }).length;
}

/**
 * **The order the record's "Collect" fix opens** — the oldest open invoice
 * raised against one of this diver's live seats, or nothing when the money
 * outstanding was never invoiced at all (a counter seat still sitting at
 * `unpaid`). Read off the same rows {@link unpaidBookingCount} counts, so the
 * status ledger's row and its link can never disagree about which seat it
 * means.
 */
export function firstOpenOrderId(diver: DiverProfile): string | undefined {
  for (const { booking } of diver.bookings) {
    if (booking.status === "cancelled") continue;
    const order = bookingMoney(diver, booking.id).order;
    if (order?.order.status === "open") return order.order.id;
  }
  return undefined;
}

/**
 * Certification cards a staffer still has to act on, counted the same way the
 * roster's "Needs attention" view and the Cards stat card both mean it: a card
 * awaiting review, plus an imported specialty or nitrox card whose gate stays
 * shut until somebody attests they have seen it (H-24). An imported *level*
 * card is not counted — it cleared readiness on arrival, so its confirm is a
 * nudge on the card itself, not an open job.
 */
export function cardsNeedingLookCount(diver: DiverProfile): number {
  return (
    diver.certifications.filter((card) => card.status === "pending").length +
    diver.specialtyCertifications.filter(
      (card) => card.status === "pending" || needsImportConfirm(card),
    ).length +
    diver.nitroxCertifications.filter(
      (card) => card.status === "pending" || needsImportConfirm(card),
    ).length
  );
}
