import Link from "next/link";
import type { CalendarDay } from "@/lib/calendar";

/** A single dive/trip placed on a calendar day. `time` is pre-formatted in the shop timezone. */
export type CalendarTrip = {
  id: string;
  title: string;
  time: string;
  full: boolean;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Month overview of scheduled dives for the diver-facing schedule. Read-only
 * and server-rendered: month navigation is plain links (`?month=YYYY-MM`), each
 * dive is a link into its schedule detail. The list below the calendar remains
 * the primary booking surface — this is the "when can I dive?" glance.
 */
export function ScheduleCalendar({
  shopSlug,
  label,
  weeks,
  todayIso,
  tripsByDay,
  prevMonthKey,
  nextMonthKey,
}: {
  shopSlug: string;
  label: string;
  weeks: CalendarDay[][];
  todayIso: string;
  tripsByDay: Map<string, CalendarTrip[]>;
  prevMonthKey: string | null;
  nextMonthKey: string | null;
}) {
  const navClass =
    "inline-flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground";
  return (
    <section
      aria-label="Dive schedule calendar"
      className="mb-8 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{label}</h2>
        <div className="flex items-center gap-2">
          {prevMonthKey ? (
            <Link
              href={`/shop/${shopSlug}/schedule?month=${prevMonthKey}`}
              aria-label="Previous month"
              className={navClass}
            >
              <span aria-hidden="true">←</span>
            </Link>
          ) : (
            <span aria-hidden="true" className={`${navClass} cursor-default opacity-40`}>
              ←
            </span>
          )}
          {nextMonthKey ? (
            <Link
              href={`/shop/${shopSlug}/schedule?month=${nextMonthKey}`}
              aria-label="Next month"
              className={navClass}
            >
              <span aria-hidden="true">→</span>
            </Link>
          ) : (
            <span aria-hidden="true" className={`${navClass} cursor-default opacity-40`}>
              →
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="pb-1 text-center text-xs font-semibold tracking-wide text-muted uppercase"
          >
            <span className="hidden sm:inline">{weekday}</span>
            <span className="sm:hidden" aria-hidden="true">
              {weekday[0]}
            </span>
            <span className="sr-only sm:hidden">{weekday}</span>
          </div>
        ))}

        {weeks.flat().map((day) => {
          const trips = tripsByDay.get(day.iso) ?? [];
          const isToday = day.iso === todayIso;
          return (
            <div
              key={day.iso}
              className={`flex min-h-16 flex-col items-center rounded-lg border p-1 sm:min-h-24 ${
                day.inMonth ? "border-border" : "border-transparent"
              } ${trips.length > 0 && day.inMonth ? "bg-primary/5" : ""}`}
            >
              <div
                className={`flex size-6 shrink-0 items-center justify-center self-start rounded-full text-xs font-medium tabular-nums ${
                  isToday
                    ? "bg-primary text-primary-foreground"
                    : day.inMonth
                      ? "text-foreground"
                      : "text-muted/60"
                }`}
              >
                {day.day}
              </div>
              {trips.length > 0 ? (
                <ul className="mt-1 flex w-full flex-col gap-1">
                  {trips.map((trip) => (
                    <li key={trip.id}>
                      <Link
                        href={`/shop/${shopSlug}/schedule/${trip.id}`}
                        aria-label={`${trip.time} dive${trip.full ? " (full)" : ""}`}
                        className={`block truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight font-medium tabular-nums transition-colors duration-200 sm:text-xs ${
                          trip.full
                            ? "bg-surface-sunken text-muted hover:bg-border"
                            : "bg-primary/10 text-primary hover:bg-primary/20"
                        }`}
                        title={`${trip.title} · ${trip.time}`}
                      >
                        {trip.time}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
