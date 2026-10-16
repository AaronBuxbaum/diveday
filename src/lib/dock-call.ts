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
 * How long before a departure a covering shift may start and still be read as
 * that boat's crew call. A day-long shift from 06:00 says when the day
 * starts, not when the 13:00 boat's crew should be on the dock.
 */
export const CREW_CALL_SHIFT_LEAD_MS = 3 * 60 * 60 * 1000;

/** When to be at the dock, and whose time it is. */
export type CrewCall = { at: Date; source: "shift" | "divers" };

/**
 * **When a crew member should be at the dock** (fifth-loop ideas, item 47).
 *
 * - **Their own shift covers the departure** and starts no more than
 *   {@link CREW_CALL_SHIFT_LEAD_MS} before it: the earlier of the shift's
 *   start and the divers' dock call, as `shift`. Crew are never asked later
 *   than the divers they meet.
 * - **Otherwise** the divers' dock call, as `divers`, so the line says it is
 *   the divers' time (dive-domain review of layer r5-4, fix 4): crew who
 *   arrive with the customers leave tanks unloaded and the O2 unchecked.
 *
 * `null` when neither says anything before the departure itself.
 */
export function crewCallAt(
  startsAt: Date,
  dockCallMinutes: number,
  shifts: readonly { startsAt: Date; endsAt: Date }[],
): CrewCall | null {
  const divers = dockCallAt(startsAt, dockCallMinutes);
  const earliest = (a: Date | null, b: Date) => (a === null || b < a ? b : a);
  let shiftStart: Date | null = null;
  for (const shift of shifts) {
    const covers = shift.startsAt < startsAt && shift.endsAt > startsAt;
    const near = startsAt.getTime() - shift.startsAt.getTime() <= CREW_CALL_SHIFT_LEAD_MS;
    if (covers && near) shiftStart = earliest(shiftStart, shift.startsAt);
  }
  if (shiftStart) return { at: divers ? earliest(shiftStart, divers) : shiftStart, source: "shift" };
  return divers ? { at: divers, source: "divers" } : null;
}
