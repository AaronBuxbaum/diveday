import type { ReadinessBlocker } from "./readiness";
import { BLOCKER_ACTIONS, primaryBlocker } from "./today";

/**
 * The blocker queue is the front desk's whole day as one list: every diver who
 * can't board yet, across every upcoming departure, each with the single tap
 * that fixes them. It reuses the readiness engine verbatim (`readiness.ts`) and
 * the exact blocker→surface mapping the Today queue uses (`today.ts`), so a
 * blocker is never resolved by a different rule here than anywhere else.
 *
 * This module is the framework-free half: pointing a diver's worst blocker at
 * the surface that clears it. `src/db/blockers.ts` gathers the roster facts.
 */

export type BlockerFix = { label: string; href: string };

/**
 * The one-tap fix for a diver's *worst* blocker: card evidence lives on the
 * person record; waiver, payment, and setup work lives on the trip roster
 * (anchored to the diver's booking).
 */
export function blockerFixFor(
  blockers: readonly ReadinessBlocker[],
  ctx: { shopSlug: string; tripId: string; personId: string; bookingId: string },
): BlockerFix | null {
  const blocker = primaryBlocker(blockers);
  if (!blocker) return null;
  const { actionLabel, target } = BLOCKER_ACTIONS[blocker.code];
  return {
    label: actionLabel,
    href:
      target === "diver"
        ? `/shop/${ctx.shopSlug}/divers/${ctx.personId}`
        : `/shop/${ctx.shopSlug}/trips/${ctx.tripId}#booking-${ctx.bookingId}`,
  };
}

export type BlockerQueueDiver = {
  bookingId: string;
  personId: string;
  fullName: string;
  blockers: ReadinessBlocker[];
  fix: BlockerFix;
};

export type BlockerQueueTrip = {
  tripId: string;
  title: string;
  startsAt: Date;
  courseTitle: string | null;
  booked: number;
  ready: number;
  divers: BlockerQueueDiver[];
};

/** Total divers still blocked across the queue — the headline number. */
export function totalBlockedDivers(trips: readonly BlockerQueueTrip[]): number {
  return trips.reduce((sum, trip) => sum + trip.divers.length, 0);
}
