import { HOUR_MS } from "../../lib/clock";
import { rungTime } from "../../lib/departure-clock";

/**
 * When the automatic recap goes out. Its delay is the departure clock's
 * `recap_due` rung (four hours past the scheduled return, `recapIsDue` in
 * `src/lib/departure-clock.ts`); what lives here is the per-trip override a
 * staffer's unpause writes. Staff can send the recap by hand at any time on an
 * ended trip.
 */

/**
 * When unpausing automatic sending, delay sending until at least 1 hour from unpause
 * (or the original scheduled time, whichever is later). Measured from the click,
 * not from the departure, so it is not a rung.
 */
export const RECAP_UNPAUSE_DELAY_HOURS = 1;
export const RECAP_UNPAUSE_DELAY_MS = RECAP_UNPAUSE_DELAY_HOURS * HOUR_MS;

/**
 * Calculates the target automatic recap delivery timestamp:
 * - If a custom `autoSendAt` was set (e.g. via unpause), returns that.
 * - Otherwise, the `recap_due` rung if a scheduled return time exists.
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
 * later of (the `recap_due` rung, 1 hour after the click to unpause).
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
