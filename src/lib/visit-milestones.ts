/**
 * **Which dive days a shop stamps** — ADR 20260827-the-divers-thread, decision
 * 4 (slice 7d), the keepsake's one piece of delight.
 *
 * A diver's ordinal visit is a fact the keepsake states on every after-state
 * ("your 3rd dive day with Blue Mantis"). On a *milestone* visit — the first,
 * and then the round numbers a logbook actually marks — the card wears a drawn
 * roundel instead of that line. This module owns the set, and nothing else
 * does: a second copy in the surface is how "10" and "25" end up disagreeing
 * with the words beside them.
 *
 * Framework-free and wordless, per the repo's codes-not-sentences rule: the
 * caller resolves `recap.milestoneStampFirst` / `recap.milestoneStamp` out of
 * the diver bundle, and this returns only the number that was reached.
 *
 * The set is deliberately short. A stamp on every fifth visit is a sticker
 * chart; these five are the counts a diver would mention out loud.
 */

/** The visits that earn a stamp. Ordered, and never grown at a call site. */
export const VISIT_MILESTONES = [1, 10, 25, 50, 100] as const;

export type VisitMilestone = (typeof VISIT_MILESTONES)[number];

/**
 * The milestone this visit *is*, or null when it is an ordinary one.
 *
 * Exact equality rather than "at least": the stamp marks the day the count was
 * reached, so visit 26 is not a 25th anniversary and visit 101 has already had
 * its roundel. A non-integer or non-positive count (which nothing produces —
 * `getRecapPageData` floors it at 1 — but which a caller could still hand over)
 * is no milestone rather than a thrown error, because a keepsake that fails to
 * render is worse than one with no stamp on it.
 */
export function visitMilestone(count: number): VisitMilestone | null {
  if (!Number.isInteger(count)) return null;
  return VISIT_MILESTONES.find((milestone) => milestone === count) ?? null;
}

/**
 * **The dive days a regular's milestone is said on** (H-20261014-boat-count-milestones): the 10th, 25th, 50th
 * and 100th, the stamp's set without the first, which already has its own
 * words on both sides ("First dive with us", "First dive day"). Read from the
 * one set above so the roster, the booked moment and the stamp never disagree.
 */
export const DIVE_DAY_MILESTONES = VISIT_MILESTONES.filter(
  (milestone): milestone is Exclude<VisitMilestone, 1> => milestone !== 1,
);

export type DiveDayMilestone = (typeof DIVE_DAY_MILESTONES)[number];

/**
 * The milestone this dive day is, or null: exact equality, for the reason
 * `visitMilestone` gives, so day 26 is never a 25th and a miscounted day
 * skips a milestone rather than repeating one.
 */
export function diveDayMilestone(count: number | null | undefined): DiveDayMilestone | null {
  if (typeof count !== "number" || !Number.isInteger(count)) return null;
  return DIVE_DAY_MILESTONES.find((milestone) => milestone === count) ?? null;
}
