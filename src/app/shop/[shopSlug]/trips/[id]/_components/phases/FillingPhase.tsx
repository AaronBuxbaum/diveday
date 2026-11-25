import type { ReactNode } from "react";

/**
 * **Filling** (ADR 20261117-trip-page-clock): the owner's phase, until the day
 * before. Under the sentence and the trip's facts line (`PhaseHeading`), in
 * the order the desk asks: who is on the trip and what each still owes, then
 * the ways to fill a seat (`TripRosterContent` lays them out).
 */
export function FillingPhase({ guests }: { guests: ReactNode }) {
  return (
    <div data-phase-panel="filling" className="space-y-6 sm:space-y-10">
      {guests}
    </div>
  );
}
