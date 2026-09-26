import { Fragment } from "react";
import {
  DAY_LABEL_COLUMN_CLASS,
  DAY_NUMERAL_CLASS,
  WEEK_ROW_BOX_CLASS,
  WEEK_TIME_RAIL_CLASS,
} from "./WeekLedger";

/**
 * **The week ledger drawn as bars** — two days of two departures, each rule
 * and row in `WeekLedger`'s own box, for a skeleton that stands in for
 * the list (K-371: the framed schedule, which is nothing but this list).
 *
 * The boxes are the ledger's, class for class — the row's box, its time
 * rail, the numeral's two tabular digits and the weekday column are the very
 * strings `WeekLedger` exports for its skeletons — and
 * `WeekLedgerSkeleton.test.tsx` renders the two side by side, so a change to
 * the ledger's geometry that is not made here goes red there:
 *   - the list hands its last row's lower room back below itself
 *     (`-mb-4 sm:-mb-5`), as the loaded list does (K-507);
 *   - a rule: `pt-2 pb-3` around the 40px weekday-over-month block (two
 *     `text-base leading-tight` lines) — 60px — and `mt-8` below the day
 *     before it;
 *   - a row: `py-4` below `sm` and `py-5` from it, bleeding `-mx-3` into the
 *     gutter below `sm` exactly as the row's hover fill does, so its bars start
 *     where its words do; each line is its own line box — the time, the title
 *     and the seat state 24px, the meta line 20px, 4px under the title. Its
 *     columns meet on their first line's baseline, as the loaded row's do;
 *     every first line is a 24px bar, so they meet at its top as well.
 *
 * The ledger's sticky offset, its fills and its focus ring move nothing, so
 * the skeleton wears none of them.
 */
export function WeekLedgerSkeleton() {
  return (
    <div className="-mb-4 flex animate-pulse flex-col sm:-mb-5">
      {[0, 1].map((day) => (
        <Fragment key={day}>
          <div className="mt-8 flex items-center gap-3 pt-2 pb-3 first:mt-0">
            <div className={`${DAY_NUMERAL_CLASS} h-8 rounded bg-surface-sunken`} />
            <div className={`${DAY_LABEL_COLUMN_CLASS} h-10 gap-2`}>
              <div className="h-3 w-10 rounded bg-surface-sunken" />
              <div className="h-3 w-10 rounded bg-surface-sunken" />
            </div>
            <div className="h-px flex-1 bg-border" />
          </div>
          {[0, 1].map((row) => (
            <div key={row} className={`${WEEK_ROW_BOX_CLASS} sm:items-baseline`}>
              <div className={WEEK_TIME_RAIL_CLASS}>
                <LineBar height="h-6" width="w-36" />
              </div>
              <div className="min-w-0 flex-1">
                <LineBar height="h-6" width="w-56 max-w-full" />
                <LineBar height="mt-1 h-5" width="w-64 max-w-full" />
              </div>
              <LineBar height="h-6" width="w-24" />
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** One line box, holding a bar a little shorter than the line so two lines read as two. */
function LineBar({ height, width }: { height: string; width: string }) {
  return (
    <div className={`flex ${height} items-center`}>
      <div className={`h-3/4 ${width} rounded bg-surface-sunken`} />
    </div>
  );
}
