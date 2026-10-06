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
