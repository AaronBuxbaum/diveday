import { HOUR_MS } from "./clock";

/**
 * A recap is a post-dive follow-up, never something that arrives while the
 * diver is still changing out of their gear. The same delay governs the
 * automatic run and the staff "send now" control, so a button cannot bypass
 * the promise the schedule makes.
 */
export const RECAP_MINIMUM_DELAY_HOURS = 4;
export const RECAP_MINIMUM_DELAY_MS = RECAP_MINIMUM_DELAY_HOURS * HOUR_MS;
/** Dedicated hourly pass — keeps the post-dive timing within one hour of its floor. */
export const RECAP_CRON_CRONTAB = "0 * * * *";

/** The first instant at which this departure's recap may be delivered. */
export function recapEligibleAt(endsAt: Date): Date {
  return new Date(endsAt.getTime() + RECAP_MINIMUM_DELAY_MS);
}

/** Inclusive: a recap ending exactly four hours ago is eligible. */
export function recapIsEligible(endsAt: Date, now: Date): boolean {
  return now.getTime() >= recapEligibleAt(endsAt).getTime();
}
