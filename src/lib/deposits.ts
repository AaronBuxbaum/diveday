import { HOUR_MS } from "@/lib/clock";
import { type CoursePricing, perDiverBookingPriceCents } from "./courses";
import {
  isDiver,
  type NonDiverParticipantType,
  offeredParticipantTypes,
  type ParticipantPricing,
  type ParticipantType,
  participantPriceCents,
} from "./participant-types";

/**
 * Deposit and cancellation-policy domain logic, framework-free. The mechanism
 * is opt-in: a trip with no `depositCents` charges the full fare (today's
 * behavior) and a trip with no `cancellationWindowHours` states no window.
 * Refunds stay staff-initiated — nothing here moves money (docs H-20260724-payment-deposit-cancellation-refund).
 */

export type DepositTrip = {
  priceCents: number | null;
  depositCents: number | null;
};

export type CheckoutCharge = {
  /** The per-diver amount to charge now, in minor units. */
  amountCents: number;
  /** True when this is a deposit and a balance is still owed after it clears. */
  isDeposit: boolean;
  /** The remaining per-diver balance after a deposit, or 0 for a full-fare charge. */
  balanceDueCents: number;
};

/**
 * What a pay-at-booking checkout charges one diver, and whether it is a deposit
 * or the full fare. A deposit applies only when it is a positive amount strictly
 * below the full per-diver price; anything else (unset, zero, or ≥ the fare)
 * charges the full price so checkout is never a partial that leaves nothing due
 * or a "deposit" equal to the whole trip. Null means the trip is unpriced and
 * checkout simply does not run — never a $0 charge (mirrors
 * `perDiverBookingPriceCents`).
 */
export function checkoutCharge(
  trip: DepositTrip,
  course: CoursePricing | null,
): CheckoutCharge | null {
  const fullCents = perDiverBookingPriceCents(trip, course);
  if (fullCents === null || fullCents <= 0) return null;

  const deposit = trip.depositCents;
  if (deposit !== null && deposit > 0 && deposit < fullCents) {
    return { amountCents: deposit, isDeposit: true, balanceDueCents: fullCents - deposit };
  }
  return { amountCents: fullCents, isDeposit: false, balanceDueCents: 0 };
}

/**
 * {@link checkoutCharge} for one seat of a given participant type (ADR
 * 20261007-participant-types). A diver's seat is exactly the trip's own charge,
 * course price included. A snorkeler's or a rider's is their own column with
 * the trip's deposit policy applied to it, and never a course price — a
 * non-diver is refused on a course session before it gets here, and if one
 * slipped through it must not be billed a course fee.
 *
 * Null when this departure names no price for the type, or names zero: that
 * seat is not charged at checkout, which is the same "never a $0 charge" rule
 * as the diver's.
 */
export function seatCheckoutCharge(
  trip: DepositTrip & ParticipantPricing,
  course: CoursePricing | null,
  type: ParticipantType,
): CheckoutCharge | null {
  if (isDiver(type)) return checkoutCharge(trip, course);
  return checkoutCharge(
    { priceCents: participantPriceCents(trip, type), depositCents: trip.depositCents },
    null,
  );
}

/**
 * **What the public booking form quotes up front**: the diver seat's deposit
 * (null when the seat pays its whole fare now), and each snorkeler and rider
 * seat this departure sells, at its own price and deposit (ADR
 * 20261007-participant-types). Resolved server-side, so the arithmetic never
 * reaches the browser.
 */
export function checkoutSeatTerms(
  trip: DepositTrip & ParticipantPricing & { courseId?: string | null },
  course: CoursePricing | null,
): {
  depositCents: number | null;
  otherSeatOffers: {
    type: NonDiverParticipantType;
    fareCents: number;
    depositCents: number | null;
  }[];
} {
  const charge = checkoutCharge(trip, course);
  return {
    depositCents: charge?.isDeposit ? charge.amountCents : null,
    otherSeatOffers: offeredParticipantTypes(trip).flatMap((type) => {
      if (isDiver(type)) return [];
      const seat = seatCheckoutCharge(trip, null, type);
      return [
        {
          type: type as NonDiverParticipantType,
          fareCents: participantPriceCents(trip, type) ?? 0,
          depositCents: seat?.isDeposit ? seat.amountCents : null,
        },
      ];
    }),
  };
}

/**
 * **What one seat of this type costs in full**, before any deposit: a diver's
 * seat the trip's (or the course's) per-diver price, exactly as before; a
 * snorkeler's or a rider's its own column, never the diver's fare (ADR
 * 20261007-participant-types). Null when the departure states no price for
 * that seat. The figure `/ready` asks for, balances a deposit against, and
 * gates its Pay step on, so it agrees with what checkout charges
 * (`seatCheckoutCharge`).
 */
export function seatListPriceCents(
  trip: { priceCents: number | null } & ParticipantPricing,
  course: CoursePricing | null,
  type: ParticipantType,
): number | null {
  if (isDiver(type)) return perDiverBookingPriceCents(trip, course);
  return participantPriceCents(trip, type);
}

/**
 * **What one seat's money looks like in its confirmation** (ux review
 * 2026-10-11, item 5): the same three facts the booking form showed above the
 * button, so the email a diver forwards is a receipt in the shop's voice and
 * not only Stripe's. A code and amounts, never words.
 *
 * - `at_shop` — nothing is taken online; the whole seat is owed at the shop.
 * - `online` — the whole seat is charged by card at booking.
 * - `deposit` — a deposit by card at booking, the balance at the dock.
 *
 * Null for an unpriced seat, which has no money story to tell (the form
 * renders nothing for it either). `chargesOnline` is the caller's: whether
 * this booking went to a checkout, which is a fact about the shop's Stripe
 * account and the request, not about the trip.
 */
export type SeatMoneyTerms =
  | { due: "at_shop" | "online"; amountCents: number }
  | { due: "deposit"; depositCents: number; balanceCents: number };

export function seatMoneyTerms(
  trip: DepositTrip & ParticipantPricing,
  course: CoursePricing | null,
  type: ParticipantType,
  chargesOnline: boolean,
): SeatMoneyTerms | null {
  const charge = seatCheckoutCharge(trip, course, type);
  if (!charge) return null;
  const whole = charge.amountCents + charge.balanceDueCents;
  if (!chargesOnline) return { due: "at_shop", amountCents: whole };
  if (charge.isDeposit) {
    return {
      due: "deposit",
      depositCents: charge.amountCents,
      balanceCents: charge.balanceDueCents,
    };
  }
  return { due: "online", amountCents: whole };
}

/**
 * **What a party's lead owes, said once** (fourth UX review, item 5). The
 * form said "$95.00 × 3 divers … Due at the shop $285.00", the lead's email
 * "Your seat: $95.00", and `/ready` nothing, while every unclaimed seat stays
 * with the lead "exactly as booked". So the seats the lead holds are summed
 * into one set of terms, `seats` counting the priced ones: the email and
 * `/ready` both say "3 seats: $285.00, due at the shop".
 *
 * `types` is one entry per seat the lead holds, their own first. An unpriced
 * seat adds nothing and is not counted; null when no seat is priced. Mixed
 * deposit and full-fare seats combine as a deposit: what is taken by card
 * now, and the balance at the dock.
 */
export type PartyMoneyTerms = SeatMoneyTerms & { seats: number };

export function partyMoneyTerms(
  trip: DepositTrip & ParticipantPricing,
  course: CoursePricing | null,
  types: readonly ParticipantType[],
  chargesOnline: boolean,
): PartyMoneyTerms | null {
  const terms = types
    .map((type) => seatMoneyTerms(trip, course, type, chargesOnline))
    .filter((term): term is SeatMoneyTerms => term !== null);
  if (terms.length === 0) return null;
  const seats = terms.length;
  const balanceCents = terms.reduce(
    (sum, term) => sum + (term.due === "deposit" ? term.balanceCents : 0),
    0,
  );
  const nowCents = terms.reduce(
    (sum, term) => sum + (term.due === "deposit" ? term.depositCents : term.amountCents),
    0,
  );
  if (balanceCents > 0) return { due: "deposit", depositCents: nowCents, balanceCents, seats };
  return { due: chargesOnline ? "online" : "at_shop", amountCents: nowCents, seats };
}

export type CancellationTrip = {
  startsAt: Date;
  cancellationWindowHours: number | null;
};

/**
 * The instant free cancellation closes: `cancellationWindowHours` before
 * departure. Null when the shop states no window (nothing to display or check).
 */
export function cancellationDeadline(trip: CancellationTrip): Date | null {
  if (trip.cancellationWindowHours === null || trip.cancellationWindowHours <= 0) return null;
  return new Date(trip.startsAt.getTime() - trip.cancellationWindowHours * HOUR_MS);
}

/**
 * Whether a cancellation right now would still fall inside the free window.
 * A trip with no stated window has nothing to be inside of, so this is false —
 * callers show "no stated policy", not "refund eligible".
 */
export function withinCancellationWindow(trip: CancellationTrip, now: Date): boolean {
  const deadline = cancellationDeadline(trip);
  return deadline !== null && now < deadline;
}

export type RefundDecision = {
  /** Cents to return to the diver now; 0 means nothing is refunded automatically. */
  refundCents: number;
  /**
   * - `refund`: inside a stated window — return what was paid.
   * - `forfeit`: past a stated window's deadline — the seat is non-refundable.
   * - `no_policy`: the trip states no window, so automation stays out of it and
   *   any goodwill refund is a staff decision (pre-automation behavior).
   */
  outcome: "refund" | "forfeit" | "no_policy";
};

/**
 * What an automated cancellation refund returns, framework-free. Automation is
 * gated on the shop having *stated* a cancellation window: with none, this
 * declines to move money (`no_policy`) and refunds stay staff-run exactly as
 * before. Inside the window the full amount paid comes back; past the deadline
 * the seat is forfeit. Never returns more than was paid, and a non-positive
 * `paidCents` always yields a zero refund (docs H-20260724-payment-deposit-cancellation-refund automated-refund slice).
 */
export function refundOnCancellation(
  trip: CancellationTrip,
  paidCents: number,
  now: Date,
): RefundDecision {
  const deadline = cancellationDeadline(trip);
  if (deadline === null) return { refundCents: 0, outcome: "no_policy" };
  if (now >= deadline) return { refundCents: 0, outcome: "forfeit" };
  const refundCents = Math.max(0, Math.trunc(paidCents));
  return { refundCents, outcome: "refund" };
}

/**
 * **What a seat still owes**, from its list price and its one payment row
 * (`booking_payments`). The order page states it under a deposit, which is
 * half a payment and otherwise never says what the other half is (third UX
 * review, item 32).
 *
 * Only two states owe anything: `unpaid` owes the whole seat, and
 * `deposit_paid` owes the seat less what was collected. `paid` and `waived`
 * are settled, and a refunded seat owes nothing back. Null when the seat names
 * no price or nothing is owed, so a caller never prints "$0.00 still owed".
 */
export function seatBalanceOwedCents(
  listPriceCents: number | null,
  payment: { status: string; amountCents: number | null } | null,
): number | null {
  if (listPriceCents === null || listPriceCents <= 0) return null;
  const status = payment?.status ?? "unpaid";
  if (status !== "unpaid" && status !== "deposit_paid") return null;
  const collected = status === "deposit_paid" ? (payment?.amountCents ?? 0) : 0;
  const owed = listPriceCents - collected;
  return owed > 0 ? owed : null;
}
