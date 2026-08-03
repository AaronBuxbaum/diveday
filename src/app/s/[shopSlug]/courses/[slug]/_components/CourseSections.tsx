import Link from "next/link";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StoredPhoto } from "@/components/StoredPhoto";
import { buttonClass } from "@/components/ui/button";
import type { Course } from "@/db/schema";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import {
  type CourseFaq,
  type CourseScheduleDay,
  formatScheduleDayTime,
  resolveImageAlt,
} from "@/lib/courses";
import { formatShortDate, formatTime, formatTimeRangeTz } from "@/lib/format";
import { minorToMajor, type ShopCurrency } from "@/lib/money";
import { publicCoursePath, publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { capacityLabel, isFull } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";

/**
 * The diver-facing course page, in sections. Each renders nothing when the shop
 * left it empty, so a half-written page degrades to a shorter page rather than
 * to a row of empty headings.
 */

/** One of the shop's certification paths, flattened for the trail below. */
export type PathTrail = {
  slug: string;
  title: string;
  summary: string | null;
  steps: Array<{ id: string; title: string; slug: string }>;
};

/**
 * The known certification agencies' full names, for one first-mention
 * expansion on the course hero (task 5) — a newcomer meets "PADI" with no
 * idea it's an acronym, let alone what it stands for. Anything outside this
 * short, shop-typed list (src/app/shop/[shopSlug]/divers/[personId]/actions.ts
 * has the same enum) falls back to the bare code, same as before.
 */
const AGENCY_FULL_NAME_KEYS: Record<string, DiverMessageKey> = {
  padi: "course.agencyFullNames.padi",
  ssi: "course.agencyFullNames.ssi",
  naui: "course.agencyFullNames.naui",
  sdi: "course.agencyFullNames.sdi",
  tdi: "course.agencyFullNames.tdi",
};

export function CourseHero({
  course,
  totalCents,
  bookHref,
  inquiryHref,
  currency,
  locale,
  t,
}: {
  course: Course;
  totalCents: number | null;
  bookHref: string | null;
  /** Anchor to "Get in touch", shown as the hero's fallback CTA when there's
   * no open session to book yet — otherwise a diver landing here has no
   * visible next step until they scroll past specs, admission, overview,
   * gallery, and the schedule (design/principles.md #2). */
  inquiryHref?: string | null;
  /** The shop's currency — a Cozumel shop's course price is pesos, not dollars. */
  currency: ShopCurrency;
  /** The shop's locale — money and dates on a public page follow it, not the server's. */
  locale: string;
  t: DiverTranslator;
}) {
  // Whole major units: a hero price reads as a headline, and the trailing
  // ".00" is noise. `minorToMajor` (not a literal 100) is what keeps a
  // ¥48,000 course from rendering as ¥480.
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  });
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
      {course.heroImageUrl ? (
        <StoredPhoto
          src={course.heroImageUrl}
          alt={resolveImageAlt(
            course.heroImageAlt,
            t("course.photoAltFallback", { course: course.title, n: 1 }),
          )}
          className="h-56 w-full sm:h-80"
          sizes="(min-width: 896px) 896px, 100vw"
        />
      ) : null}
      <div className="p-6 sm:p-8">
        <ShopPageHeader
          eyebrow={t("course.agencyCourse", {
            // First mention on the page expands the acronym (task 5) — "PADI"
            // means nothing to a diver who has never heard of a certification
            // agency; an unrecognized/shop-typed-"other" agency falls back to
            // the bare code, same as before this.
            agency: AGENCY_FULL_NAME_KEYS[course.agency]
              ? t(AGENCY_FULL_NAME_KEYS[course.agency])
              : course.agency.toUpperCase(),
          })}
          title={course.title}
          description={course.summary ?? undefined}
        />
        <div className="flex flex-wrap items-center gap-4">
          {totalCents === null ? null : (
            <p className="text-2xl font-semibold tabular-nums">
              {money.format(minorToMajor(totalCents, currency))}
              <span className="ml-2 text-sm font-normal text-muted">{t("common.perDiver")}</span>
            </p>
          )}
          {bookHref ? (
            <Link href={bookHref} className={buttonClass({ size: "cta" })}>
              {t("course.seeDates")}
            </Link>
          ) : inquiryHref ? (
            <Link href={inquiryHref} className={buttonClass({ variant: "secondary", size: "cta" })}>
              {t("course.askAboutDates")}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * How the course runs, not who may take it. Admission facts (the cert gate, the
 * minimum age, the shop's own note) all live in CourseAdmission below, so a
 * diver has exactly one place to read the answer to "can I do this?".
 */
export function CourseSpecs({
  items,
  label,
}: {
  items: Array<{ label: string; value: string }>;
  label: string;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={label} className="mt-8 max-w-2xl">
      <dl className="grid grid-cols-2 gap-3">
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
 * The single home for who may enroll. Admission used to be stated twice — a
 * "Prerequisite" chip in the spec row and again here — which is duplication a
 * shop can only get wrong: the two drift, and a diver reads whichever suits.
 *
 * What the two-block layout was protecting is kept, because it is the part that
 * matters: the agency's certification gate and the shop's own note are
 * different kinds of claim, and an unlabelled paragraph under a heading reading
 * "Prerequisite" reads as one continuous sentence — which is how a diver ends
 * up believing shop prose ("or a qualifying certification…") overrides the card
 * the desk will actually check. So the gate is a labelled term in the
 * foreground, and the note is labelled as the shop talking.
 */
export function CourseAdmission({
  certificationRequired,
  minimumAge,
  shopNote,
  t,
}: {
  certificationRequired: string;
  minimumAge: number | null;
  shopNote: string | null;
  t: DiverTranslator;
}) {
  return (
    <section
      aria-labelledby="who-can-enroll"
      className="mt-6 max-w-2xl rounded-2xl border border-border bg-surface-sunken p-5"
    >
      <h2 id="who-can-enroll" className="text-sm font-semibold tracking-wide text-muted uppercase">
        {t("course.whoCanEnroll")}
      </h2>
      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
            {t("course.certification")}
          </dt>
          <dd className="mt-1 font-semibold">{certificationRequired}</dd>
        </div>
        {minimumAge ? (
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
              {t("course.minimumAge")}
            </dt>
            <dd className="mt-1 font-semibold">
              {t("course.minimumAgeYears", { age: minimumAge })}
            </dd>
          </div>
        ) : null}
      </dl>
      {shopNote ? (
        <>
          <h3 className="mt-4 text-sm font-semibold tracking-wide text-muted uppercase">
            {t("course.fromTheShop")}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">{shopNote}</p>
        </>
      ) : null}
    </section>
  );
}

/**
 * Where this course sits in the shop's own certification paths, and what comes
 * next on each. Renders nothing when the shop has not put this course on a path
 * — a diver reading a standalone specialty should not see an empty "your path"
 * heading (docs/design/principles.md).
 *
 * The rung the diver is reading is marked but not linked; every other rung is,
 * so the section works as navigation through the progression.
 */
export function CoursePathTrail({
  paths,
  courseId,
  shopSlug,
  t,
}: {
  paths: PathTrail[];
  courseId: string;
  shopSlug: string;
  t: DiverTranslator;
}) {
  const withCourse = paths.filter((path) => path.steps.some((step) => step.id === courseId));
  if (withCourse.length === 0) return null;

  return (
    <section aria-labelledby="course-paths" className="mt-10 max-w-2xl">
      <h2 id="course-paths" className="text-lg font-semibold">
        {t("path.sectionTitle")}
      </h2>
      <div className="mt-4 grid gap-4">
        {withCourse.map((path) => {
          const index = path.steps.findIndex((step) => step.id === courseId);
          const next = path.steps[index + 1];
          return (
            <article key={path.slug} className="rounded-2xl border border-border bg-surface p-5">
              <h3 className="font-semibold">{path.title}</h3>
              {path.summary ? <p className="mt-1 text-sm text-muted">{path.summary}</p> : null}
              <ol className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
                {path.steps.map((step, stepIndex) => (
                  <li key={step.id} className="flex items-center gap-1">
                    {stepIndex > 0 ? (
                      <span aria-hidden="true" className="text-muted">
                        {" → "}
                      </span>
                    ) : null}
                    {step.id === courseId ? (
                      <span aria-current="step" className="font-semibold text-primary">
                        {step.title}
                      </span>
                    ) : (
                      <Link
                        href={publicCoursePath(shopSlug, step.slug)}
                        className="hover:underline"
                      >
                        {step.title}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-sm text-muted">
                {next
                  ? t("path.nextUp", { course: next.title })
                  : t("path.lastStep", { path: path.title })}
              </p>
            </article>
          );
        })}
      </div>
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

export function CourseSchedule({ days, t }: { days: CourseScheduleDay[]; t: DiverTranslator }) {
  if (days.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">{t("course.howItRunsHeading")}</h2>
      <ol className="mt-6 grid gap-4">
        {days.map((day) => (
          <li key={day.title} className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold">{day.title}</h3>
              {formatScheduleDayTime(day) ? (
                <p className="text-sm tabular-nums text-muted">{formatScheduleDayTime(day)}</p>
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

export function CourseIncludes({
  includes,
  excludes,
  t,
}: {
  includes: string[];
  excludes: string[];
  t: DiverTranslator;
}) {
  if (includes.length === 0 && excludes.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">{t("course.feeCovers")}</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {includes.length > 0 ? (
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="text-sm font-semibold tracking-wide text-success uppercase">
              {t("trip.packProvided")}
            </h3>
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
              {t("course.notIncludedHeading")}
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

export function CourseGallery({
  imageUrls,
  imageAlts,
  title,
  t,
}: {
  imageUrls: string[];
  /** Parallel to `imageUrls`; a blank entry falls back to a generated caption. */
  imageAlts: string[];
  title: string;
  t: DiverTranslator;
}) {
  if (imageUrls.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="sr-only">{t("course.galleryHeading", { course: title })}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {imageUrls.map((url, index) => (
          <StoredPhoto
            key={url}
            src={url}
            // The hero photo claims "photo 1"; gallery photos continue from 2.
            alt={resolveImageAlt(
              imageAlts[index],
              t("course.photoAltFallback", { course: title, n: index + 2 }),
            )}
            className="h-40 w-full rounded-2xl border border-border sm:h-48"
            sizes="(min-width: 640px) 33vw, 50vw"
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
  locale,
  inquiryHref,
  t,
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
  locale: string;
  /** Anchor to the "Get in touch" composer, or null when the shop published no address. */
  inquiryHref: string | null;
  t: DiverTranslator;
}) {
  return (
    <section id="dates" className="mt-12 scroll-mt-8">
      <h2 className="text-2xl font-semibold tracking-tight">{t("course.datesHeading")}</h2>
      {sessions.length === 0 ? (
        <p className="mt-4 max-w-2xl text-muted">
          {t("course.noDatesLead")}{" "}
          <Link
            href={publicSchedulePath(shopSlug)}
            className="font-medium text-primary hover:underline"
          >
            {t("course.seeFullSchedule")}
          </Link>
          {inquiryHref ? (
            <>
              , or{" "}
              <Link href={inquiryHref} className="font-medium text-primary hover:underline">
                {t("course.orAskUs")}
              </Link>
              .
            </>
          ) : (
            ` ${t("course.orGetInTouch")}`
          )}
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
            const capacityLabelValue = capacityLabel(session);
            const capacityText =
              capacityLabelValue.kind === "full"
                ? t("fallback.full")
                : t("fallback.spotsLeft", { count: capacityLabelValue.remaining });
            return (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5"
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {formatShortDate(session.startsAt, locale, timezone)}
                    {multiDay ? ` – ${formatShortDate(session.endsAt, locale, timezone)}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {multiDay
                      ? t("course.startsAt", {
                          time: formatTime(session.startsAt, locale, timezone),
                        })
                      : formatTimeRangeTz(session.startsAt, session.endsAt, locale, timezone)}{" "}
                    · {capacityText}
                  </p>
                </div>
                <Link
                  href={publicTripPath(shopSlug, session.id)}
                  className={buttonClass({
                    variant: full ? "secondary" : "primary",
                    className: full ? "text-foreground" : "",
                  })}
                >
                  {full ? t("course.joinWaitList") : t("course.bookThisDate")}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function CourseFaqs({ faqs, t }: { faqs: CourseFaq[]; t: DiverTranslator }) {
  if (faqs.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">{t("course.faqsHeading")}</h2>
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
