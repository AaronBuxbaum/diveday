/**
 * **What the day set out to dive, against what it dived.**
 *
 * A departure carries two site lists in two tables, and they are deliberately
 * separate: `trip_dives` is the plan a shop published, `executed_dives` is what
 * a divemaster wrote down afterwards. Because they never overwrite each other,
 * "do not pretend the original plan was certain" costs nothing structurally —
 * there is only the question of what to *show*, which is what this decides
 * (issue #1191, D31).
 *
 * **Silence is the common answer, and the important one.** The comparison
 * returns `null` unless a dive the shop planned to a named site was recorded at
 * a different named one. No badge, no "as planned" line, no confirmation that
 * nothing moved: a sentence restating what the surface already shows earns
 * nothing and is deleted rather than shortened (AGENTS.md). A day that went to
 * plan renders exactly what it rendered before this existed.
 *
 * **Absence is not a change.** Three shapes look like a difference and are not:
 *
 * - a dive with **no record** — nobody wrote it down, which says nothing about
 *   where the boat went;
 * - a record naming **no site** (`actual_site_id` null) — the shop declined to
 *   name one, and rendering that as a change invents a fact it did not state;
 * - a **blank plan** — `trip_dives` rows are allowed to carry no site at all
 *   ("2 tank dive" is a real published plan), so a record naming one is filling
 *   a blank in, not departing from it.
 *
 * Only a named plan and a named record that disagree count.
 *
 * **Sites only, and no reason.** Depth, times and conditions are not compared
 * because the record card prints none of them — those numbers are the diver's
 * to write and a divemaster's to countersign, which is the whole finding of the
 * 2026-08-28 review recorded on `DiveRecord`. That also settles
 * `executed_dives.not_recorded`: a field a shop explicitly declined to record
 * can only be mis-rendered by a surface that tries to render it, and this one
 * never reaches past the site name. *Why* a site changed is #1184's (D24) and
 * its vocabulary is undecided; this says only *that* it did, so a reason drops
 * in beside it later without rewriting anything here.
 */

/** One dive as the shop published it. `siteName` is null for a blank leg. */
export type PlannedDive = { diveNumber: number; siteName: string | null };

/**
 * One dive as it was written down afterwards. `siteName` is null when the
 * record named no site — an omission, never a difference.
 */
export type LivedDive = { diveNumber: number; siteName: string | null };

/**
 * Both site lists, in dive order and deduped by name, for a day whose record
 * disagrees with its plan. Never returned when they agree.
 */
export type DiveRecordComparison = {
  /** Where the day went, as recorded. */
  actualSiteNames: string[];
  /** Where it had meant to go. */
  plannedSiteNames: string[];
};

/** Names in dive order, first mention wins, blanks dropped. */
function siteNamesInOrder(dives: readonly { diveNumber: number; siteName: string | null }[]) {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const dive of [...dives].sort((a, b) => a.diveNumber - b.diveNumber)) {
    if (!dive.siteName || seen.has(dive.siteName)) continue;
    seen.add(dive.siteName);
    names.push(dive.siteName);
  }
  return names;
}

/**
 * `null` when the day went to plan, or when nothing was written down that could
 * disagree with it. See this module's comment for what does and does not count
 * as a difference.
 */
export function compareDiveRecord(
  planned: readonly PlannedDive[],
  lived: readonly LivedDive[],
): DiveRecordComparison | null {
  const livedByNumber = new Map(lived.map((dive) => [dive.diveNumber, dive]));
  const changed = planned.some((plan) => {
    if (!plan.siteName) return false;
    const record = livedByNumber.get(plan.diveNumber);
    if (!record?.siteName) return false;
    return record.siteName !== plan.siteName;
  });
  if (!changed) return null;
  return {
    actualSiteNames: siteNamesInOrder(lived),
    plannedSiteNames: siteNamesInOrder(planned),
  };
}
