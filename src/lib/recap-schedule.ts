import { HOUR_MS } from "./clock";
import { hasPassed, rungOffsetMs, rungTime } from "./departure-clock";

/**
 * Automatic recap delivery delay: 4 hours after the boat is scheduled to return.
 * Staff can manually send the recap at any time on an ended trip.
 */
export const RECAP_AUTOMATIC_DELAY_MS = rungOffsetMs("recap_due");
export const RECAP_AUTOMATIC_DELAY_HOURS = RECAP_AUTOMATIC_DELAY_MS / HOUR_MS;

/**
 * When unpausing automatic sending, delay sending until at least 1 hour from unpause
 * (or the original 4-hour scheduled return time, whichever is later).
 */
export const RECAP_UNPAUSE_DELAY_HOURS = 1;
export const RECAP_UNPAUSE_DELAY_MS = RECAP_UNPAUSE_DELAY_HOURS * HOUR_MS;

/**
 * Calculates the target automatic recap delivery timestamp:
 * - If a custom `autoSendAt` was set (e.g. via unpause), returns that.
 * - Otherwise, returns 4 hours after `endsAt` if a scheduled return time exists.
 * - If there is no scheduled return time (`endsAt` is null), automatic sending is disabled (returns null).
 */
export function recapAutoSendAt(
  endsAt: Date | null | undefined,
  autoSendAt?: Date | null,
): Date | null {
  if (autoSendAt) return autoSendAt;
  if (!endsAt) return null;
  return rungTime("recap_due", { endsAt });
}

/**
 * Computes the new auto-send time when staff unpauses automatic recap sending:
 * later of (the original sending time `endsAt + 4h`, 1 hour after the click to unpause).
 * If `endsAt` is null, returns null.
 */
export function unpauseRecapAutoSendAt(
  endsAt: Date | null | undefined,
  unpausedAt: Date,
): Date | null {
  if (!endsAt) return null;
  const originalSendAt = rungTime("recap_due", { endsAt }).getTime();
  const unpauseSendAt = unpausedAt.getTime() + RECAP_UNPAUSE_DELAY_MS;
  return new Date(Math.max(originalSendAt, unpauseSendAt));
}

/**
 * **Is the automatic recap due?** Strictly past the scheduled return plus the
 * recap's delay (the `settled` rung of the departure's clock). Staff may send
 * one by hand before this.
 */
export function recapIsDue(endsAt: Date, now: Date): boolean {
  return hasPassed("recap_due", { endsAt }, now);
}
