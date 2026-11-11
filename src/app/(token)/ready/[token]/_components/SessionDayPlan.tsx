import { courseDayPlan } from "@/app/s/[shopSlug]/trips/[id]/_components/TripDayPlan";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { DiverTranslator } from "@/i18n/messages";
import { type CourseScheduleDay, formatScheduleDayTime } from "@/lib/courses";
import type { DepthUnit } from "@/lib/depth-units";
import type { RentableItemKind } from "@/lib/rentals";

/** The course-authored outline for the whole run, without guessing a partial session's day. */
export function SessionDayPlan({
  course,
  meetingDays,
  depthUnit,
  t,
  locale,
}: {
  course:
    | { scheduleDays: CourseScheduleDay[]; includedRentalKinds: readonly RentableItemKind[] }
    | null
    | undefined;
  /** How many days this session meets on (`trip_schedule_days`). */
  meetingDays: number;
  depthUnit: DepthUnit;
  t: DiverTranslator;
  locale: string;
}) {
  const days = courseDayPlan(course, t, depthUnit, meetingDays)?.days ?? [];
  if (days.length === 0) return null;
  const multiple = days.length > 1;
  return (
    <section aria-labelledby="session-day-heading" data-testid="ready-session-day">
      <h2 id="session-day-heading" className={SECTION_TITLE_CLASS}>
        {multiple ? t("trip.coursePlanHeading") : days[0].title}
      </h2>
      <div className="mt-3 space-y-4">
        {days.map((day) => {
          const time = formatScheduleDayTime(day, locale);
          return (
            <div key={day.title}>
              {multiple ? <h3 className="text-base font-semibold">{day.title}</h3> : null}
              {time ? <p className="mt-1 text-sm text-muted tabular-nums">{time}</p> : null}
              {day.items.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted">
                  {day.items.map((item) => (
                    <li key={item}>{item}</li>
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
