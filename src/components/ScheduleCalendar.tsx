import Link from "next/link";
import type { DiverTranslator } from "@/i18n/messages";
import type { CalendarDay } from "@/lib/calendar";

/** A single dive/trip placed on a calendar day. `time` is pre-formatted in the shop timezone. */
export type CalendarTrip = {
  id: string;
  title: string;
  time: string;
  full: boolean;
};

/**
 * The seven weekday names in the reader's own language, from `Intl` rather than
 * from the message bundle: a weekday name is not copy anyone writes, and a
 * hand-maintained list of seven strings per locale is seven chances to be wrong
 * about a language nobody on the team speaks. 2024-01-07 is a Sunday, so the
 * week starts where the grid does (src/lib/calendar.ts).
 */
function weekdayNames(locale: string): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(Date.UTC(2024, 0, 7 + index))),
  );
}

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
  /** Carries embed mode through month navigation and day taps so an embedded
   * calendar stays embedded — each link below decides its own `?`/`&`
   * delimiter, since month nav already has a `?month=` query and the day
   * links don't. */
  embed = false,
  locale,
  t,
}: {
  shopSlug: string;
  label: string;
  /** The negotiated request locale, for the weekday row's own names. */
  locale: string;
  t: DiverTranslator;
  weeks: CalendarDay[][];
  todayIso: string;
  tripsByDay: Map<string, CalendarTrip[]>;
  prevMonthKey: string | null;
  nextMonthKey: string | null;
  embed?: boolean;
}) {
  const embedSuffix = embed ? "&embed=1" : "";
  const weekdays = weekdayNames(locale);
  // size-11 (44px) meets the dock-test floor (design/principles.md #2) — size-9
  // (36px) was under it on the one control every visit to this page uses.
  const navClass =
    "inline-flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors duration-200 hover:bg-surface-sunken hover:text-foreground";
  return (
    <section
      aria-label={t("schedule.calendarLabel")}
      className="mb-8 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{label}</h2>
        <div className="flex items-center gap-2">
          {prevMonthKey ? (
            <Link
              href={`/shop/${shopSlug}/schedule?month=${prevMonthKey}${embedSuffix}`}
              aria-label={t("schedule.previousMonth")}
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
              href={`/shop/${shopSlug}/schedule?month=${nextMonthKey}${embedSuffix}`}
              aria-label={t("schedule.nextMonth")}
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
        {weekdays.map((weekday) => (
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
                        href={`/shop/${shopSlug}/schedule/${trip.id}${embed ? "?embed=1" : ""}`}
                        aria-label={t(
                          trip.full ? "schedule.calendarDiveFull" : "schedule.calendarDive",
                          { time: trip.time },
                        )}
                        // Not a full 44px target — a day with several dives stacks these
                        // tightly, and blowing each up to 44px would balloon the month
                        // grid this component's whole point is to keep glanceable. This
                        // is as tall as that constraint allows; the list below the
                        // calendar (linked from every day) stays the primary, full-size
                        // tap target for actually booking (design/principles.md #2).
                        className={`block truncate rounded px-1.5 py-1.5 text-left text-xs leading-tight font-medium tabular-nums transition-colors duration-200 ${
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
