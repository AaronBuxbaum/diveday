import type { ReactNode } from "react";
import { GroupLabel, LedgerRow } from "@/components/ui/ledger";
import { ProgressBar } from "@/components/ui/ProgressBar";

/**
 * **The month's departures as a ledger** — ADR 20260827-the-shops-shelves,
 * decision 3, in the open-ledger grammar of ADR
 * 20260827-clearwater-surface-language (decision 2).
 *
 * What this replaced was a five-column `<Table>` whose headers were the only
 * thing naming what each cell held, which is why the phone had to fold "Seats"
 * back into the trip cell and hide two columns outright. A ledger row carries
 * its own nouns, so nothing has to be hidden and nothing has to be said twice:
 * the title and its date are the door, and the three facts behind it — seats,
 * crew, waivers — are worded fragments, tabular, each with its meter beside it.
 *
 * **The ink is on the gap, not the achievement** (issue 775, kept verbatim
 * through the recomposition). The seats meter is quiet at every ratio: a
 * half-full boat on a month being reviewed is a fact, not a task, and toning
 * one would put amber on most rows of a working shop's report. The waiver
 * meter's *remainder* is what carries the tone — the fill stays quiet at every
 * ratio — so at 0% the whole bar is the warning, at 100% there is nothing left
 * to warn about, and every value between shades itself with no threshold to
 * argue about. `DepartureLedger.test.tsx` pins that the fill never takes it.
 *
 * The meters are decorative and say so: every number they draw is already in
 * the words beside them, which is also what lets the phone keep all three
 * facts instead of hiding two.
 */

/** A share of a whole, already worded — "9 of 12 seats". */
export type DepartureShare = {
  /** The fact, in words. Never a bare numeral: no column header names it. */
  fact: string;
  /** 0–1, or null when there is nothing to measure (a departure with no seats). */
  ratio: number | null;
};

export type DepartureRow = {
  tripId: string;
  /** The guest list — the row is the door to it. */
  href: string;
  title: string;
  /** Already formatted in the shop's zone and the reader's locale. */
  date: string;
  seats: DepartureShare;
  /** "3 crew" — never a cost; DiveDay does not know wages (issue #700). */
  crew: string;
  /** Null for a departure nobody booked: no waivers to collect, so nothing to say. */
  waivers: DepartureShare | null;
};

/**
 * One share: the words, then a 5px meter. `attention` puts the tone on the
 * remainder by colouring the *track* the fill has not covered — the fill is
 * `bg-muted` at every ratio, in both modes.
 *
 * The meter is the half that goes on a phone, and the words are the half that
 * stays. Three facts and three bars on one 390px row wrap five lines deep; the
 * bars are the scannable rendering of numbers already written beside them, so
 * dropping them there costs the reader nothing and dropping the words would
 * cost them the fact. It is the opposite of the old table's answer, which hid
 * two whole columns and had to fold "70% of what?" back into the trip cell.
 *
 * **From `lg` the words start the column and the bar ends it** (K-285), so
 * every row's bar stands at one x: after the words, the bar's start was the
 * words' length, and the seats bars wandered 18px down a month (x 236, 245,
 * 254…). The words are set whole (K-286): a column that could not hold
 * "10 of 10 waivers" beside its bar wrapped the fact and stood that row 85px
 * against the others' 65. See `METER_COLUMN` for the width.
 */
function ShareMeter({
  share,
  remainder = "quiet",
  className = "",
}: {
  share: DepartureShare;
  remainder?: "quiet" | "attention";
  className?: string;
}) {
  const attention = remainder === "attention" && share.ratio !== null && share.ratio < 1;
  return (
    <span
      className={`flex min-w-0 max-w-full items-center gap-2 text-sm whitespace-nowrap tabular-nums lg:justify-between ${
        attention ? "font-medium text-warning-strong" : "text-muted"
      } ${className}`.trim()}
    >
      {share.fact}
      {share.ratio === null ? null : (
        <ProgressBar
          aria-hidden="true"
          className="hidden h-[5px] w-24 shrink-0 lg:block"
          trackClassName={attention ? "bg-warning" : "bg-surface-sunken"}
          segments={[{ key: "share", fraction: share.ratio, className: "bg-muted" }]}
        />
      )}
    </span>
  );
}

/**
 * **A meter's column, from `lg`: the longest real fact, the gap and the bar.**
 * "5 of 5 waivers" measures 89px at 1280, so "10 of 10 waivers" is about 107.
 * The longest is Spanish, "10 de 10 exenciones", about 133px; with the 8px
 * gap and the 96px bar that is 237px, past `w-56` and 3px inside `w-60`, too
 * close to call, so `w-64`. One class for both meters and the empty slot that
 * holds the waivers column open, so the columns line up down every row.
 * Exported for the Reports skeleton, whose bars stand in these columns.
 */
export const METER_COLUMN = "lg:w-64";

/**
 * The crew count's column, set whole: "3 tripulantes" is about 78px and two
 * digits of it 87, so `w-20` wrapped it or ran it into the gap.
 */
export const CREW_COLUMN = "lg:w-24";

export function DepartureLedger({
  label,
  labelId,
  count,
  rows,
  pager,
  className = "",
}: {
  label: string;
  /** Names the section for a screen reader through the group label itself. */
  labelId: string;
  /**
   * How many departures the month holds, already worded and pluralised. It
   * belongs to the group header rather than to the pager: the pager renders
   * nothing at all on a single-page month, and a shared fact said once is said
   * where the group owns it.
   */
  count: string;
  rows: DepartureRow[];
  /** The month's `Pager`, rendered by the page that owns the URL grammar. */
  pager?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={labelId} className={className || undefined}>
      <GroupLabel as="h2" id={labelId} meta={count}>
        {label}
      </GroupLabel>
      <ul className="mt-2">
        {rows.map((row) => (
          <LedgerRow key={row.tripId} href={row.href} linkLabel={row.title}>
            <div className="min-w-0">
              <p className="min-w-0 text-base font-medium break-words">
                {row.title}
                <span className="font-normal text-muted tabular-nums">
                  {" · "}
                  {row.date}
                </span>
              </p>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:mt-1 lg:flex-nowrap">
                <ShareMeter share={row.seats} className={METER_COLUMN} />
                <span
                  className={`shrink-0 whitespace-nowrap text-muted tabular-nums ${CREW_COLUMN}`}
                >
                  {row.crew}
                </span>
                {row.waivers ? (
                  <ShareMeter share={row.waivers} remainder="attention" className={METER_COLUMN} />
                ) : (
                  <span aria-hidden="true" className={`hidden shrink-0 lg:block ${METER_COLUMN}`} />
                )}
              </div>
            </div>
          </LedgerRow>
        ))}
      </ul>
      {pager}
    </section>
  );
}
