import type { ReactNode } from "react";
import type { Course } from "@/db/schema";
import type { DiverTranslator } from "@/i18n/messages";
import { formatScheduleDayTime } from "@/lib/courses";
import {
  formatDateWithYear,
  formatMoneyScanned,
  formatTimeRangeTz,
  formatTimeTz,
} from "@/lib/format";
import type { ShopCurrency } from "@/lib/money";
import { publicCoursePath } from "@/lib/public-routes";
import { capacityLabel } from "@/lib/trips";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import {
  type PaperShop,
  PublicPaperSheet,
  PaperRule as Rule,
} from "../../../_components/PublicPaperSheet";
import { type CourseSession, sessionLead } from "./CourseSections";

/** One date as paper states it: the year and the zone, since paper outlives the week. */
function paperSessionLine(
  session: CourseSession,
  timezone: string,
  locale: string,
  t: DiverTranslator,
): string {
  const multiDay =
    toDateInputValue(utcToWallTime(session.startsAt, timezone)) !==
    toDateInputValue(utcToWallTime(session.endsAt, timezone));
  const capacity = capacityLabel(session);
  return [
    multiDay
      ? `${formatDateWithYear(session.startsAt, locale, timezone)} – ${formatDateWithYear(session.endsAt, locale, timezone)}`
      : formatDateWithYear(session.startsAt, locale, timezone),
    multiDay
      ? t("course.startsAt", { time: formatTimeTz(session.startsAt, locale, timezone) })
      : formatTimeRangeTz(session.startsAt, session.endsAt, locale, timezone),
    capacity.kind === "full"
      ? t("fallback.full")
      : t("fallback.spotsLeft", { count: capacity.remaining }),
    sessionLead(session, locale, t),
  ]
    .filter(Boolean)
    .join(" · ");
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="font-semibold">{children}</h2>;
}

/**
 * **A course on paper** (issue #2745): what the public course page prints.
 * The page's screen (its photographs, jump links, booking buttons, the date
 * request form and the closed question disclosures) never reaches a printer;
 * this sheet is drawn under it from the same readers, so a diver who prints
 * the course carries every fact the page states: what it costs, who may
 * enroll, how it runs, what the fee covers, every upcoming date with its
 * year, zone and seats, and every question with its answer.
 *
 * A hidden course (its own staff's preview) says it is hidden, so a printed
 * preview is never mistaken for a course on sale.
 */
export function CoursePaperSheet({
  shop,
  shopSlug,
  course,
  totalCents,
  currency,
  facts,
  admission,
  sessions,
  locale,
  t,
  now,
}: {
  shop: PaperShop;
  shopSlug: string;
  course: Course;
  totalCents: number | null;
  currency: ShopCurrency;
  /** The hero's logistics ("Duration · 3 days"). */
  facts: ReadonlyArray<{ label: string; value: string }>;
  /** The page's one admission statement (`CourseAdmission`). */
  admission: ReactNode;
  sessions: readonly CourseSession[];
  locale: string;
  t: DiverTranslator;
  now: Date;
}) {
  const zone = shop.timezone;
  const paragraphs = (course.overview ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const privateAvailable = (course.privatePriceCents ?? 0) > 0;
  return (
    <PublicPaperSheet
      shop={shop}
      pageName="departure-public-course"
      identity={[shop.name, course.title]}
      path={publicCoursePath(shopSlug, course.slug)}
      locale={locale}
      t={t}
      now={now}
    >
      <p className="text-sm">{t("course.agencyCourse", { agency: course.agency.toUpperCase() })}</p>
      <h1 className="font-brand-display text-xl leading-tight font-extrabold">{course.title}</h1>
      {course.isActive ? null : <p className="mt-1 font-semibold">{t("course.hidden")}</p>}
      {course.summary ? <p className="mt-2 text-sm">{course.summary}</p> : null}
      {totalCents !== null ? (
        <p className="mt-3 text-base font-semibold tabular-nums">
          {formatMoneyScanned(totalCents, currency, locale)} {t("common.perDiver")}
        </p>
      ) : null}
      {privateAvailable ? (
        <p className="text-sm">
          {course.isIntroCourse
            ? t("course.privateSessionAvailable")
            : t("course.privateAvailable")}
        </p>
      ) : null}
      {facts.map((fact) => (
        <p key={fact.label} className="text-sm">
          {fact.label}: {fact.value}
        </p>
      ))}
      {admission}
      {paragraphs.length > 0 ? (
        <Rule>
          <Heading>{t("course.aboutHeading")}</Heading>
          {paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className="mt-2 text-sm">
              {paragraph}
            </p>
          ))}
        </Rule>
      ) : null}
      {course.scheduleDays.length > 0 || course.groupSizeText ? (
        <Rule>
          <Heading>{t("course.howItRunsHeading")}</Heading>
          {course.groupSizeText ? (
            <p className="mt-1 text-sm">
              {t("course.groupSize")}: {course.groupSizeText}
            </p>
          ) : null}
          <ol className="mt-2 space-y-2">
            {course.scheduleDays.map((day) => {
              const time = formatScheduleDayTime(day, locale);
              return (
                <li key={day.title} className="text-sm">
                  <span className="font-semibold">{day.title}</span>
                  {time ? ` · ${time}` : null}
                  {day.items.length > 0 ? (
                    <span className="block">{day.items.join(" · ")}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Rule>
      ) : null}
      {course.includes.length > 0 || course.excludes.length > 0 ? (
        <Rule>
          <Heading>{t("course.feeCovers")}</Heading>
          {course.includes.length > 0 ? (
            <p className="mt-1 text-sm">
              {t("trip.packProvided")}: {course.includes.join(" · ")}
            </p>
          ) : null}
          {course.excludes.length > 0 ? (
            <p className="mt-1 text-sm">
              {t("course.notIncludedHeading")}: {course.excludes.join(" · ")}
            </p>
          ) : null}
        </Rule>
      ) : null}
      <Rule>
        <Heading>{t("course.datesHeading")}</Heading>
        {sessions.length === 0 ? (
          <p className="mt-1 text-sm">{t("course.noDatesLead")}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {sessions.map((session) => (
              <li key={session.id} className="text-sm tabular-nums">
                {paperSessionLine(session, zone, locale, t)}
              </li>
            ))}
          </ul>
        )}
      </Rule>
      {course.faqs.length > 0 ? (
        <Rule>
          <Heading>{t("course.faqsHeading")}</Heading>
          <dl className="mt-1 space-y-2">
            {course.faqs.map((faq) => (
              <div key={faq.question} className="text-sm">
                <dt className="font-semibold">{faq.question}</dt>
                <dd>{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </Rule>
      ) : null}
    </PublicPaperSheet>
  );
}
