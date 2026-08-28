import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { DateRequestRow } from "@/db/course-inquiries";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import type { DateRequestMatch } from "@/lib/date-requests";
import { formatShortDate } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";

/**
 * Where a diver is up to, in staff words. `src/db` returns the code and this
 * picks the sentence (ADR 20260731-domain-layer-copy-leaks).
 */
const EXPERIENCE_KEYS: Record<CourseInquiryExperience, StaffMessageKey> = {
  never: "requests.experience.never",
  tried: "requests.experience.tried",
  certified: "requests.experience.certified",
  lapsed: "requests.experience.lapsed",
};

/**
 * **One request, as a ledger row** (ADR 20260827-people-not-lists, decision 5;
 * the language is 20260827-clearwater-surface-language).
 *
 * A request is a diver asking for a departure to *exist* — a
 * `course_inquiries` row (ADR 20260814-a-date-request-is-a-course-inquiry),
 * never the wait list and never a last-minute deal. So the row's job is to say
 * who asked, what for, how many of them, and why it is filed under the day it
 * is filed under; the act that answers it belongs to the day group above.
 *
 * Two things this row deliberately does not do any more:
 *
 * - **A soft match is ink, not a tint.** A second choice and a flexible
 *   neighbour used to arrive as a `bg-surface-sunken` card wearing a neutral
 *   `Badge`. Both are gone: the row says *in words* which date the diver
 *   actually named ("First choice Mar 13") and sets its ask in muted ink. A
 *   tinted fill is a second pill grammar by the back door, and a badge on a row
 *   that is only ever soft-or-firm is a state word where the group header
 *   already owns the day. `RequestLedgerRow.test.tsx` pins the absence.
 * - **It carries no status.** Nothing about a request has a state — it is a
 *   lead, and the only question is whether the shop puts a boat on that day.
 *
 * The name is the door when this lead is linked to a diver on file
 * (`personId`, resolved at capture time by exact email match and never
 * back-filled — `src/db/course-inquiries.ts`). Most requests are strangers, so
 * most rows have no door at all: a stretched row link over a list where one row
 * in four is tappable is a promise the surface cannot keep, and the row's own
 * acts — mailing them, seating them — have to stay reachable either way.
 */
export function RequestLedgerRow({
  request,
  match,
  locale,
  timezone,
  shopSlug,
  t,
}: {
  request: DateRequestRow;
  /**
   * What this request says about *this* day — a first choice, a fallback, or a
   * flexible neighbour. Null in the "no date named" group, where there is no
   * day to relate to. Decided by `groupDateRequests` (src/lib/date-requests.ts)
   * and never re-derived here.
   */
  match: DateRequestMatch | null;
  locale: string;
  timezone: string;
  shopSlug: string;
  t: StaffTranslator;
}) {
  // A second choice and a flexible neighbour are in this group because they
  // *can* make the day, not because they asked for it — so their ask sits in
  // muted ink under the firm ones.
  const soft = match === "alternate" || match === "nearby";
  // What this request *did* name, for the words that explain why it is in a
  // group it did not ask for. A request can carry an alternate and no first
  // choice, so this is the first date it holds rather than `preferredDate`.
  const namedDate = request.preferredDate ?? request.alternateDate;
  const name = request.name ?? t("requests.anonymous");
  const ask = request.courseTitle
    ? t("requests.aboutCourse", { course: request.courseTitle })
    : t("requests.aboutDive", { interest: request.interest ?? "" });

  // The row's quiet facts, in planning order: how many of them, where they are
  // up to, why they are filed here, and how long the lead has been sitting.
  const facts = [
    request.divers ? t("requests.divers", { count: request.divers }) : null,
    t(EXPERIENCE_KEYS[request.experienceLevel]),
    match === "alternate" && namedDate
      ? t("requests.alternateOf", { date: formatCalendarDate(namedDate, locale) })
      : null,
    match === "nearby" && namedDate
      ? t("requests.flexibleAround", { date: formatCalendarDate(namedDate, locale) })
      : null,
    // A request that travelled into this group already said it can move, so it
    // does not also say "Flexible".
    match !== "nearby" && request.dateFlexible ? t("requests.flexible") : null,
    t("requests.askedOn", { date: formatShortDate(request.createdAt, locale, timezone) }),
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <LedgerRow
      as="li"
      className="py-3"
      trailing={
        <Link
          href={`${shopPath(shopSlug, "bookings", "new")}?request=${encodeURIComponent(request.id)}`}
          className={buttonClass({ variant: "link", size: "sm", flush: true })}
        >
          {t("requests.createBooking")}
        </Link>
      }
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
        <p className="min-w-0 font-semibold sm:w-44 sm:shrink-0">
          {request.personId ? (
            <Link
              href={shopPath(shopSlug, "divers", request.personId)}
              className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
            >
              <span className="truncate">{name}</span>
              <DiveDayIcon name="chevron-right" className="size-4 shrink-0" />
            </Link>
          ) : (
            name
          )}
        </p>
        <div className="min-w-0 flex-1">
          <p className={soft ? "text-muted" : "font-medium"}>{ask}</p>
          <p className="mt-0.5 text-sm text-muted tabular-nums">{facts.join(" · ")}</p>
          {request.email || request.phone ? (
            <p className="mt-0.5 text-sm text-muted">
              {request.email ? (
                // **Underlined always, not on hover.** This link sits *inside*
                // a run of text — the diver's phone number beside it — where
                // colour alone is the only thing marking it as a link, and
                // `--primary` against the surrounding ink is 2.8:1, under
                // WCAG's 3:1 floor for exactly that (axe `link-in-text-block`,
                // found by the scan added in issue #1056). The booking link in
                // the row's trailing slot stands alone, so the rule does not
                // reach it and it keeps the hover underline.
                <a href={`mailto:${request.email}`} className="text-primary underline">
                  {request.email}
                </a>
              ) : null}
              {request.email && request.phone ? " · " : null}
              {request.phone}
            </p>
          ) : null}
          {request.timing ? (
            <p className="mt-1 text-sm text-muted">
              {t("requests.whenSuits", { timing: request.timing })}
            </p>
          ) : null}
          {request.message ? <p className="mt-1 text-sm text-pretty">{request.message}</p> : null}
        </div>
      </div>
    </LedgerRow>
  );
}
