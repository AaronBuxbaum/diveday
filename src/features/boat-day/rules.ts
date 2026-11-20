/**
 * **What collides across the boats of one day** (issue #4258). Pure: the day's departures in, the
 * collisions out, so the screen only draws what this decides.
 *
 * Two departures *overlap* when their hours do, half-open: a boat that comes home exactly as the
 * next one sails is not a clash, and a morning two-tank with an afternoon single is an ordinary
 * double shift, the same predicate `setTripCrew` refuses on. A collision informs; nothing here
 * ever stops a departure.
 */

export type DayDeparture = {
  tripId: string;
  startsAt: Date;
  endsAt: Date;
  /** The boat the departure is on, or null for a departure with no boat named. */
  boatId: string | null;
  crew: readonly { personId: string }[];
};

export type DayCollision =
  | { kind: "crew"; personId: string; tripIds: readonly [string, string] }
  | { kind: "boat"; boatId: string; tripIds: readonly [string, string] };

export function departuresOverlap(
  a: Pick<DayDeparture, "startsAt" | "endsAt">,
  b: Pick<DayDeparture, "startsAt" | "endsAt">,
): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Every pair of overlapping departures that share a person or a boat, once per pair and person.
 * Output order follows the input order, so the screen is stable between reads.
 */
export function dayCollisions(departures: readonly DayDeparture[]): DayCollision[] {
  const found: DayCollision[] = [];
  for (let i = 0; i < departures.length; i++) {
    const a = departures[i];
    if (!a) continue;
    for (let j = i + 1; j < departures.length; j++) {
      const b = departures[j];
      if (!b || !departuresOverlap(a, b)) continue;
      const tripIds = [a.tripId, b.tripId] as const;
      if (a.boatId !== null && a.boatId === b.boatId) {
        found.push({ kind: "boat", boatId: a.boatId, tripIds });
      }
      const onB = new Set(b.crew.map((member) => member.personId));
      for (const personId of new Set(a.crew.map((member) => member.personId))) {
        if (onB.has(personId)) found.push({ kind: "crew", personId, tripIds });
      }
    }
  }
  return found;
}

/** The collisions a single departure is part of, for the line under it. */
export function collisionsFor(tripId: string, collisions: readonly DayCollision[]): DayCollision[] {
  return collisions.filter((collision) => collision.tripIds.includes(tripId));
}
