import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { DateInterestRow } from "@/db/interest-dates";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import type { DateRequestMatch } from "@/lib/date-requests";

/**
 * **The same request, seen from a day it did not ask for first.**
 *
 * A request lands in every group it could make — its first choice, its
 * alternative, and every day a flexible one can travel to. That is the whole
 * point of the grouping, and it used to mean the same four-line body printed
 * under each of them: five divers each appeared twice on one screen, identical
 * down to the phone number, and a staffer reading the page top to bottom could
 * not tell thirteen interests from five.
 *
 * So the full record renders once, under `homeDate` (`src/lib/date-requests.ts`),
 * and every other group it reaches gets this: who, how many, and which day
 * holds the rest of it, named in words (that day is a heading on this page,
 * and the page has one link idiom, the row act; A23). One line, because
 * everything else on it would be a second copy of something already on the
 * page (principle 9).
 */
export function RequestReferenceRow({
  request,
  match,
  homeDate,
  locale,
  openDeparture,
  t,
}: {
  request: DateInterestRow;
  /** Never `preferred`: a first choice is where the full record renders. */
  match: Exclude<DateRequestMatch, "preferred">;
  /** The group holding the full record, named on the row. */
  homeDate: CalendarDate;
  locale: string;
  /**
   * The day's one act, the same on every request it answers (visual review
   * A23), so a day reached only by second choices and flexible neighbours
   * still has a door (layer 3 review, run B, item 1). Absent for a reader
   * the schedule builder refuses.
   */
  openDeparture?: { href: string; label: string };
  t: StaffTranslator;
}) {
  const name = request.name ?? t("requests.anonymous");
  const date = formatCalendarDate(homeDate, locale);
  return (
    <LedgerRow as="li">
      {/* One line from `sm`: the words, then the day's act at the end of the
          same line; a phone wraps the act under them (visual review
          2026-10-24, A23). */}
      <div className="flex min-w-0 flex-col items-start gap-x-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm text-muted">
          <span className="font-medium">{name}</span>
          {request.partySize ? ` · ${t("requests.divers", { count: request.partySize })}` : null}
          {" · "}
          {/* Plain words, not a link (A23): "First choice …" labels the
            request, and the day it names is a heading on this same page. A
            second choice *asked for* the other day; a flexible neighbour
            never named this one at all, so it keeps the words the full row
            uses for the same fact. */}
          {match === "alternate"
            ? t("requests.alternateOf", { date })
            : t("requests.flexibleAround", { date })}
        </p>
        {openDeparture ? (
          <Link
            href={openDeparture.href}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {openDeparture.label}
          </Link>
        ) : null}
      </div>
    </LedgerRow>
  );
}
