import { courseDayPlan } from "@/app/s/[shopSlug]/trips/[id]/_components/TripDayPlan";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { DiverTranslator } from "@/i18n/messages";
import { type CourseScheduleDay, formatScheduleDayTime } from "@/lib/courses";
import type { DepthUnit } from "@/lib/depth-units";

/**
 * **The session's own day, on the thread** (issue #2795): Discover Scuba's
 * "Your afternoon", read off the course row exactly as the trip page's "The
 * day" reads it (`courseDayPlan`), so the two never disagree about which day
 * of the plan this session is, and its depths are said in the shop's unit.
 * Only a one-meeting session of a one-day plan has a day to say; every other
 * session, and every ordinary departure, renders nothing.
 *
 * It stands where a charter's dock-day rhythm stands, under the packing list:
 * a course session has no dock rhythm (`PackingSection`), and this is its
 * answer to "what happens when I get there". The gear line stays with the gear
 * step and the packing list, which already say it.
 */
export function SessionDayPlan({
  course,
  meetingDays,
  depthUnit,
  t,
  locale,
}: {
  course: { scheduleDays: CourseScheduleDay[]; gearIncluded: boolean } | null | undefined;
  /** How many days this session meets on (`trip_schedule_days`). */
  meetingDays: number;
  depthUnit: DepthUnit;
  t: DiverTranslator;
  locale: string;
}) {
  const day = courseDayPlan(course, t, depthUnit, meetingDays)?.days[0];
  if (!day) return null;
  const time = formatScheduleDayTime(day, locale);
  return (
    <section aria-labelledby="session-day-heading" data-testid="ready-session-day">
      <h2 id="session-day-heading" className={SECTION_TITLE_CLASS}>
        {day.title}
      </h2>
      {time ? <p className="mt-1 text-sm text-muted tabular-nums">{time}</p> : null}
      {day.items.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          {day.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
