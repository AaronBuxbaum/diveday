import Link from "next/link";
import { TRIP_PHASES, type TripPhase } from "@/lib/trip-phase";

/**
 * **A departure's five tabs, under the stage it is in** — ADR 20261001-logbook,
 * decision 3.
 *
 * The stepper says where the departure is in its day (Prep, Check-in, Aboard,
 * Back; `tripPhaseOf`), and the tabs are the five kinds of work on it: who is
 * coming, the counter, the roll call, the gear, and the plan. The stepper is
 * orientation only. Every tab is open in every phase, because a crew fixing a
 * size at the dock is doing Gear work during Check-in.
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

/** Where each tab lives. Check-in is the day's counter, opened on this departure. */
export function tripTabHref(shopSlug: string, tripId: string, tab: TripTab): string {
  const root = `/shop/${shopSlug}/trips/${tripId}`;
  switch (tab) {
    case "divers":
      return root;
    case "checkin":
      return `/shop/${shopSlug}/check-in?trip=${tripId}`;
    case "boat":
      return `${root}/manifest`;
    case "gear":
      return `${root}/prep`;
    case "details":
      return `${root}?view=details`;
  }
}

export function TripTabs({
  shopSlug,
  tripId,
  current,
  phase,
  copy,
}: {
  shopSlug: string;
  tripId: string;
  current: TripTab;
  /** Null for a cancelled departure, which draws no stepper. */
  phase: TripPhase | null;
  copy: TripTabsCopy;
}) {
  const reached = phase === null ? -1 : TRIP_PHASES.indexOf(phase);
  return (
    <div className="space-y-4 print:hidden">
      {phase === null ? null : (
        <ol
          aria-label={copy.phaseLabel}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        >
          {TRIP_PHASES.map((step, index) => {
            const isCurrent = index === reached;
            const done = index < reached;
            return (
              <li key={step} className="flex items-center gap-2">
                {index > 0 ? (
                  <span aria-hidden className="h-px w-4 bg-border-strong sm:w-8" />
                ) : null}
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={
                    isCurrent
                      ? "rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground"
                      : done
                        ? "px-1 py-1 text-foreground"
                        : "px-1 py-1 text-muted"
                  }
                >
                  {copy.phases[step]}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {/* **Never a sideways drag** (`e2e/trips.spec.ts`): the five fit a 390px
          phone in Spanish, the longer locale, by spreading across the row with
          tighter padding below `sm` rather than by scrolling. */}
      <nav aria-label={copy.tabsLabel} data-trip-tabs>
        <ul className="flex justify-between border-b border-border sm:justify-start sm:gap-1">
          {TRIP_TABS.map((tab) => {
            const active = tab === current;
            return (
              <li key={tab}>
                <Link
                  href={tripTabHref(shopSlug, tripId, tab)}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-2 text-sm font-medium sm:px-3 ${
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted hover:text-foreground"
                  }`}
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
