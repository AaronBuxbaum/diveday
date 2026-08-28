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
      className={`flex shrink-0 items-center gap-2 text-sm tabular-nums ${
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <p className="min-w-0 flex-1 text-base font-medium">
                {row.title}
                <span className="font-normal text-muted tabular-nums">
                  {" · "}
                  {row.date}
                </span>
              </p>
              <ShareMeter share={row.seats} className="lg:w-52" />
              <span className="shrink-0 text-sm text-muted tabular-nums lg:w-20">{row.crew}</span>
              {row.waivers ? (
                <ShareMeter share={row.waivers} remainder="attention" className="lg:w-52" />
              ) : (
                // The slot is kept so the columns above and below it stay in
                // line; a departure nobody booked has no waivers to report.
                <span aria-hidden="true" className="hidden shrink-0 lg:block lg:w-52" />
              )}
            </div>
          </LedgerRow>
        ))}
      </ul>
      {pager}
    </section>
  );
}
