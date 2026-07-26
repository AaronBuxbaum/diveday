/**
 * Abandoned-checkout recovery, framework-free. A checkout is worth a nudge
 * once it's been pending long enough that the diver plausibly walked away,
 * but only while the Stripe session itself could still be completed — the DB
 * layer (`src/db/checkout-recovery.ts`) reconciles with Stripe before trusting
 * a stale `pending` row (a webhook can legitimately lag a real payment) and
 * does the sending/dedup (docs ADR 20260726-abandoned-checkout-recovery).
 */

/** How long a checkout sits unpaid before it's worth a recovery nudge. */
export const RECOVERY_DELAY_HOURS = 2;
const HOUR_MS = 60 * 60 * 1000;

export type RecoveryCheckout = {
  status: "pending" | "completed" | "expired";
  createdAt: Date;
  expiresAt: Date | null;
  customerEmail: string | null;
  abandonedRecoverySentAt: Date | null;
};

/**
 * Whether a checkout is due a recovery email right now. Requires: still
 * `pending` (paid/expired checkouts are never nudged), old enough
 * (`RECOVERY_DELAY_HOURS`), not already sent, a Stripe session that hasn't
 * itself expired (a dead link helps no one), and a known recipient.
 */
export function dueCheckoutRecovery(checkout: RecoveryCheckout, now: Date): boolean {
  if (checkout.status !== "pending") return false;
  if (checkout.abandonedRecoverySentAt !== null) return false;
  if (!checkout.customerEmail) return false;
  if (checkout.expiresAt !== null && checkout.expiresAt <= now) return false;
  const dueAt = new Date(checkout.createdAt.getTime() + RECOVERY_DELAY_HOURS * HOUR_MS);
  return now >= dueAt;
}
