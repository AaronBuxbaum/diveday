import type { BadgeTone } from "@/components/ui/badge";
import type { getDiverProfile } from "@/db/divers";
import type { CertificationAgency, PaymentStatus } from "@/db/schema";
import type { getShopById } from "@/db/shops";
import type { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { ORDER_STATUS_KEYS, ORDER_STATUS_TONES } from "@/i18n/order-labels";
import type { StaffMessageKey } from "@/i18n/staff-messages";
import { type CalendarDate, isCalendarDateExpired } from "@/lib/calendar-date";

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

/** The stored card status. Staff either certify a card or delete a bad one; there
 * is no "needs correction" state — a card the desk can't stand behind is removed. */
export type CardStatus = "pending" | "verified";

/**
 * What the badge shows: the stored status, or `expired` when a verified card is
 * past the shop's refresher-due date. Real C-cards do not expire (glossary
 * **C-card**); this date is a shop-set *refresher-due* policy, not a card
 * expiry — so the `expired` display key surfaces to staff as "refresher due".
 * It is a display overlay, not a stored state.
 */
export type CardDisplayStatus = CardStatus | "expired";

/**
 * Staff-facing card labels. A card is "certified" once staff confirm it (they
 * look the number up with the issuing agency and click Mark certified); the
 * stored status is still `verified`, which is what readiness reads. Once a card
 * passes its shop-set refresher-due date it reads as "refresher due" and no
 * longer counts as valid until refreshed (H-08).
 */
export const CARD_STATUS_KEYS: Record<CardDisplayStatus, StaffMessageKey> = {
  pending: "divers.shared.cardStatus.pending",
  verified: "divers.shared.cardStatus.verified",
  expired: "divers.shared.cardStatus.expired",
};

/**
 * A card past its shop-set refresher-due date no longer counts as a valid
 * certification — the same rule the readiness engine applies in
 * `validVerifiedCertification`, compared against the shop's own local calendar
 * date rather than a UTC instant (CR-009, src/lib/calendar-date.ts). The name
 * predates the H-08 refresher-due relabel and still tracks the same
 * `expiresAt` column.
 */
export function isCardExpired(
  card: { expiresAt?: CalendarDate | null },
  todayLocal: CalendarDate,
): boolean {
  return Boolean(card.expiresAt && isCalendarDateExpired(card.expiresAt, todayLocal));
}

/** An expired verified card reads as `expired`; every other state is unchanged. */
export function cardDisplayStatus(
  card: { status: CardStatus; expiresAt?: CalendarDate | null },
  todayLocal: CalendarDate,
): CardDisplayStatus {
  return card.status === "verified" && isCardExpired(card, todayLocal) ? "expired" : card.status;
}

export function statusTone(status: CardDisplayStatus): BadgeTone {
  switch (status) {
    case "verified":
      return "success";
    case "expired":
      return "danger";
    default:
      return "warning";
  }
}

/**
 * Import provenance shared by level, specialty, and nitrox cards
 * (ADR 20260724-import-verified-cards). A card brought in by the contact
 * importer lands `verified` with `importedAt` set and `reviewedAt` still null —
 * DiveDay trusts the card the shop's own system already checked, but keeps it
 * marked imported forever so it is never mistaken for one this shop carded on
 * sight. `needsImportConfirm` is the one-tap-confirm nudge: an imported card no
 * staff member here has confirmed yet. Confirming stamps `reviewedAt` through
 * the normal review path; the imported marker stays.
 */
export type ImportedCard = { importedAt?: Date | string | null; reviewedAt?: Date | string | null };

export function isImportedCard(card: ImportedCard): boolean {
  return Boolean(card.importedAt);
}

export function needsImportConfirm(card: ImportedCard): boolean {
  return Boolean(card.importedAt) && !card.reviewedAt;
}

/**
 * The badge for a card **whose gate is still shut** — an imported specialty card
 * (the dive it authorizes waits) or an imported nitrox card (the fill waits, and
 * gives plain air meanwhile). Neither may read the same as a hand-verified card,
 * which does clear: at a busy desk a green "certified" alone gets a diver told
 * they're fine for the 30 m wall, or gets them handed an EANx tank
 * (ADR 20260725-import-specialty-cards, 20260725-imported-card-sighting).
 *
 * A *level* card is deliberately not in this set: an imported level card is
 * genuinely valid on arrival (20260724-import-verified-cards), so green
 * "certified" is true of it and its confirm is only a nudge.
 */
export type HeldCardDisplayStatus = CardDisplayStatus | "confirm_to_clear";

export const HELD_CARD_STATUS_KEYS: Record<HeldCardDisplayStatus, StaffMessageKey> = {
  ...CARD_STATUS_KEYS,
  confirm_to_clear: "divers.shared.cardStatus.confirmToClear",
};

export function heldCardDisplayStatus(
  card: { status: CardStatus; expiresAt?: CalendarDate | null } & ImportedCard,
  todayLocal: CalendarDate,
): HeldCardDisplayStatus {
  const base = cardDisplayStatus(card, todayLocal);
  return base === "verified" && needsImportConfirm(card) ? "confirm_to_clear" : base;
}

export function heldCardStatusTone(status: HeldCardDisplayStatus): BadgeTone {
  // Warning, not success: the card is on file, and the gate is not open yet.
  return status === "confirm_to_clear" ? "warning" : statusTone(status);
}
