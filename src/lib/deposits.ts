import { type CoursePricing, perDiverBookingPriceCents } from "./courses";

/**
 * Deposit and cancellation-policy domain logic, framework-free. The mechanism
 * is opt-in: a trip with no `depositCents` charges the full fare (today's
 * behavior) and a trip with no `cancellationWindowHours` states no window.
 * Refunds stay staff-initiated — nothing here moves money (docs H-07).
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
  return new Date(trip.startsAt.getTime() - trip.cancellationWindowHours * 60 * 60 * 1000);
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
 * `paidCents` always yields a zero refund (docs H-07 automated-refund slice).
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
