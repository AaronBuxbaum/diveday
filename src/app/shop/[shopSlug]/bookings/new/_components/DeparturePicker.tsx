import { GroupLabel, LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { CalendarDate } from "@/lib/calendar-date";

/**
 * **"Which departure?", as one ledger grouped by day** — ADR
 * 20260827-the-shops-shelves, decision 1 and its mapping table, in the
 * open-ledger grammar of ADR 20260827-clearwater-surface-language.
 *
 * What this replaced was a stack of rounded, sunken boxes whose every row read
 * "Title · Sat, Aug 29 · 7:00 AM — 11:00 AM". The date was on all of them
 * because a flat list has nothing to hang it from, which is the shape a group
 * header exists to fix: the day is the fact a run of departures shares, said
 * once above them, and the row keeps the two facts that differ — when it
 * leaves and what it is. A staffer standing at the phone is working from a day
 * the caller just said out loud, and this is the list they can scan by it.
 *
 * The flow is unchanged: the row is the door to step two, seats-left is the
 * question being asked ("does this diver fit?"), and the departures with no
 * seat left are excluded by the query, not hidden here.
 *
 * The rows arrive in `startsAt` order, so the days are consecutive runs rather
 * than buckets — the same discipline the course roster and the promo shelves
 * hold, and the reason a day never opens twice on one page.
 */

/** One departure a staffer can seat someone on. Already worded by the page. */
export type DeparturePickerRow = {
  id: string;
  /** Step two, with the request carried along when there is one. */
  href: string;
  title: string;
  /** "7:00 AM — 11:00 AM", in the shop's zone and the reader's locale. */
  time: string;
  /** "4 seats left". The question this list is being read to answer. */
  seats: string;
  /**
   * "2 requests" — divers who asked for this day and are not on a boat yet.
   * Only rendered when there are any; a "0 requests" is not a fact.
   */
  requests?: string;
};

/** One shop-local day's departures, in the order they sail. */
export type DeparturePickerDay = {
  day: CalendarDate;
  /** The day in words, for the reader's locale. */
  label: string;
  rows: DeparturePickerRow[];
};

export function DeparturePicker({
  heading,
  headingId,
  days,
  className = "",
}: {
  /** "Which departure?" — the step, not a day. */
  heading: string;
  headingId: string;
  days: readonly DeparturePickerDay[];
  className?: string;
}) {
  return (
    <section aria-labelledby={headingId} className={className || undefined}>
      <GroupLabel as="h2" id={headingId}>
        {heading}
      </GroupLabel>
      <div className="mt-4 space-y-6">
        {days.map((day) => (
          <LedgerGroup key={day.day} as="h3" id={`day-${day.day}`} label={day.label}>
            <ul aria-labelledby={`day-${day.day}`} className="mt-2">
              {day.rows.map((row) => (
                <LedgerRow
                  key={row.id}
                  href={row.href}
                  linkLabel={row.title}
                  trailing={
                    <span className="flex flex-col items-end gap-0.5 text-sm tabular-nums">
                      <span className="text-muted">{row.seats}</span>
                      {row.requests ? (
                        <span className="text-xs text-primary">{row.requests}</span>
                      ) : null}
                    </span>
                  }
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="shrink-0 text-sm text-muted tabular-nums">{row.time}</span>
                    <span className="min-w-0 font-medium">{row.title}</span>
                  </div>
                </LedgerRow>
              ))}
            </ul>
          </LedgerGroup>
        ))}
      </div>
    </section>
  );
}
