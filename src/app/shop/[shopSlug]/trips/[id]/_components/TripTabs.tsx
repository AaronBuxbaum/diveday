import Link from "next/link";
import { SECTION_TAB_LIST_CLASS, sectionTabClass } from "@/components/SectionTabs";
import { Badge } from "@/components/ui/badge";
import { STAGE_TONE } from "@/lib/trip-stage-tone";
import type { TripStage } from "@/lib/trip-stages";

/**
 * **A departure's four tabs** — ADR 20261001-logbook, decision 3.
 *
 * The tabs are the four kinds of work on a departure: who is coming, the roll
 * call, the gear, and the plan. Every tab is open in every stage, because a
 * crew fixing a size at the dock is doing Gear work during check-in.
 *
 * There was a fifth, Check-in, the counter. It listed the same people as
 * Divers with the same blockers and the same fixes, so the desk is a state of
 * the Divers roster now: once arrivals open, each cleared row gains its tap
 * (owner, 2026-10-05: one place per thing).
 *
 * The stage itself is one pill in the header, `TripStageBadge`: the crew's own
 * word (Boarding, Underway, Surface, Heading in, Home; `boatStageOf`), the
 * same pill Today's departure card wears and the word the manifest strip has
 * selected (UX review 2026-10-10, item 1).
 * It was a four-step stepper above these tabs, and two of its words were tab
 * names, so the page said "Check-in" twice in two rows that meant different
 * things (owner, 2026-10-05: simplify the trip page).
 *
 * A staff component takes its words as props; `staffTranslator` is
 * server-side only. `print:hidden` because the packet and the manifest both
 * print, and paper has no navigation.
 */
export const TRIP_TABS = ["divers", "boat", "gear", "details"] as const;

export type TripTab = (typeof TRIP_TABS)[number];

export type TripTabsCopy = {
  tabsLabel: string;
  tabs: Record<TripTab, string>;
  stageLabel: string;
  stages: Record<TripStage, string>;
  /**
   * "Check-in open · at the dock by 11:00 PM" (UX review 2026-10-13, item 20),
   * already worded, while `checkInOpen` holds. Said under the tabs on Divers
   * only, the desk's tab; never a stage word, never on the chip.
   */
  checkInLine?: string | null;
};

/** Where each tab lives. Every one is a page of this departure. */
export function tripTabHref(shopSlug: string, tripId: string, tab: TripTab): string {
  const root = `/shop/${shopSlug}/trips/${tripId}`;
  switch (tab) {
    case "divers":
      return root;
    case "boat":
      return `${root}/manifest`;
    case "gear":
      return `${root}/prep`;
    case "details":
      return `${root}?view=details`;
  }
}

/**
 * Where the boat is, as the crew's one word in the header's meta line — or
 * nothing, when nobody has said (`boatStageOf`). Never a word from the clock.
 */
export function TripStageBadge({
  stage,
  copy,
}: {
  stage: TripStage | null;
  copy: Pick<TripTabsCopy, "stageLabel" | "stages">;
}) {
  if (stage === null) return null;
  return (
    <Badge tone={STAGE_TONE[stage]} toneMark={false}>
      <span className="sr-only">{copy.stageLabel}: </span>
      {copy.stages[stage]}
    </Badge>
  );
}

export function TripTabs({
  shopSlug,
  tripId,
  current,
  copy,
}: {
  shopSlug: string;
  tripId: string;
  current: TripTab;
  copy: TripTabsCopy;
}) {
  return (
    <div className="print:hidden">
      {/* **Never a sideways drag** (`e2e/trips.spec.ts`): the four fit a 390px
          phone in Spanish, the longer locale, by splitting the row with
          tighter padding below `sm` rather than by scrolling. Every tab is the
          same width — the section tabs' grid. */}
      <nav aria-label={copy.tabsLabel} data-trip-tabs className="border-b border-border">
        <ul className={SECTION_TAB_LIST_CLASS}>
          {TRIP_TABS.map((tab) => {
            const active = tab === current;
            return (
              <li key={tab} className="flex">
                <Link
                  href={tripTabHref(shopSlug, tripId, tab)}
                  aria-current={active ? "page" : undefined}
                  className={`grow ${sectionTabClass(active)}`}
                >
                  <span className="min-w-0 break-words">{copy.tabs[tab]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {copy.checkInLine && current === "divers" ? (
        <p className="mt-3 text-sm text-muted tabular-nums">{copy.checkInLine}</p>
      ) : null}
    </div>
  );
}
