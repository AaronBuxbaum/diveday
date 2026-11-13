import Link from "next/link";
import type { StaffingWeekWords } from "./staffing-week-types";

/** What a day holds, in the four kinds the strip draws as dots. */
export type StripDay = {
  date: string;
  label: string;
  weekday: string;
  day: string;
  isToday: boolean;
  isPast: boolean;
  shifts: number;
  crewing: number;
  away: number;
  gaps: number;
};

const DOT = "size-2 rounded-full";
// diveday:allow-type-ramp: a date numeral in a calendar cell, not a heading
const NUMERAL = "text-lg font-semibold tabular-nums";

/** One dot per kind a day holds, so a day reads as busy, away or short-handed before it is opened. */
function Dots({ day }: { day: StripDay }) {
  return (
    <span aria-hidden="true" className="flex h-2 items-center justify-center gap-1">
      {day.crewing > 0 ? <span className={`${DOT} bg-primary`} /> : null}
      {day.shifts > 0 ? <span className={`${DOT} bg-foreground/60`} /> : null}
      {day.away > 0 ? <span className={`${DOT} border border-dashed border-muted`} /> : null}
      {day.gaps > 0 ? <span className={`${DOT} bg-warning-strong`} /> : null}
    </span>
  );
}

/**
 * **The week as a calendar on a phone or tablet**: seven day cells in one row, a dot per kind of
 * thing in each, and the chosen day opened below. Each cell is a link, so the day lives in the
 * URL like the week does and the page stays a Server Component.
 */
export function StaffingWeekStrip({
  days,
  selected,
  hrefPrefix,
  words,
}: {
  days: readonly StripDay[];
  selected: string;
  /** The URL up to and including `day=`; the cell appends its date. */
  hrefPrefix: string;
  words: Pick<
    StaffingWeekWords,
    "ariaLabel" | "today" | "shift" | "crewing" | "away" | "needsCrew"
  >;
}) {
  const legend = [
    { word: words.crewing, dot: `${DOT} bg-primary` },
    { word: words.shift, dot: `${DOT} bg-foreground/60` },
    { word: words.away, dot: `${DOT} border border-dashed border-muted` },
    { word: words.needsCrew, dot: `${DOT} bg-warning-strong` },
  ];
  return (
    <div className="mt-4 xl:hidden">
      <nav aria-label={words.ariaLabel}>
        <ol className="grid grid-cols-7 gap-1 sm:gap-2">
          {days.map((day) => {
            const isSelected = day.date === selected;
            return (
              <li key={day.date}>
                <Link
                  href={`${hrefPrefix}${day.date}`}
                  scroll={false}
                  aria-current={isSelected ? "date" : undefined}
                  className={`flex min-h-20 flex-col items-center justify-between gap-1 rounded-lg border px-0.5 py-2 text-center transition-colors ${
                    isSelected
                      ? "border-primary bg-primary-tint"
                      : "border-border bg-surface hover:border-border-strong"
                  } ${day.isPast && !isSelected ? "text-muted" : ""}`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {day.weekday}
                  </span>
                  <span className={`${NUMERAL} ${day.isToday ? "text-primary" : ""}`}>
                    {day.day}
                  </span>
                  <span className="sr-only">
                    {day.label}
                    {day.isToday ? ` · ${words.today}` : ""}
                  </span>
                  <Dots day={day} />
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      <ul aria-hidden="true" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {legend.map((item) => (
          <li key={item.word} className="flex items-center gap-1.5">
            <span className={item.dot} />
            {item.word}
          </li>
        ))}
      </ul>
    </div>
  );
}
