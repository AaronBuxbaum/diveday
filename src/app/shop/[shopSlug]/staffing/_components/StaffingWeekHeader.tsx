import { groupLabelClass } from "@/components/ui/group-label";

/** The week's column heads: an unnamed person column, then the seven days. */
export function StaffingWeekHeader({
  days,
  words,
  grid,
}: {
  days: { date: string; label: string; weekday: string; day: string; isToday: boolean }[];
  words: { person: string; today: string };
  grid: { row: string; personHead: string; dayHead: string };
}) {
  return (
    <thead className="block">
      <tr className={grid.row}>
        <th scope="col" className={`${grid.personHead} text-start font-normal`}>
          <span className="sr-only">{words.person}</span>
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
