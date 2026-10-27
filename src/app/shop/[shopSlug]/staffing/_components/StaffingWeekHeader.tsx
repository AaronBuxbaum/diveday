import { groupLabelClass } from "@/components/ui/group-label";

/** Every printed sheet identifies its shop and full week, as well as its days. */
export function StaffingWeekHeader({
  days,
  shopName,
  rangeLabel,
  timeZoneLabel,
  words,
  grid,
}: {
  days: { date: string; label: string; weekday: string; day: string; isToday: boolean }[];
  shopName: string;
  rangeLabel: string;
  timeZoneLabel: string;
  words: { person: string; today: string };
  grid: { row: string; personHead: string; dayHead: string };
}) {
  return (
    <thead className="block print:table-header-group">
      <tr className={grid.row}>
        <th scope="col" className={`${grid.personHead} text-start font-normal`}>
          <span className="sr-only">{words.person}</span>
          <div data-crew-print-context className="hidden text-sm leading-snug print:block">
            <p className="font-semibold">{shopName}</p>
            <p className="mt-1">{rangeLabel}</p>
            <span data-crew-print-zone className="mt-1 block">
              {timeZoneLabel}
            </span>
          </div>
        </th>
        {days.map((day) => (
          <th key={day.date} scope="col" className={`${grid.dayHead} text-start font-normal`}>
            {/* The page's h1 is directly above this weekday heading. */}
            <h2 className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="sr-only">{day.label}</span>
              <span aria-hidden="true" className="flex flex-wrap items-baseline gap-x-1.5">
                <span className={groupLabelClass(day.isToday ? "primary" : "muted")}>
                  {day.weekday} {day.day}
                </span>
                {day.isToday ? (
                  <span className="text-xs font-semibold text-primary">{words.today}</span>
                ) : null}
              </span>
            </h2>
          </th>
        ))}
      </tr>
    </thead>
  );
}
