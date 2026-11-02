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
 * What "Crew arrive N minutes before divers" accepts (`shops.crew_lead_minutes`,
 * H-20261022-crew-arrive-before-divers): the form's `min`/`max`, the action's parse and the table's CHECK.
 */
export const CREW_LEAD_LIMITS = { min: 5, max: 180 } as const;

/**
 * A submitted crew time: empty is unset (crew read the divers' time), a whole
 * number inside {@link CREW_LEAD_LIMITS} is kept, anything else is refused
 * rather than clamped.
 */
export function parseCrewLeadMinutes(
  raw: string | null | undefined,
): { ok: true; minutes: number | null } | { ok: false } {
  if (raw === null || raw === undefined || raw.trim() === "") return { ok: true, minutes: null };
  const minutes = Number(raw);
  if (!Number.isInteger(minutes)) return { ok: false };
  if (minutes < CREW_LEAD_LIMITS.min || minutes > CREW_LEAD_LIMITS.max) return { ok: false };
  return { ok: true, minutes };
}

/**
 * When to be at the dock, and whose time it is: the crew member's own shift,
 * the shop's crew time, or the divers' call named as theirs.
 */
export type CrewCall = { at: Date; source: "shift" | "crew" | "divers" };

/**
 * **When a crew member should be at the dock** (fifth-loop ideas, item 47;
 * ux-delight sheet 2026-10-22, item 2; dive-domain review of layer 1).
 *
 * The shop's call first: its crew time (`crewLeadMinutes`, H-20261022-crew-arrive-before-divers), that many
 * minutes before the divers' dock call (or before the departure when divers
 * have none), as `crew`; with no crew time set, the divers' call, as
 * `divers`, so the line says it is the divers' time (dive-domain review of
 * layer r5-4, fix 4): crew who arrive with the customers leave tanks
 * unloaded and the O2 unchecked.
 *
 * Then **their own shift**, when one starts before the departure and is
 * still running at that call (a sunrise prep shift from 03:30, a 05:00–07:00
 * fill shift for a 07:00 boat): the earlier of the two wins, as `shift` when
 * the shift is earlier. A shift never makes the call later, and the call is
 * never later than a shift of theirs that is already running, so the line
 * never contradicts the person's own crew grid.
 *
 * `null` when nothing says anything before the departure itself.
 */
export function crewCallAt(
  startsAt: Date,
  shop: { dockCallMinutes: number; crewLeadMinutes: number | null },
  shifts: readonly { startsAt: Date; endsAt: Date }[],
): CrewCall | null {
  const divers = dockCallAt(startsAt, shop.dockCallMinutes);
  const crew = dockCallAt(divers ?? startsAt, shop.crewLeadMinutes ?? 0);
  const call: CrewCall | null = crew
    ? { at: crew, source: "crew" }
    : divers
      ? { at: divers, source: "divers" }
      : null;
  // Running at the call, or at the departure when there is no call.
  const by = call?.at ?? startsAt;
  let shiftStart: Date | null = null;
  for (const shift of shifts) {
    const relevant = shift.startsAt < startsAt && shift.endsAt >= by;
    if (relevant && (shiftStart === null || shift.startsAt < shiftStart)) {
      shiftStart = shift.startsAt;
    }
  }
  if (shiftStart && (call === null || shiftStart < call.at)) {
    return { at: shiftStart, source: "shift" };
  }
  return call;
}
