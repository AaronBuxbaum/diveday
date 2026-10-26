import { formatTimeRange } from "@/lib/format";
import type { WeekShift } from "@/lib/staffing-week";

/**
 * A shift at rest: the range, and the note if there is one. `text-muted` on a
 * day already behind the shop sets the past down without dimming the fill
 * underneath it — an `opacity` on the whole cell would take the warning ink in
 * the gap row below AA with it.
 */

export function ShiftFace({
  shift,
  locale,
  timeZone,
  isPast,
}: {
  shift: WeekShift;
  locale: string;
  timeZone: string;
  isPast: boolean;
}) {
  return (
    <span className={`flex flex-col ${isPast ? "text-muted" : ""}`}>
      <span className="font-medium tabular-nums">
        {formatTimeRange(shift.startsAt, shift.endsAt, locale, timeZone)}
      </span>
      {shift.note ? <span className="font-medium text-muted">{shift.note}</span> : null}
    </span>
  );
}
