import type { getDiverProfile } from "@/db/divers";
import type { DiveSpecialty } from "@/db/schema";
import { needsImportConfirm } from "@/lib/certification-cards";

/**
 * **The diver record's own arithmetic** — the facts the record's status ledger
 * (`src/lib/diver-status.ts`) and its groups both read off one `getDiverProfile`
 * row, so the summary at the top and the rows below can never disagree.
 * Codes and counts only; the record's components choose the words.
 */
export type DiverProfile = NonNullable<Awaited<ReturnType<typeof getDiverProfile>>>;

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
/** A kind of card a ledger row can be about: the level ladder, one specialty, or nitrox. */
export type CardAwaitingKind = "level" | "nitrox" | DiveSpecialty;

/**
 * The fragment on the first card of this kind waiting for somebody. Written
 * by the certifications group, read by the status ledger's "Verify it", so
 * the two cannot spell it differently.
 */
export function cardAwaitingAnchor(kind: CardAwaitingKind): string {
  return `card-awaiting-${kind}`;
}

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
