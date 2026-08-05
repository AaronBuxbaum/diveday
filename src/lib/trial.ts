/**
 * Trial-shop timing. Onboarding a shop at `/onboard` starts a trial (ADR
 * 20260720-trial-shops-are-not-demo); this is the one place that says how
 * long it runs and how to talk about the time left.
 *
 * Deliberately not a stored column: the trial window is a fixed offset from
 * `shops.created_at`, which already exists, so there is nothing to backfill
 * and no drift between "when the shop was created" and "when its trial
 * started." A shop with `isDemo: true` (the canonical seeded demo tenant) is
 * not a trial at all — callers gate on that themselves, the same way the demo
 * banner does, rather than this module knowing about shop rows.
 *
 * Soft expiry by product decision: nothing in the app reads `isTrialExpired`
 * to block a route or a mutation. A trial that runs past its window keeps
 * working exactly as before; expiry only changes what the owner is told in
 * settings.
 */

export const TRIAL_DURATION_DAYS = 21;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant a trial started at `createdAt` stops being "in trial." */
export function trialEndsAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TRIAL_DURATION_DAYS * DAY_MS);
}

/**
 * Whole days left in the trial, as of `now` — 21 on the day it starts,
 * counting down to 0 once the window has elapsed and never negative.
 * Partial days round up, so a trial with six hours left still reads "1 day
 * left" rather than "0."
 */
export function trialDaysRemaining(createdAt: Date, now: Date): number {
  const msRemaining = trialEndsAt(createdAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(msRemaining / DAY_MS));
}

/** True once the trial window has fully elapsed. */
export function isTrialExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() >= trialEndsAt(createdAt).getTime();
}
