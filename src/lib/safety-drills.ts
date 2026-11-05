/**
 * **The drill log** (loop 5, row 2; roadmap E3; glossary "Drill log"): the
 * dated safety drills a shop holds (emergency oxygen, missing diver, person
 * overboard, fire), who took part, and a note. A record an insurer renewal
 * reads beside the Safety tab's month; it informs and never gates.
 */

/** The four drills, in the order the Safety tab lists them. */
export const DRILL_KINDS = ["oxygen", "missing_diver", "overboard", "fire"] as const;
export type DrillKind = (typeof DRILL_KINDS)[number];

/** The longest note a drill keeps. */
export const DRILL_NOTE_MAX = 500;

export function isDrillKind(value: string): value is DrillKind {
  return DRILL_KINDS.some((kind) => kind === value);
}
