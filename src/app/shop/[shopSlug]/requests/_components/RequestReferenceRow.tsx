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
 * and every other group it reaches gets this: who, how many, and a link up to
 * where the rest of it is. One line, because everything else on it would be a
 * second copy of something already on the page (principle 9).
 *
 * The link is a fragment on this same page — the group headings carry
 * `id="date-<date>"` — so following it is a scroll rather than a navigation,
 * and the day a staffer was considering is still one flick away.
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
  /** The group holding the full record, and this row's link target. */
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
      <div className="min-w-0">
        <p className="text-sm text-muted">
          <span className="font-medium">{name}</span>
          {request.partySize ? ` · ${t("requests.divers", { count: request.partySize })}` : null}
          {" · "}
          {/* **Underlined always, not on hover.** The link sits inside a run of
            text — the name and the head count beside it — where colour alone
            is the only thing marking it, and `--primary` against the
            surrounding ink is under WCAG's 3:1 floor for exactly that (axe
            `link-in-text-block`, the same rule the full row's mailto keeps). */}
          <Link href={`#date-${homeDate}`} className="text-primary underline">
            {/* A second choice *asked for* the other day; a flexible neighbour
              never named this one at all, so it keeps the words the full row
              uses for the same fact. */}
            {match === "alternate"
              ? t("requests.alternateOf", { date })
              : t("requests.flexibleAround", { date })}
          </Link>
        </p>
        {openDeparture ? (
          <Link
            href={openDeparture.href}
            className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
          >
            {openDeparture.label}
          </Link>
        ) : null}
      </div>
    </LedgerRow>
  );
}
