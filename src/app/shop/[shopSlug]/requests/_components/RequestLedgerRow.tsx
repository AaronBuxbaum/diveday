import Link from "next/link";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { DateRequestRow } from "@/db/course-inquiries";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import { displayStoredPhone } from "@/lib/forgiving-fields";
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
 * **This is the request's one full rendering.** A request lands in every group
 * it could make — first choice, fallback, and every day a flexible one can
 * travel to — and it used to be printed whole under each of them; five divers
 * each appeared twice on one screen with identical four-line bodies. The full
 * record renders under `homeDate` (`src/lib/date-requests.ts`) and every other
 * group gets a one-line `RequestReferenceRow` pointing here, which is why this
 * row no longer has a soft state: it is only ever the day the diver named.
 *
 * Two things this row deliberately does not do:
 *
 * - **No tint and no pill.** A second choice used to arrive as a
 *   `bg-surface-sunken` card wearing a neutral `Badge`. A tinted fill is a
 *   second pill grammar by the back door, and a badge on a row that is only
 *   ever a lead is a state word where the group header already owns the day.
 *   `RequestLedgerRow.test.tsx` pins the absence.
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
  locale,
  timezone,
  shopSlug,
  t,
}: {
  request: DateRequestRow;
  locale: string;
  timezone: string;
  shopSlug: string;
  t: StaffTranslator;
}) {
  const name = request.name ?? t("requests.anonymous");
  const ask = request.courseTitle
    ? t("requests.aboutCourse", { course: request.courseTitle })
    : t("requests.aboutDive", { interest: request.interest ?? "" });

  // The row's quiet facts, in planning order: how many of them, where they are
  // up to, why they are filed here, and how long the lead has been sitting.
  const experienceFact = request.experienceLevel
    ? t(EXPERIENCE_KEYS[request.experienceLevel])
    : null;
  const facts = [
    request.divers ? t("requests.divers", { count: request.divers }) : null,
    experienceFact,
    request.dateFlexible ? t("requests.flexible") : null,
    t("requests.askedOn", { date: formatShortDate(request.createdAt, locale, timezone) }),
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <LedgerRow
      as="li"
      pad="lg"
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
          <p className="font-medium">{ask}</p>
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
              {/* A request's number is the diver's own typing, not a
                  normalised `people.phone`, so this mostly hands back exactly
                  what they wrote — it groups the one shape that would
                  otherwise arrive here as an unbroken run, a diver who typed
                  E.164 into the public form. */}
              {displayStoredPhone(request.phone)}
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
