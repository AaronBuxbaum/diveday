import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CalendarDate } from "@/lib/calendar-date";
import type { RequestAdvice } from "@/lib/request-advisor";

/**
 * One part of a day's advice. `warning` is the one thing the planner says that
 * is not a suggestion — more divers than the shop's largest hull holds — and it
 * carries a sentence as well as the ink, because a colour is not a state (ADR
 * 20260827-clearwater-surface-language). `-strong` rather than the raw hue for
 * the contrast reason `LedgerRow`'s kind ink documents: this line renders on
 * the page background, and the component cannot know that.
 */
export type RequestAdviceLine = { text: string; tone?: "warning" };

/**
 * The planner's answer for one day, as the sentence the group header shows.
 *
 * `adviseRequests` is untouched (`src/lib/request-advisor.ts`) — this only
 * decides which of its facts a header states. What it drops from the retired
 * "Planning suggestion" card is the head count: the group label above now
 * reads "2 groups · 5 divers", and the card's opening line said the same
 * numbers again one row below (principle 9 — the same fact at two volumes).
 * What survives is what a header cannot say on its own: which hull fits, or
 * that none does, and how many divemasters the shop's own target implies.
 */
export function requestAdviceLines(
  advice: RequestAdvice,
  diversPerDivemaster: number,
  t: StaffTranslator,
): RequestAdviceLine[] {
  const lines: RequestAdviceLine[] = [];
  if (advice.suggestedBoat) {
    lines.push({
      text: t("boats.requestBoatSuggestion", {
        boatName: advice.suggestedBoat.name,
        capacity: advice.suggestedBoat.capacity,
      }),
    });
  }
  if (advice.exceedsKnownBoats) {
    lines.push({ text: t("boats.requestBoatExceeded"), tone: "warning" });
  }
  // The half of the recommendation that survives having no boat: who needs to
  // be in the water with these people, at the shop's own target
  // (src/lib/divemaster-ratio.ts). A day nobody asked for wants nobody.
  if (advice.suggestedDivemasters > 0) {
    lines.push({
      text: t("boats.requestCrewSuggestion", {
        divemasters: advice.suggestedDivemasters,
        ratio: diversPerDivemaster,
      }),
    });
  }
  return lines;
}

/**
 * The schedule builder, opened on this day with these leads carried forward.
 *
 * The whole point of counting groups against a day: the builder opens on that
 * date with the full form already disclosed (ADR 20260806-one-trip-create-form)
 * and carries the requests forward as invitations, so "two groups could make
 * the 4th" ends in a departure on the 4th rather than a note somewhere.
 */
export function addDepartureHref(
  shopSlug: string,
  date: CalendarDate,
  requestIds: readonly string[],
): string {
  const params = new URLSearchParams({
    add: "full",
    date,
    requests: requestIds.join(","),
  });
  return `/shop/${encodeURIComponent(shopSlug)}/schedule/board?${params.toString()}`;
}

/**
 * **A day the divers asked for** (ADR 20260827-people-not-lists, decision 5).
 *
 * The group header owns every fact its rows share — the date, how many groups
 * could make it, how many divers that is, and what the planner would put on the
 * water — and the one act that answers them all. No row repeats any of it; the
 * rows underneath say only who asked and what for.
 *
 * The same component renders the "no date named" tail, which has a count and no
 * day, so no advice and no act: prose a date field could not hold is still a
 * lead, but it is not a day anyone can put a boat on.
 */
export function RequestDayGroup({
  id,
  label,
  advice = [],
  add,
  children,
}: {
  id: string;
  /** The date and the counts, as one line — the group owns them, not the rows. */
  label: string;
  advice?: readonly RequestAdviceLine[];
  /** The day's one secondary act. Omitted for the undated tail. */
  add?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <GroupLabel as="h2" id={id}>
          {label}
        </GroupLabel>
        {add ? (
          // The same words and the same glyph as the schedule board's own add
          // control (`schedule.builder.addDeparture`): one act, one name,
          // wherever a staffer meets it. The `+` is aria-hidden decoration —
          // it never enters a translated string.
          <Link href={add.href} className={buttonClass({ variant: "secondary", size: "sm" })}>
            <span aria-hidden="true">+</span>
            {add.label}
          </Link>
        ) : null}
      </div>
      {advice.length > 0 ? (
        <p className="mt-2 text-sm text-muted tabular-nums">
          {advice.map((line, index) => (
            <Fragment key={line.text}>
              {index > 0 ? " · " : null}
              <span className={line.tone === "warning" ? "text-warning-strong" : undefined}>
                {line.text}
              </span>
            </Fragment>
          ))}
        </p>
      ) : null}
      <ul className="mt-2">{children}</ul>
    </section>
  );
}
