/**
 * The platform's scheduling grain, in one place.
 *
 * Most durable retries are drained by the daily `/api/cron/reminders` entry at
 * `0 14 * * *` (vercel.json). That makes the cron cadence — not the backoff
 * arithmetic a queue happens to write into a `next_attempt_at` column — the
 * real floor on how soon those messages can be tried again. Post-dive recaps
 * are the intentional exception: their own hourly pass is what makes the
 * close-out's four-hour promise useful instead of a vague next-day follow-up.
 *
 * This module exists because that floor was invisible at the only place it
 * mattered. `src/db/notifications.ts` computed a 30s → 1h exponential ladder
 * that reads like a system retrying within the hour; under a once-a-day drain
 * every rung of it collapses to "tomorrow at 14:00 UTC", so the first retry of
 * a failed waiver email is ~24h out and the eighth is ~8 days out (OPS-6).
 * Neither figure appeared anywhere in the code or the runbooks.
 *
 * The generic queue's schedule stays daily. What changes is that the arithmetic
 * says what actually happens, and every consumer derives its bounds from this
 * constant instead of restating a cadence it cannot deliver. Recap delivery has
 * a separate, explicitly tested hourly exception in `recap-schedule.ts`.
 */

/** UTC hour of the daily `/api/cron/reminders` tick. Mirrors vercel.json. */
export const DAILY_TICK_UTC_HOUR = 14;

/** UTC minute of the daily tick. Mirrors vercel.json. */
export const DAILY_TICK_UTC_MINUTE = 0;

/**
 * The daily tick as a crontab expression, for the places that must hand the
 * schedule to something else verbatim — Sentry's Cron Monitor, which uses it
 * to decide when a check-in is *missing* and is therefore the dead-man's
 * switch on this whole cadence.
 *
 * `src/lib/cron-schedule.test.ts` asserts this equals vercel.json's entry, so
 * the "must stay in lockstep with vercel.json" instruction that was previously
 * only a comment is now a failing test if the two drift.
 */
export const DAILY_TICK_CRONTAB = `${DAILY_TICK_UTC_MINUTE} ${DAILY_TICK_UTC_HOUR} * * *`;

/** Milliseconds between two consecutive daily ticks. */
export const DAILY_TICK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * The first moment the daily drain runs at or after `instant`.
 *
 * This is the honest form of "retry in N milliseconds": a queue row can name
 * any `next_attempt_at` it likes, but nothing reads that column until the next
 * tick, so the effective due time is always this. Rounding forward explicitly
 * also removes a latent full-day slip — a delay that lands a few minutes
 * *past* today's 14:00 (a failure at 13:59 asking for an hour) previously
 * became eligible at 14:59, missed the pass that had just run, and waited
 * until 14:00 the following day. Snapping to the boundary makes "one pass
 * later" mean one pass, not sometimes two.
 *
 * Pure and instant-based: no host-zone reading, no wall-clock assumptions
 * beyond the UTC the cron itself is expressed in.
 */
export function nextDailyTickAtOrAfter(instant: Date): Date {
  const tick = new Date(instant.getTime());
  tick.setUTCHours(DAILY_TICK_UTC_HOUR, DAILY_TICK_UTC_MINUTE, 0, 0);
  if (tick.getTime() < instant.getTime()) {
    tick.setUTCDate(tick.getUTCDate() + 1);
  }
  return tick;
}

/**
 * How many daily passes fit in `windowMs` — i.e. how many times something can
 * actually be retried inside a wall-clock budget.
 *
 * Attempt counts are the usual way a queue bounds its own work, and they are
 * the wrong unit here: `8 attempts` meant ~2 hours under the ladder it was
 * sized for and means ~8 days under the drain that really runs. Callers state
 * the budget they mean in days and derive the count from this.
 */
export function dailyPassesWithin(windowMs: number): number {
  return Math.max(1, Math.floor(windowMs / DAILY_TICK_INTERVAL_MS));
}
