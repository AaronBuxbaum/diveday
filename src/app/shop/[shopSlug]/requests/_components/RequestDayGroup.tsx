import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { tapTargetLinkClass } from "@/components/ui/button";
import { GroupLabel } from "@/components/ui/group-label";
import type { StaffTranslator } from "@/i18n/staff-messages";
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
 * **A day the divers asked for** (ADR 20260827-people-not-lists, decision 5).
 *
 * The group header owns every fact its rows share — the date, how many groups
 * could make it, how many divers that is, and what the planner would put on the
 * water. No row repeats any of it; the rows underneath say who asked, what for,
 * and carry the one act, "Open a departure for this date" (visual review A23).
 *
 * The same component renders the "no date named" tail, which has a count and no
 * day, so no advice: prose a date field could not hold is still a
 * interest, but it is not a day anyone can put a boat on.
 *
 * `advice` is empty on a day whose planner sentence is word for word the one
 * above it — the page decides that, because only the page can see the group
 * before this one.
 */
export function RequestDayGroup({
  id,
  label,
  advice = [],
  onBoard = [],
  children,
}: {
  id: string;
  /** The date and the counts, as one line — the group owns them, not the rows. */
  label: string;
  advice?: readonly RequestAdviceLine[];
  /**
   * Departures already on the board for this day, each a link to its
   * `#who-wants-in` (ADR 20261017-one-interest-with-a-scope).
   */
  onBoard?: readonly { href: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <GroupLabel as="h2" id={id}>
        {label}
      </GroupLabel>
      {/* Planning advice is a desk job: below `sm` it shows only when it
          carries a warning (no hull holds the group), and otherwise leaves
          the phone the people and what they asked for. */}
      {advice.length > 0 ? (
        <p
          className={`mt-2 text-sm text-muted tabular-nums ${
            advice.some((line) => line.tone === "warning") ? "" : "max-sm:hidden"
          }`}
        >
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
      {onBoard.length > 0 ? (
        <ul className="mt-2 text-sm tabular-nums">
          {onBoard.map((departure) => (
            <li key={departure.href}>
              <Link
                href={departure.href}
                className={`${tapTargetLinkClass} underline underline-offset-2`}
              >
                {departure.label}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="mt-2">{children}</ul>
    </section>
  );
}
