import { HOUR_MS } from "./clock";
import { capturedPaymentStatuses } from "./payment-source";

/** A requested deadline never extends beyond one day or the departure itself. */
export function groupHoldDeadline(now: Date, startsAt: Date, requested?: Date): Date | null {
  const deadline = Math.min(
    now.getTime() + 24 * HOUR_MS,
    startsAt.getTime(),
    requested?.getTime() ?? Infinity,
  );
  return Number.isFinite(deadline) && deadline > now.getTime() ? new Date(deadline) : null;
}

export function groupSeatSettled(status: string | null | undefined): boolean {
  return capturedPaymentStatuses.some((captured) => captured === status) || status === "waived";
}

/** Undefined: ordinary checkout; null: Stripe's minimum would outlive the hold. */
export function groupHoldCheckoutDeadline(
  deadlines: readonly (Date | null)[],
  now: Date,
): Date | null | undefined {
  const held = deadlines.flatMap((deadline) => (deadline ? [deadline.getTime()] : []));
  if (!held.length) return undefined;
  const deadline = Math.min(...held);
  return deadline - now.getTime() >= 31 * 60 * 1000 ? new Date(deadline) : null;
}
