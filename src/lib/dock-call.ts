/**
 * The dock call: the instant a diver should be at the dock, `dockCallMinutes`
 * (a shop setting) before the departure sails. `/ready`'s masthead, the trip
 * calendar file and the arrival card all name it, and they must name the
 * same minute, so the arithmetic lives here once.
 *
 * `null` when the shop asks for no lead time (`0`): "be at the dock by 8:00,
 * 0 minutes before we sail" is the departure time said twice, and a card that
 * already prints the departure range has nothing to add.
 */
export function dockCallAt(startsAt: Date, dockCallMinutes: number): Date | null {
  if (!Number.isFinite(dockCallMinutes) || dockCallMinutes <= 0) return null;
  return new Date(startsAt.getTime() - dockCallMinutes * 60_000);
}

/**
 * **When a crew member should be at the dock** (fifth-loop ideas, item 47):
 * the earlier of the divers' dock call and the start of the crew member's own
 * shift that covers the departure. Crew are never asked later than the divers
 * they meet, and a shift the owner set earlier (tanks, the boat check) wins.
 *
 * `null` when neither says anything before the departure itself: no lead time
 * and no covering shift, so the departure time is the only time to say.
 */
export function crewCallAt(
  startsAt: Date,
  dockCallMinutes: number,
  shifts: readonly { startsAt: Date; endsAt: Date }[],
): Date | null {
  const candidates = [dockCallAt(startsAt, dockCallMinutes)];
  for (const shift of shifts) {
    if (shift.startsAt < startsAt && shift.endsAt > startsAt) candidates.push(shift.startsAt);
  }
  const earliest = candidates
    .filter((at): at is Date => at !== null)
    .reduce<Date | null>((min, at) => (min === null || at < min ? at : min), null);
  return earliest;
}
