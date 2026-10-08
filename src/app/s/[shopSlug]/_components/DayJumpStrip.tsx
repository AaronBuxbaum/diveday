import { groupLabelClass } from "@/components/ui/ledger";
import { FIGURE_INLINE_CLASS } from "@/components/ui/typography";
import { dayAnchorId, type WeekLedgerRow } from "./WeekLedger";

/**
 * **Jump to a day** (UX audit #18). A phone reads the week as one long column,
 * and a diver looking for Saturday scrolled past every boat before it. This is
 * the week's days as one row of numerals, each a link to that day's first
 * departure in the list below: the same calendar block the day rules wear,
 * shrunk to a tap target. Plain fragment links, so it works before hydration
 * and without JavaScript.
 *
 * Only the days on this page of the list: a day the pager has not loaded has
 * nothing to land on, and "Show later departures" is the way to it. Fewer than
 * two days is nothing to jump between, and renders nothing.
 *
 * A labeled region, not a `<nav>`, for the reason the month rail beside it is
 * one: the frame promises zero navigation landmarks, and this is a list of
 * dates rather than a way around the site. It never renders in the frame.
 *
 * On a phone the week runs past the right edge, and a row that ends flush on a
 * day number says nothing more is there. It wears the scrolling tables' edge
 * fade (`table-scroll-shell` in globals.css), which closes as the hand reaches
 * the last day and draws nothing when the week fits.
 */
export function DayJumpStrip({
  rows,
  label,
}: {
  rows: readonly Pick<WeekLedgerRow, "dayKey" | "dayParts">[];
  label: string;
}) {
  const days: Pick<WeekLedgerRow, "dayKey" | "dayParts">[] = [];
  for (const row of rows) {
    if (days.at(-1)?.dayKey !== row.dayKey) days.push(row);
  }
  if (days.length < 2) return null;
  return (
    <section
      aria-label={label}
      className="table-scroll-shell -mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <ol className="flex gap-1">
        {days.map(({ dayKey, dayParts }) => (
          <li key={dayKey}>
            <a
              href={`#${dayAnchorId(dayKey)}`}
              // Spoken whole: the month is drawn once on the rail above, but a
              // screen reader reading one link hears the whole date.
              aria-label={`${dayParts.weekday} ${dayParts.day} ${dayParts.month}`}
              className="flex min-h-12 min-w-12 flex-col items-center justify-center rounded-lg px-2 py-1 transition-colors hover:bg-surface focus-visible:focus-ring"
            >
              <span className={groupLabelClass()}>{dayParts.weekday}</span>{" "}
              <span className={`${FIGURE_INLINE_CLASS} leading-tight`}>{dayParts.day}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
