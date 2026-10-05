import Link from "next/link";
import { SECTION_TAB_LIST_CLASS, sectionTabClass } from "@/components/SectionTabs";
import { Badge } from "@/components/ui/badge";
import type { TripPhase } from "@/lib/trip-phase";

/**
 * **A departure's five tabs** — ADR 20261001-logbook, decision 3.
 *
 * The tabs are the five kinds of work on a departure: who is coming, the
 * counter, the roll call, the gear, and the plan. Every tab is open in every
 * stage, because a crew fixing a size at the dock is doing Gear work during
 * Check-in.
 *
 * The stage itself (Prep, Check-in, Aboard, Back; `tripPhaseOf`) is one pill
 * in the header, `TripStageBadge`, the same pill Today's departure card wears.
 * It was a four-step stepper above these tabs, and two of its words were tab
 * names, so the page said "Check-in" twice in two rows that meant different
 * things (owner, 2026-10-05: simplify the trip page).
 *
 * A staff component takes its words as props; `staffTranslator` is
 * server-side only. `print:hidden` because the packet and the manifest both
 * print, and paper has no navigation.
 */
export const TRIP_TABS = ["divers", "checkin", "boat", "gear", "details"] as const;

export type TripTab = (typeof TRIP_TABS)[number];

export type TripTabsCopy = {
  tabsLabel: string;
  tabs: Record<TripTab, string>;
  phaseLabel: string;
  phases: Record<TripPhase, string>;
};

/** Where each tab lives. Every one is a page of this departure. */
export function tripTabHref(shopSlug: string, tripId: string, tab: TripTab): string {
  const root = `/shop/${shopSlug}/trips/${tripId}`;
  switch (tab) {
    case "divers":
      return root;
    case "checkin":
      return `${root}/check-in`;
    case "boat":
      return `${root}/manifest`;
    case "gear":
      return `${root}/prep`;
    case "details":
      return `${root}?view=details`;
  }
}

/** Where the departure is in its day, as one word in the header's meta line. */
export function TripStageBadge({ phase, copy }: { phase: TripPhase | null; copy: TripTabsCopy }) {
  if (phase === null) return null;
  return (
    <Badge tone="neutral" toneMark={false}>
      <span className="sr-only">{copy.phaseLabel}: </span>
      {copy.phases[phase]}
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
      {/* **Never a sideways drag** (`e2e/trips.spec.ts`): the five fit a 390px
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
                  {copy.tabs[tab]}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
