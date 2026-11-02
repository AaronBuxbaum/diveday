/**
 * The platform's scheduling grain, in one place.
 *
 * Most durable retries are drained by the daily `/api/cron/reminders` entry
 * (`DAILY_TICK_CRONTAB`, mirrored from vercel.json). That cadence, not the
 * backoff arithmetic a queue writes into `next_attempt_at`, is the real floor
 * on how soon those messages can be tried again: under a once-a-day drain
 * every rung of `src/db/notifications.ts`'s 30s -> 1h ladder collapses to the
 * next tick (OPS-6). Consumers derive their bounds from the constants here
 * rather than restating a cadence the queue cannot deliver.
 *
 * Fresh sends are the intentional exception and do not drain the queue: the
 * hourly shop tick (`SHOP_TICK_CRONTAB` below) and the other hourly passes
 * allowlisted in `cron-schedule.test.ts`.
 */

/** UTC hour of the daily `/api/cron/reminders` tick. Mirrors vercel.json. */
export const DAILY_TICK_UTC_HOUR = 14;

/** UTC minute of the daily tick. Mirrors vercel.json. */
export const DAILY_TICK_UTC_MINUTE = 7;

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

/**
 * **The shop tick: hourly, at `:00`** (`/api/cron/shop-tick`, issue #2715).
 * Every shop cadence is one of its scans (`src/features/shop-tick`), so this
 * is the one schedule a shop's day is served on: platform cadences are UTC
 * routes of their own, shop cadences are this tick. `:00` because the
 * minimum-head-count decision is printed on the booking page to the minute,
 * and the top of the hour is the closest an hourly pass gets to it (ADR
 * 20260813-minimum-head-count-departures). Mirrors vercel.json;
 * `cron-schedule.test.ts` fails if the two drift.
 */
export const SHOP_TICK_CRONTAB = "0 * * * *";

/** Milliseconds between two consecutive daily ticks. */
export const DAILY_TICK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/**
 * The first moment the daily drain runs at or after `instant`: the honest form
 * of "retry in N milliseconds", since nothing reads `next_attempt_at` before
 * the next tick. Snapping to the boundary also removes a full-day slip: a
 * delay landing a few minutes *past* a tick (a failure just before it asking
 * for an hour) would miss the pass that just ran and wait a day, so "one pass
 * later" means one pass. Pure and instant-based, in the UTC the cron uses.
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
 * How many daily passes fit in `windowMs`: how many times something can
 * actually be retried inside a wall-clock budget. Attempt counts are the wrong
 * unit under a daily drain (8 attempts is ~8 days, not ~2 hours), so callers
 * state the budget in days and derive the count from this.
 */
export function dailyPassesWithin(windowMs: number): number {
  return Math.max(1, Math.floor(windowMs / DAILY_TICK_INTERVAL_MS));
}
