/**
 * **Whether a shop plans its crew in DiveDay** (`shops.crew_schedule_enabled`,
 * ADR 20261005-crew-schedule-is-a-setting).
 *
 * On, the shop gets the Crew view of Schedule (shifts, days away, crew asking
 * for a departure), the crew line on the week, and the nudges measured against
 * its own divemaster target. Off, all of that is gone. Who is aboard is not
 * planning, so every departure keeps its crew editor either way: the crew roll
 * call and the souls-on-board count read it, and a course session's agency
 * ratio refuses seats from it (`src/lib/course-ratios.ts`).
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
