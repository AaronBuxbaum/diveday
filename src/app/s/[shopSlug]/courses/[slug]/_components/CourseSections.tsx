import Link from "next/link";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StoredPhoto } from "@/components/StoredPhoto";
import { buttonClass } from "@/components/ui/button";
import type { Course } from "@/db/schema";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import {
  type CourseFaq,
  type CourseGalleryPhoto,
  type CourseScheduleDay,
  formatScheduleDayTime,
  resolveImageAlt,
} from "@/lib/courses";
import { formatShortDate, formatTime, formatTimeRangeTz } from "@/lib/format";
import { cachedFormatter } from "@/lib/intl-cache";
import { minorToMajor, type ShopCurrency } from "@/lib/money";
import { publicSchedulePath, publicTripPath } from "@/lib/public-routes";
import { capacityLabel, isFull } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";

/**
 * The diver-facing course page, in sections. Each renders nothing when the shop
 * left it empty, so a half-written page degrades to a shorter page rather than
 * to a row of empty headings.
 *
 * The composition is shaped like the course, not like a card pile (design
 * principle 11): the hero is the poster and carries the logistics strip, the
 * day-by-day plan is a timeline, includes read as two quiet columns, and the
 * one tinted panel on the page is the booking moment — which also holds the
 * page's one primary action (principle 8). Everything else is type, space,
 * and hairlines.
 */

/**
 * The known certification agencies' full names, for one first-mention
 * expansion on the course hero (task 5) — a newcomer meets "PADI" with no
 * idea it's an acronym, let alone what it stands for. Anything outside this
 * short list falls back to the bare code, same as before — `courses.agency` is
 * free text a shop types, so this is a lookup with a fallback and never a gate.
 *
 * **Not a mirror of the `certification_agency` enum, and it must not become
 * one.** That enum is which *card* a diver may be recorded as holding; this is
 * a word on a public sales page. DOM-L1's widening was read as licence to add
 * the new agencies here too, and the effect on the hero is a polished, official-
 * looking expansion for an agency DiveDay does nothing else for — a non-intro
 * entry-level session under RAID, GUE or BSAC still carries no in-water ratio
 * cap (`src/lib/course-ratios.ts`, PADI-only by deliberate choice). The bare
 * code is the honest fallback; growing this map is a *product* decision about
 * what the page is claiming, taken on its own terms.
 */
const AGENCY_FULL_NAME_KEYS: Record<string, DiverMessageKey> = {
  padi: "course.agencyFullNames.padi",
  ssi: "course.agencyFullNames.ssi",
  naui: "course.agencyFullNames.naui",
  sdi: "course.agencyFullNames.sdi",
  tdi: "course.agencyFullNames.tdi",
  cmas: "course.agencyFullNames.cmas",
  raid: "course.agencyFullNames.raid",
  gue: "course.agencyFullNames.gue",
};

export function CourseHero({
  course,
  totalCents,
  bookHref,
  inquiryHref,
  currency,
  locale,
  t,
  facts = [],
}: {
  course: Course;
  totalCents: number | null;
  bookHref: string | null;
  /** Anchor to "Get in touch", shown as the hero's fallback CTA when there's
   * no open session to book yet — otherwise a diver landing here has no
   * visible next step until they scroll the whole page (design/principles.md
   * #2). */
  inquiryHref?: string | null;
  /** The shop's currency — a Cozumel shop's course price is pesos, not dollars. */
  currency: ShopCurrency;
  /** The shop's locale — money and dates on a public page follow it, not the server's. */
  locale: string;
  t: DiverTranslator;
  /**
   * Logistics only (duration, group size), rendered as a quiet strip on the
   * hero's lower edge — the answers to "how long?" and "how many of us?"
   * arrive with the poster instead of a tile grid below it. Admission facts
   * (the cert gate, the minimum age) stay in CourseAdmission, which is the
   * one place a diver reads them.
   */
  facts?: Array<{ label: string; value: string }>;
}) {
  // Whole major units: a hero price reads as a headline, and the trailing
  // ".00" is noise. `minorToMajor` (not a literal 100) is what keeps a
  // ¥48,000 course from rendering as ¥480.
  const money = cachedFormatter("num", Intl.NumberFormat, locale, {
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
          {/* Secondary on purpose: this is in-page navigation, not the
              commitment itself. The page's one primary is the next date's
              "Book this date" inside CourseSessions (principle 8). */}
          {bookHref ? (
            <Link href={bookHref} className={buttonClass({ variant: "secondary", size: "cta" })}>
              {t("course.seeDates")}
            </Link>
          ) : inquiryHref ? (
            <Link href={inquiryHref} className={buttonClass({ variant: "secondary", size: "cta" })}>
              {t("course.askAboutDates")}
            </Link>
          ) : null}
        </div>
      </div>
      {facts.length > 0 ? (
        <dl
          aria-label={t("course.atAGlance")}
          className="flex flex-wrap gap-x-10 gap-y-3 border-t border-border bg-surface-sunken/60 px-6 py-4 sm:px-8"
        >
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
                {fact.label}
              </dt>
              <dd className="mt-0.5 text-sm font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * The single home for who may enroll. Admission used to be stated twice — a
 * "Prerequisite" chip in the spec row and again here — which is duplication a
 * shop can only get wrong: the two drift, and a diver reads whichever suits.
 *
 * One type-led line now, no card: the agency's gate (and the minimum age when
 * there is one) in the foreground, and the shop's own prose labelled as the
 * shop talking. The two kinds of claim stay visibly distinct — which is how a
 * diver is kept from believing shop prose ("or a qualifying certification…")
 * overrides the card the desk will actually check.
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
    <section aria-labelledby="who-can-enroll" className="mt-8 max-w-2xl">
      <h2 id="who-can-enroll" className="text-xs font-semibold tracking-wide text-muted uppercase">
        {t("course.whoCanEnroll")}
      </h2>
      <p className="mt-1.5 text-lg font-medium">
        {certificationRequired}
        {minimumAge ? (
          <>
            <span aria-hidden="true" className="text-muted">
              {" "}
              ·{" "}
            </span>
            {t("course.agesAndUp", { age: minimumAge })}
          </>
        ) : null}
      </p>
      {shopNote ? (
        <>
          <h3 className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">
            {t("course.fromTheShop")}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">{shopNote}</p>
        </>
      ) : null}
    </section>
  );
}

export function CourseOverview({ overview, t }: { overview: string | null; t: DiverTranslator }) {
  if (!overview?.trim()) return null;
  return (
    <section id="about" aria-labelledby="about-heading" className="mt-12 max-w-2xl scroll-mt-8">
      <h2 id="about-heading" className="text-2xl font-semibold tracking-tight">
        {t("course.aboutHeading")}
      </h2>
      {overview
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => (
          <p key={paragraph.slice(0, 40)} className="mt-4 leading-relaxed">
            {paragraph}
          </p>
        ))}
    </section>
  );
}

/**
 * The day-by-day plan as a timeline the eye can walk — a rail of hollow dots
 * down the left, one node per day — rather than a stack of bordered cards
 * that all weighed the same. The shape *is* the information: a three-day
 * course looks like three steps on one path.
 */
export function CourseSchedule({
  days,
  locale,
  t,
}: {
  days: CourseScheduleDay[];
  /** The negotiated request locale — a clock time reads "14:00" or "2:00 PM" by it, never by the server's. */
  locale: string;
  t: DiverTranslator;
}) {
  if (days.length === 0) return null;
  return (
    <section id="how-it-runs" className="mt-14 scroll-mt-8">
      <h2 className="text-2xl font-semibold tracking-tight">{t("course.howItRunsHeading")}</h2>
      <ol className="relative mt-8 max-w-3xl">
        {/* The rail. Dots are hollow (surface-filled) so the line reads as
            passing behind them. Purely decorative — the ordered list already
            carries the sequence for a screen reader. */}
        <span aria-hidden="true" className="absolute top-2 bottom-2 left-[5px] w-px bg-border" />
        {days.map((day) => {
          const time = formatScheduleDayTime(day, locale);
          return (
            <li key={day.title} className="relative pb-10 pl-8 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-primary bg-surface"
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-lg font-semibold">{day.title}</h3>
                {time ? <p className="text-sm tabular-nums text-muted">{time}</p> : null}
              </div>
              {day.items.length > 0 ? (
                <ul className="mt-2 grid gap-1.5 text-sm text-muted">
                  {day.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
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
    <section id="included" className="mt-14 scroll-mt-8">
      <h2 className="text-2xl font-semibold tracking-tight">{t("course.feeCovers")}</h2>
      {/* Two quiet columns, no boxes — the ✓ and – glyphs carry the split, and
          the muted ink on the right keeps "not included" from competing with
          what the diver is actually buying. */}
      <div className="mt-6 grid max-w-3xl gap-x-12 gap-y-8 sm:grid-cols-2">
        {includes.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-success uppercase">
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
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
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
  photos,
  title,
  t,
}: {
  /** Each photo carries its own caption; a blank one falls back to a generated caption. */
  photos: CourseGalleryPhoto[];
  title: string;
  t: DiverTranslator;
}) {
  if (photos.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="sr-only">{t("course.galleryHeading", { course: title })}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map(({ url, alt }, index) => (
          <StoredPhoto
            key={url}
            src={url}
            // The hero photo claims "photo 1"; gallery photos continue from 2.
            alt={resolveImageAlt(
              alt,
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

/** One session's dates/time/seats, shared by the featured row and the compact list. */
function sessionFacts(
  session: { startsAt: Date; endsAt: Date; capacity: number; booked: number },
  timezone: string,
  locale: string,
  t: DiverTranslator,
) {
  // A course typically runs across days, and rendering a three-day course as
  // "Wed, Jul 29 · 8:00 AM – 5:00 PM" hides two of them. Show the span when
  // the session ends on a later local day.
  const startDay = toDateInputValue(utcToWallTime(session.startsAt, timezone));
  const endDay = toDateInputValue(utcToWallTime(session.endsAt, timezone));
  const multiDay = startDay !== endDay;
  const capacityLabelValue = capacityLabel(session);
  return {
    dates: multiDay
      ? `${formatShortDate(session.startsAt, locale, timezone)} – ${formatShortDate(session.endsAt, locale, timezone)}`
      : formatShortDate(session.startsAt, locale, timezone),
    time: multiDay
      ? t("course.startsAt", { time: formatTime(session.startsAt, locale, timezone) })
      : formatTimeRangeTz(session.startsAt, session.endsAt, locale, timezone),
    capacity:
      capacityLabelValue.kind === "full"
        ? t("fallback.full")
        : t("fallback.spotsLeft", { count: capacityLabelValue.remaining }),
  };
}

/**
 * The booking moment — the one tinted panel on the page, so the eye lands
 * here from anywhere in the scroll. It leads with the *next* date (the answer
 * a diver actually came for, principle 10) and that date's button is the
 * page's one primary; later dates are compact hairline rows beneath it.
 *
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
  const [next, ...later] = sessions;
  return (
    <section id="dates" className="mt-14 scroll-mt-8">
      <div className="rounded-3xl border border-primary/15 bg-primary/5 p-6 sm:p-8">
        <h2 className="text-2xl font-semibold tracking-tight">{t("course.datesHeading")}</h2>
        {!next ? (
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
          <>
            {(() => {
              const facts = sessionFacts(next, timezone, locale, t);
              const full = isFull(next);
              return (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-wide text-primary uppercase">
                      {t("course.nextDate")}
                    </p>
                    <p className="mt-1 text-xl font-semibold">{facts.dates}</p>
                    <p className="mt-1 text-sm text-muted">
                      {facts.time} · {facts.capacity}
                    </p>
                  </div>
                  <Link
                    href={publicTripPath(shopSlug, next.id)}
                    className={buttonClass({
                      variant: full ? "secondary" : "primary",
                      size: "cta",
                      className: full ? "text-foreground" : "",
                    })}
                  >
                    {full ? t("course.joinWaitList") : t("course.bookThisDate")}
                  </Link>
                </div>
              );
            })()}
            {later.length > 0 ? (
              <div className="mt-8">
                <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                  {t("course.moreDates")}
                </h3>
                <ul className="mt-1 divide-y divide-border">
                  {later.map((session) => {
                    const facts = sessionFacts(session, timezone, locale, t);
                    const full = isFull(session);
                    return (
                      <li
                        key={session.id}
                        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">{facts.dates}</p>
                          <p className="mt-0.5 text-sm text-muted">
                            {facts.time} · {facts.capacity}
                          </p>
                        </div>
                        <Link
                          href={publicTripPath(shopSlug, session.id)}
                          className={buttonClass({
                            variant: "secondary",
                            size: "sm",
                            className: full ? "text-foreground" : "",
                          })}
                        >
                          {full ? t("course.joinWaitList") : t("course.bookThisDate")}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

export function CourseFaqs({ faqs, t }: { faqs: CourseFaq[]; t: DiverTranslator }) {
  if (faqs.length === 0) return null;
  return (
    <section id="faqs" className="mt-14 max-w-3xl scroll-mt-8">
      <h2 className="text-2xl font-semibold tracking-tight">{t("course.faqsHeading")}</h2>
      {/* Quiet disclosures on hairlines — a question list is a list, not a
          stack of cards; the borders that survive are the ones that separate. */}
      <div className="mt-4 divide-y divide-border border-y border-border">
        {faqs.map((faq) => (
          <details key={faq.question} className="group">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 py-3 font-medium">
              {faq.question}
              <span
                aria-hidden="true"
                className="text-muted transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="pb-4 leading-relaxed text-muted">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
