/**
 * **The week's rows: a day each, except a run of days already gone by with
 * nothing on them, which is one row** (UX review 2026-10-10, item 24).
 *
 * The week starts Monday, so on a Saturday the desk scrolled past five "No
 * boats" rows to reach today. Those days are settled, have nothing to add to
 * (a departure is put on the board ahead, never behind) and say the same
 * thing five times, so they fold into one line: "Mon to Fri · No boats".
 * The week itself still starts Monday, the pager and its `?week=` are
 * untouched, and a day that is today, still ahead, or carries anything at all
 * keeps its own row. A single quiet past day keeps its own row too: folding
 * one row into one row buys nothing.
 *
 * A plain module, not part of `WeekBoard.tsx`, so it is tested without a
 * render.
 */
export type WeekRow<Day> = { kind: "day"; day: Day } | { kind: "quiet"; days: Day[] };

export function weekRows<Day extends { isPast: boolean }>(
  days: readonly Day[],
  isEmpty: (day: Day) => boolean,
): WeekRow<Day>[] {
  const rows: WeekRow<Day>[] = [];
  let run: Day[] = [];
  const flush = () => {
    if (run.length > 1) rows.push({ kind: "quiet", days: run });
    else for (const day of run) rows.push({ kind: "day", day });
    run = [];
  };
  for (const day of days) {
    if (day.isPast && isEmpty(day)) {
      run.push(day);
      continue;
    }
    flush();
    rows.push({ kind: "day", day });
  }
  flush();
  return rows;
}
