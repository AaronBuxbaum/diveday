/**
 * **One reader for the Gear tab's numbers** (visual review 2026-10-24, A10 and
 * B54): the summary line and "Assign all {n} proposed units" read their counts
 * here, from the same rows and the same picks, so the two can never say two
 * different things about one departure.
 *
 * - `assigned`: units already reserved for a diver on this departure.
 * - `needed`: every piece the renting divers take, assigned or not.
 * - `missing`: pieces with no unit yet (`needed − assigned`).
 * - `proposed`: of those, the ones DiveDay can propose a free unit for; the
 *   button assigns exactly these, and the rest stay for a person to pick.
 * - `diversWaiting`: divers with at least one piece still missing — the one
 *   count the summary leads with (visual review 2026-10-24, A10 / B54).
 */
export type AssignmentCounts = {
  assigned: number;
  needed: number;
  missing: number;
  proposed: number;
  diversWaiting: number;
};

export function assignmentCounts(
  rows: readonly { assigned: readonly unknown[]; wanted: readonly unknown[] }[],
  proposalPicks: readonly unknown[],
): AssignmentCounts {
  const assigned = rows.reduce((sum, row) => sum + row.assigned.length, 0);
  const missing = rows.reduce((sum, row) => sum + row.wanted.length, 0);
  return {
    assigned,
    needed: assigned + missing,
    missing,
    proposed: proposalPicks.length,
    diversWaiting: rows.filter((row) => row.wanted.length > 0).length,
  };
}
