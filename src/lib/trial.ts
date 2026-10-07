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
 * Soft expiry by product decision: nothing in the app blocks a route or a
 * mutation when the window elapses. A trial that runs past it keeps working
 * exactly as before; expiry only changes what the owner is told on Settings >
 * Billing (`src/lib/billing/standing.ts`, ADR 20261007-subscription-billing).
 */

import { DAY_MS } from "@/lib/clock";

export const TRIAL_DURATION_DAYS = 21;

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
