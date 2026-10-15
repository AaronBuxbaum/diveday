/**
 * **The walk-in form's party rows** (fifth loop, item 9): the field names the
 * client rows post and the action reads back, kept out of both so neither
 * spells them alone.
 */

/** The form's name for `KeepTypedOnRefusal`, so a refused party comes back typed. */
export const WALK_IN_PARTY_FORM = "walk-in-party";

/** The most people one walk-in form seats: the first person and seven more. */
export const WALK_IN_PARTY_MAX = 8;

/** A party row's field: `member-<n>-name`, or `member-<n>-minor` for its "Under 18" tick. */
export function walkInMemberField(row: number, field: "name" | "minor"): string {
  return `member-${row}-${field}`;
}

/** A party row as posted: the name typed and whether "Under 18" was ticked. */
export type WalkInPartyRow = { fullName: string; minor: boolean };

/**
 * The party rows a form posted, in row order, without the empty ones. Reads
 * only row numbers the client could have written, and no more rows than the
 * form allows.
 */
export function readWalkInPartyRows(
  entries: Iterable<[string, FormDataEntryValue]>,
): WalkInPartyRow[] {
  const byRow = new Map<number, { fullName?: string; minor?: boolean }>();
  for (const [name, value] of entries) {
    const match = /^member-(\d{1,4})-(name|minor)$/.exec(name);
    if (!match || typeof value !== "string") continue;
    const row = Number(match[1]);
    const current = byRow.get(row) ?? {};
    if (match[2] === "name") current.fullName = value.trim();
    else current.minor = value === "true";
    byRow.set(row, current);
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => ({ fullName: row.fullName ?? "", minor: row.minor === true }))
    .filter((row) => row.fullName.length > 0)
    .slice(0, WALK_IN_PARTY_MAX - 1);
}
