import { HOUR_MS } from "./clock";

/**
 * Automatic recap delivery delay: 4 hours after the boat is scheduled to return.
 * Staff can manually send the recap at any time on an ended trip.
 */
export const RECAP_AUTOMATIC_DELAY_HOURS = 4;
export const RECAP_AUTOMATIC_DELAY_MS = RECAP_AUTOMATIC_DELAY_HOURS * HOUR_MS;

/**
 * When unpausing automatic sending, delay sending until at least 1 hour from unpause
 * (or the original 4-hour scheduled return time, whichever is later).
 */
export const RECAP_UNPAUSE_DELAY_HOURS = 1;
export const RECAP_UNPAUSE_DELAY_MS = RECAP_UNPAUSE_DELAY_HOURS * HOUR_MS;

/** Dedicated hourly pass — scans for departures due for automatic recap delivery. */
export const RECAP_CRON_CRONTAB = "0 * * * *";

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
  return new Date(endsAt.getTime() + RECAP_AUTOMATIC_DELAY_MS);
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
  const originalSendAt = endsAt.getTime() + RECAP_AUTOMATIC_DELAY_MS;
  const unpauseSendAt = unpausedAt.getTime() + RECAP_UNPAUSE_DELAY_MS;
  return new Date(Math.max(originalSendAt, unpauseSendAt));
}

/**
 * Determines whether automatic recap sending is due for a departure:
 * - false if paused
 * - false if no scheduled return time (`endsAt` is null)
 * - true if `now` >= `recapAutoSendAt(endsAt, autoSendAt)`
 */
export function recapAutoSendIsDue({
  endsAt,
  autoSendAt,
  paused = false,
  now,
}: {
  endsAt: Date | null | undefined;
  autoSendAt?: Date | null;
  paused?: boolean;
  now: Date;
}): boolean {
  if (paused) return false;
  const target = recapAutoSendAt(endsAt, autoSendAt);
  if (!target) return false;
  return now.getTime() >= target.getTime();
}
