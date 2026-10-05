/**
 * **Whether a shop plans its crew in DiveDay** (`shops.crew_schedule_enabled`,
 * ADR 20261005-crew-schedule-is-a-setting).
 *
 * On, the shop gets the Crew view of Schedule (shifts, days away, crew asking
 * for a departure), the crew line on the week, the crew editor on every
 * departure, and the nudges measured against its own divemaster target. Off,
 * all of that is gone — and one thing is not: a **course session** still names
 * its instructor, because the agency training ratio refuses seats from that
 * count (`src/lib/course-ratios.ts`) whether or not the shop keeps a roster.
 */
export type CrewScheduleShop = {
  crewScheduleEnabled: boolean;
  diversPerDivemaster: number;
};

/**
 * The divemaster target the shop's nudges are measured against, or null when
 * the shop keeps no roster — `divemasterRatioGap` reads null as "never short".
 */
export function shopCrewTarget(shop: CrewScheduleShop): number | null {
  return shop.crewScheduleEnabled ? shop.diversPerDivemaster : null;
}

/**
 * Whether one departure's page offers its crew editor. Always for a course
 * session, which cannot take an enrolment without a named instructor; for
 * anything else, only when the shop plans its crew here.
 */
export function departureShowsCrew(
  shop: Pick<CrewScheduleShop, "crewScheduleEnabled">,
  trip: { course: unknown },
): boolean {
  return shop.crewScheduleEnabled || trip.course != null;
}
