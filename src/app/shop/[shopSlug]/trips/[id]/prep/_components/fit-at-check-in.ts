import type { PrepLine } from "@/lib/dive-prep";

/** One diver whose pieces are all fitted in person, said once. */
export type FitAtCheckInRow = {
  fullName: string;
  /** The pieces, in the rack's order the lines already carry. */
  lines: PrepLine[];
};

/**
 * **"Fit at check-in" once per diver** (visual review 2026-10-24, B54). The
 * by-item packing list grouped a fit-in-person piece into a line of its own
 * per kind, so a flagged diver read "Fit at check-in" on every piece of their
 * kit. This splits those lines back out by diver, keeping every piece: each
 * diver's row carries one line per piece they take (count 1 each), in the
 * order the lines came, and the ordinary lines are untouched. Nothing is
 * counted twice and nothing is dropped: the pieces on the fit rows plus the
 * ordinary lines add up to exactly the lines given.
 */
export function foldFitAtCheckIn(lines: readonly PrepLine[]): {
  lines: PrepLine[];
  fits: FitAtCheckInRow[];
} {
  const plain: PrepLine[] = [];
  const byName = new Map<string, FitAtCheckInRow>();
  for (const line of lines) {
    if (!line.fitAtCheckIn) {
      plain.push(line);
      continue;
    }
    for (const fullName of line.divers) {
      const row = byName.get(fullName) ?? { fullName, lines: [] };
      row.lines.push({ ...line, count: 1, divers: [fullName] });
      byName.set(fullName, row);
    }
  }
  return { lines: plain, fits: [...byName.values()] };
}
