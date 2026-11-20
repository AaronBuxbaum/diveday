import { DiveDayIcon } from "@/components/DiveDayIcon";
import type { MonthGridCell } from "./month-grid";
import { dayAnchorId } from "./WeekLedger";

/**
 * **The month as a calendar** (issue #4379): each day says how many boats have room, a full day
 * says Full, a day with no boat is blank. A day with boats links to its anchor in the list below.
 *
 * Plain fragment links, so it works before hydration. A labeled region, not a `<nav>`, for the
 * reason the day strip is one: the embed frame promises zero navigation landmarks, and this never
 * renders there.
 */
export function MonthGrid({
  label,
  weekdays,
  weeks,
  roomLabel,
  fullText,
  linkedDays,
}: {
  label: string;
  weekdays: readonly string[];
  weeks: readonly (MonthGridCell | null)[][];
  /** "2 boats have room", spoken whole. */
  roomLabel: (count: number) => string;
  fullText: string;
  /** Days that have a row in the list below, so a link has somewhere to land. */
  linkedDays: ReadonlySet<string>;
}) {
  return (
    <section aria-label={label} className="mb-4">
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {weekdays.map((weekday) => (
          <span key={weekday} className="py-1">
            {weekday}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((cell, i) =>
          cell === null ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: blank squares have no identity
            <span key={`blank-${i}`} />
          ) : (
            <Day key={cell.dayKey} cell={cell} {...{ roomLabel, fullText, linkedDays }} />
          ),
        )}
      </div>
    </section>
  );
}

function Day({
  cell,
  roomLabel,
  fullText,
  linkedDays,
}: {
  cell: MonthGridCell;
  roomLabel: (count: number) => string;
  fullText: string;
  linkedDays: ReadonlySet<string>;
}) {
  const full = cell.total > 0 && cell.withRoom === 0;
  const body = (
    <>
      <span className="text-sm font-semibold leading-tight">{cell.day}</span>
      {cell.total === 0 ? null : full ? (
        <span className="text-xs text-muted">{fullText}</span>
      ) : (
        <span className="flex items-center gap-0.5 text-xs">
          <DiveDayIcon name="boat" className="size-3" />
          {cell.withRoom}
        </span>
      )}
    </>
  );
  const base = "flex min-h-14 flex-col items-center justify-center rounded-lg py-1";
  if (cell.total === 0 || !linkedDays.has(cell.dayKey)) {
    return <span className={`${base} text-muted`}>{body}</span>;
  }
  return (
    <a
      href={`#${dayAnchorId(cell.dayKey)}`}
      aria-label={`${cell.day}, ${full ? fullText : roomLabel(cell.withRoom)}`}
      className={`${base} bg-surface transition-colors hover:bg-surface-sunken focus-visible:focus-ring-inset`}
    >
      {body}
    </a>
  );
}
