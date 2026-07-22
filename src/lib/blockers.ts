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

/**
 * A blocked row's one action. `sendsWaiver` rows post the send in place
 * (`bookingId` is the payload); every other row navigates to `href`. The label
 * is a verb only on the sends — a navigating row points ("Open Priya's record",
 * "Open roster") rather than pretending to act.
 */
export type BlockerFix = {
  label: string;
  href: string;
  sendsWaiver: boolean;
  bookingId: string;
};

const WAIVER_CODES = new Set(["waiver_not_sent", "waiver_pending", "waiver_expired"]);

function firstNameOf(fullName: string): string {
  return fullName.split(" ")[0] || fullName;
}

/**
 * The one-tap fix for a diver's *worst* blocker: a missing/pending/expired
 * waiver sends from here; card evidence lives on the person record; payment and
 * setup work lives on the trip roster (anchored to the diver's booking).
 */
export function blockerFixFor(
  blockers: readonly ReadinessBlocker[],
  ctx: { shopSlug: string; tripId: string; personId: string; bookingId: string; fullName: string },
): BlockerFix | null {
  const blocker = primaryBlocker(blockers);
  if (!blocker) return null;
  const { actionLabel, target } = BLOCKER_ACTIONS[blocker.code];
  const sendsWaiver = WAIVER_CODES.has(blocker.code);
  const rosterRow = `/shop/${ctx.shopSlug}/trips/${ctx.tripId}/guests#booking-${ctx.bookingId}`;
  return {
    label: sendsWaiver
      ? actionLabel
      : target === "diver"
        ? `Open ${firstNameOf(ctx.fullName)}’s record`
        : "Open roster",
    href: target === "diver" ? `/shop/${ctx.shopSlug}/divers/${ctx.personId}` : rosterRow,
    sendsWaiver,
    bookingId: ctx.bookingId,
  };
}

/** Bookings on this trip whose worst blocker a one-tap waiver send would clear. */
export function waiverBookingIds(trip: BlockerQueueTrip): string[] {
  return trip.divers.filter((diver) => diver.fix.sendsWaiver).map((diver) => diver.bookingId);
}

/**
 * Fill each blocked row's `alsoOn` with the *other* departures the same person
 * is blocked on. A diver booked on two boats otherwise reads as two unrelated
 * rows; this ties them together so staff resolve the person once. Mutates in
 * place and returns the same array. Trip identity (not title) dedupes, so two
 * departures that happen to share a title never collapse into one.
 */
export function annotateAlsoOn(trips: BlockerQueueTrip[]): BlockerQueueTrip[] {
  const seenByPerson = new Map<string, { tripId: string; title: string }[]>();
  for (const trip of trips) {
    for (const diver of trip.divers) {
      const list = seenByPerson.get(diver.personId) ?? [];
      list.push({ tripId: trip.tripId, title: trip.title });
      seenByPerson.set(diver.personId, list);
    }
  }
  for (const trip of trips) {
    for (const diver of trip.divers) {
      diver.alsoOn = (seenByPerson.get(diver.personId) ?? [])
        .filter((entry) => entry.tripId !== trip.tripId)
        .map((entry) => entry.title);
    }
  }
  return trips;
}

export type BlockerQueueDiver = {
  bookingId: string;
  personId: string;
  fullName: string;
  blockers: ReadinessBlocker[];
  fix: BlockerFix;
  /**
   * Titles of the *other* upcoming departures this same person is also blocked
   * on. Lets staff see a repeat name is one person across boats, not several
   * strangers, and resolve them once. Empty for a diver blocked on one trip.
   */
  alsoOn: string[];
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

/** Total blocked rows across the queue (a diver on two boats counts twice). */
export function totalBlockedDivers(trips: readonly BlockerQueueTrip[]): number {
  return trips.reduce((sum, trip) => sum + trip.divers.length, 0);
}

/**
 * Distinct people still blocked — the honest headline count, since one diver
 * can be booked (and blocked) on several upcoming departures at once.
 */
export function distinctBlockedDivers(trips: readonly BlockerQueueTrip[]): number {
  const people = new Set<string>();
  for (const trip of trips) for (const diver of trip.divers) people.add(diver.personId);
  return people.size;
}
