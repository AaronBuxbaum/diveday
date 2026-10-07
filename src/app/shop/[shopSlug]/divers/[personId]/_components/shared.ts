import type { BadgeTone } from "@/components/ui/badge";
import type { CertificationAgency, PaymentStatus } from "@/db/schema";
import type { getShopById } from "@/db/shops";
import type { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import {
  bookingMoney,
  type CardAwaitingKind,
  cardAwaitingAnchor,
  cardsNeedingLookCount,
  type DiverProfile,
  firstOpenOrderId,
  unpaidBookingCount,
} from "@/lib/diver-profile";

export type { CardAwaitingKind, DiverProfile };
export {
  bookingMoney,
  cardAwaitingAnchor,
  cardsNeedingLookCount,
  firstOpenOrderId,
  unpaidBookingCount,
};

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
  nss_cds: "divers.shared.agencies.nss_cds",
  nacd: "divers.shared.agencies.nacd",
  iantd: "divers.shared.agencies.iantd",
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
