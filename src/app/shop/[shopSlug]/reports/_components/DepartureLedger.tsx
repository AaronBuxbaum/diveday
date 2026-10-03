import type { ReactNode } from "react";
import { GroupLabel, LedgerRow } from "@/components/ui/ledger";

/**
 * **The month's departures as a ledger** — ADR 20260827-the-shops-shelves,
 * decision 3, in the open-ledger grammar of ADR
 * 20260827-clearwater-surface-language (decision 2).
 *
 * Each row is the door to its trip and says three things in words: how full
 * the boat was, how many crew went, and whether any waivers are still out.
 * There are no meters. The seats and waivers bars that stood here drew the
 * same numbers the words already said, and the waiver bar coloured the part
 * that was *missing*, which read as backwards (Aaron, 2026-10-03). A ledger
 * row carries its own nouns, so the phone keeps all three facts.
 *
 * **The ink is on the gap, not the achievement** (issue 775). Seats are quiet
 * at every count: a half-full boat on a month being reviewed is a fact, not a
 * task. Waivers say "all in" quietly, and only the count still to collect
 * takes the warning tone, in words, so colour never carries it alone.
 *
 * From `lg` the title takes the row's left and the facts stand in three fixed
 * columns on its right, so each fact lines up down the month and reads as a
 * column. Below `lg` they wrap under the title.
 */

/** A departure's waivers: none outstanding, or how many still to collect. */
export type DepartureWaivers = {
  /** "All waivers in" or "2 waivers to collect", already worded. */
  fact: string;
  /** True when at least one booked diver has not signed. */
  outstanding: boolean;
};

export type DepartureRow = {
  tripId: string;
  /** The guest list — the row is the door to it. */
  href: string;
  title: string;
  /** Already formatted in the shop's zone and the reader's locale. */
  date: string;
  /** "9 of 12 seats". */
  seats: string;
  /** "3 crew" — never a cost; DiveDay does not know wages (issue #700). */
  crew: string;
  /** Null for a departure nobody booked: no waivers to collect, so nothing to say. */
  waivers: DepartureWaivers | null;
};

/**
 * The facts' columns from `lg`, each sized for its longest real fact set
 * whole. Spanish is the longest of each: "10 de 12 plazas" (~100px),
 * "3 tripulantes" (~87px with two digits) and "12 exenciones por recoger"
 * (~170px). Exported for the Reports skeleton, whose blocks stand in them.
 */
export const SEATS_COLUMN = "lg:w-32";
export const CREW_COLUMN = "lg:w-24";
export const WAIVERS_COLUMN = "lg:w-48";

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
            <div className="flex min-w-0 flex-col gap-2 sm:gap-1 lg:flex-row lg:items-baseline lg:gap-6">
              <p className="min-w-0 text-base font-medium break-words lg:flex-1">
                {row.title}
                <span className="font-normal text-muted tabular-nums">
                  {" · "}
                  {row.date}
                </span>
              </p>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm whitespace-nowrap text-muted tabular-nums lg:flex-nowrap lg:gap-x-6">
                <span className={`shrink-0 ${SEATS_COLUMN}`}>{row.seats}</span>
                <span className={`shrink-0 ${CREW_COLUMN}`}>{row.crew}</span>
                {row.waivers ? (
                  <span
                    className={`shrink-0 ${WAIVERS_COLUMN} ${
                      row.waivers.outstanding ? "font-medium text-warning-strong" : ""
                    }`.trim()}
                  >
                    {row.waivers.fact}
                  </span>
                ) : (
                  // Holds the column open from `lg` so the rows still line up.
                  <span
                    aria-hidden="true"
                    className={`hidden shrink-0 lg:block ${WAIVERS_COLUMN}`}
                  />
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
