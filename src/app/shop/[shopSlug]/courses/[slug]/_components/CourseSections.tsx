import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { Course } from "@/db/schema";
import type { CourseFaq, CourseScheduleDay } from "@/lib/courses";
import { formatShortDate, formatTime, formatTimeRangeTz } from "@/lib/format";
import { capacityLabel, isFull } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";

/**
 * The diver-facing course page, in sections. Each renders nothing when the shop
 * left it empty, so a half-written page degrades to a shorter page rather than
 * to a row of empty headings.
 */

/** Photo from a shop's blob store, a bundled path, or a link the shop pasted. */
function CourseImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  // biome-ignore lint/performance/noImgElement: course media comes from shop-provided hosts and the blob store, which no build-time image allowlist can enumerate.
  return <img src={src} alt={alt} loading="lazy" className={className} />;
}

export function CourseHero({
  course,
  totalCents,
  bookHref,
}: {
  course: Course;
  totalCents: number | null;
  bookHref: string | null;
}) {
  const usd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return (
    <header className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
      {course.heroImageUrl ? (
        <CourseImage
          src={course.heroImageUrl}
          alt=""
          className="h-56 w-full object-cover sm:h-80"
        />
      ) : null}
      <div className="p-6 sm:p-8">
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
          {course.agency.toUpperCase()} course
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{course.title}</h1>
        {course.summary ? (
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{course.summary}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          {totalCents === null ? null : (
            <p className="text-2xl font-semibold tabular-nums">
              {usd.format(totalCents / 100)}
              <span className="ml-2 text-sm font-normal text-muted">per diver</span>
            </p>
          )}
          {bookHref ? (
            <Link href={bookHref} className={buttonClass({ size: "cta" })}>
              See dates
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function CourseSpecs({ items }: { items: Array<{ label: string; value: string }> }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="At a glance" className="mt-8">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border border-border bg-surface p-4">
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {item.label}
            </dt>
            <dd className="mt-1 text-sm font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Who may enrol. The agency's certification gate and the shop's own note are
 * two different kinds of claim, and an unlabelled paragraph under a chip
 * labelled "Prerequisite" reads as one continuous sentence — which is how a
 * diver ends up believing shop prose ("or a qualifying certification…")
 * overrides the card the desk will actually check. The gate is restated here,
 * first and in the foreground; the note is labelled as the shop talking.
 */
export function CourseAdmission({
  certificationRequired,
  shopNote,
}: {
  certificationRequired: string;
  shopNote: string | null;
}) {
  return (
    <section
      aria-labelledby="who-can-enrol"
      className="mt-6 max-w-2xl rounded-2xl border border-border bg-surface-sunken p-5"
    >
      <h2 id="who-can-enrol" className="text-sm font-semibold tracking-wide text-muted uppercase">
        Who can enrol
      </h2>
      <p className="mt-2 font-medium">
        Certification required: <strong className="font-semibold">{certificationRequired}</strong>
      </p>
      {shopNote ? (
        <>
          <h3 className="mt-4 text-sm font-semibold tracking-wide text-muted uppercase">
            From the shop
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">{shopNote}</p>
        </>
      ) : null}
    </section>
  );
}

export function CourseOverview({ overview }: { overview: string | null }) {
  if (!overview?.trim()) return null;
  return (
    <section className="mt-10 max-w-2xl">
      {overview
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => (
          <p key={paragraph.slice(0, 40)} className="mt-4 leading-relaxed first:mt-0">
            {paragraph}
          </p>
        ))}
    </section>
  );
}

export function CourseSchedule({ days }: { days: CourseScheduleDay[] }) {
  if (days.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">How the course runs</h2>
      <ol className="mt-6 grid gap-4">
        {days.map((day) => (
          <li key={day.title} className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold">{day.title}</h3>
              {day.timeRange ? (
                <p className="text-sm tabular-nums text-muted">{day.timeRange}</p>
              ) : null}
            </div>
            {day.items.length > 0 ? (
              <ul className="mt-3 grid gap-2 text-sm text-muted">
                {day.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden="true" className="text-primary">
                      ·
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CourseIncludes({ includes, excludes }: { includes: string[]; excludes: string[] }) {
  if (includes.length === 0 && excludes.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">What the fee covers</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {includes.length > 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="text-sm font-semibold tracking-wide text-success uppercase">Included</h3>
            <ul className="mt-3 grid gap-2 text-sm">
              {includes.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="text-success">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {excludes.length > 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">
              Not included
            </h3>
            <ul className="mt-3 grid gap-2 text-sm text-muted">
              {excludes.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true">–</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function CourseGallery({ imageUrls, title }: { imageUrls: string[]; title: string }) {
  if (imageUrls.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="sr-only">Photos from the {title} course</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {imageUrls.map((url) => (
          <CourseImage
            key={url}
            src={url}
            alt=""
            className="h-40 w-full rounded-2xl border border-border object-cover sm:h-48"
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Sessions come from the schedule, not from a second booking path: each links
 * to the trip page that already owns capacity, readiness, and payment.
 */
export function CourseSessions({
  sessions,
  shopSlug,
  timezone,
}: {
  sessions: Array<{
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    booked: number;
  }>;
  shopSlug: string;
  timezone: string;
}) {
  return (
    <section id="dates" className="mt-12 scroll-mt-8">
      <h2 className="text-2xl font-semibold tracking-tight">Upcoming dates</h2>
      {sessions.length === 0 ? (
        <p className="mt-4 max-w-2xl text-muted">
          No dates on the books right now — this course runs on request.{" "}
          <Link
            href={`/shop/${shopSlug}/schedule`}
            className="font-medium text-primary hover:underline"
          >
            See the full schedule
          </Link>{" "}
          or get in touch and we will set one.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {sessions.map((session) => {
            const full = isFull(session);
            // A course typically runs across days, and rendering a three-day
            // course as "Wed, Jul 29 · 8:00 AM – 5:00 PM" hides two of them.
            // Show the span when the session ends on a later local day.
            const startDay = toDateInputValue(utcToWallTime(session.startsAt, timezone));
            const endDay = toDateInputValue(utcToWallTime(session.endsAt, timezone));
            const multiDay = startDay !== endDay;
            return (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5"
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {formatShortDate(session.startsAt, "en-US", timezone)}
                    {multiDay ? ` – ${formatShortDate(session.endsAt, "en-US", timezone)}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {multiDay
                      ? `Starts ${formatTime(session.startsAt, "en-US", timezone)}`
                      : formatTimeRangeTz(session.startsAt, session.endsAt, "en-US", timezone)}{" "}
                    · {capacityLabel(session)}
                  </p>
                </div>
                <Link
                  href={`/shop/${shopSlug}/schedule/${session.id}`}
                  className={buttonClass({
                    variant: full ? "secondary" : "primary",
                    className: full ? "text-foreground" : "",
                  })}
                >
                  {full ? "Join the waitlist" : "Book this date"}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function CourseFaqs({ faqs }: { faqs: CourseFaq[] }) {
  if (faqs.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">Questions divers ask</h2>
      <div className="mt-6 grid gap-2">
        {faqs.map((faq) => (
          <details
            key={faq.question}
            className="group rounded-2xl border border-border bg-surface px-5 py-4"
          >
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-medium">
              {faq.question}
              <span
                aria-hidden="true"
                className="text-muted transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 leading-relaxed text-muted">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function RelatedCourses({
  courses,
  shopSlug,
}: {
  courses: Array<Pick<Course, "id" | "title" | "slug" | "summary">>;
  shopSlug: string;
}) {
  if (courses.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">What to take next</h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {courses.map((course) => (
          <li key={course.id} className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="text-lg font-semibold">{course.title}</h3>
            {course.summary ? <p className="mt-2 text-sm text-muted">{course.summary}</p> : null}
            <Link
              href={`/shop/${shopSlug}/courses/${course.slug}`}
              className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
            >
              Learn more →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
