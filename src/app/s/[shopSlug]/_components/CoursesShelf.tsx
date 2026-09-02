import Link from "next/link";
import { CourseWavePlaceholder } from "@/components/CourseWavePlaceholder";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SectionCard } from "@/components/ui/card";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * **What the shop teaches, as a shelf** — ADR
 * 20260827-clearwater-surface-language, decision 8: courses and reviews follow
 * the week as shelves, so a diver who came for a boat and finds they need a
 * card has somewhere to go without hunting the header nav.
 *
 * Three cards and one door, deliberately. The catalog is progression-ordered
 * (`listActiveCourses`), so the three are the rungs a diver starts on, and
 * "All courses" is the rest — a shelf that grew to the whole catalog would be a
 * second page glued under the first.
 *
 * It renders on **any** shop with an active course, including one with no
 * departures at all: a course-led shop teaching from a classroom with nothing
 * yet on the board is a real day-zero shape, and the shelf is the only thing on
 * that page with something to sell.
 *
 * A card with no `courses.heroImageUrl` gets `CourseWavePlaceholder` rather
 * than a grey box or somebody else's stock reef — one drawn swell in the
 * primary tint, never the accent, which decision 11's budget has already spent
 * on the review stars.
 */
export function CoursesShelf({
  courses,
  allCoursesHref,
  className = "",
  t,
}: {
  courses: readonly {
    id: string;
    title: string;
    /** The shop's own pitch, or nothing — never DiveDay filler in its place. */
    summary: string | null;
    heroImageUrl: string | null;
    heroImageAlt: string;
    href: string;
    /** Already-formatted money, or null for a course with no price set. */
    price: string | null;
    /** `courses.durationText`, the shop's own words ("4 days"), or nothing. */
    duration: string | null;
    /** The next scheduled session, already formatted, or nothing when none is on the board. */
    nextStart: string | null;
  }[];
  allCoursesHref: string;
  /**
   * The page's rhythm, carried *inside* the section rather than on a wrapper —
   * a shelf that renders nothing must leave no gap behind it either.
   */
  className?: string;
  t: DiverTranslator;
}) {
  if (courses.length === 0) return null;
  return (
    <section aria-labelledby="courses-shelf" className={className || undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="courses-shelf" className="font-brand-display text-lg font-semibold tracking-tight">
          {t("courses.index.title")}
        </h2>
        <Link
          href={allCoursesHref}
          className="text-sm font-medium text-primary hover:underline focus-visible:underline"
        >
          {t("courses.shelf.allCourses")}
        </Link>
      </div>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <SectionCard as="li" key={course.id} padding="none" className="overflow-hidden">
            <Link href={course.href} className="group flex h-full flex-col">
              {course.heroImageUrl ? (
                <StoredPhoto
                  src={course.heroImageUrl}
                  alt={course.heroImageAlt}
                  className="h-32 w-full"
                  sizes="(min-width: 1024px) 22rem, (min-width: 640px) 50vw, 100vw"
                />
              ) : (
                <CourseWavePlaceholder className="h-32 w-full" />
              )}
              <div className="flex flex-1 flex-col gap-1 p-4">
                <h3 className="text-base font-semibold group-hover:text-primary">{course.title}</h3>
                {course.summary ? (
                  <p className="line-clamp-2 text-sm text-muted">{course.summary}</p>
                ) : null}
                {/* The two facts the board draws under a card — how long, and
                    when next — each only when the shop has it; a card says
                    nothing it does not know. */}
                {course.duration || course.nextStart ? (
                  <p className="mt-1 text-sm text-muted tabular-nums">
                    {[course.duration, course.nextStart].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {course.price ? (
                  <p className="mt-auto pt-2 text-base font-semibold tabular-nums">
                    {course.price}
                  </p>
                ) : null}
              </div>
            </Link>
          </SectionCard>
        ))}
      </ul>
    </section>
  );
}
