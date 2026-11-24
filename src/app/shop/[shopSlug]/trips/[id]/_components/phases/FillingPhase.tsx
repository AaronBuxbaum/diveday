import type { ReactNode } from "react";

/**
 * **Filling** (ADR 20261117-trip-page-clock): the owner's phase, until the day
 * before. Under the sentence, in the order the desk asks: who is on the trip
 * and what each still owes, then the ways to fill a seat, with the trip's
 * facts and what comes next beside them (`TripRosterContent` lays them out).
 */
export function FillingPhase({ guests }: { guests: ReactNode }) {
  return (
    <div data-phase-panel="filling" className="space-y-10">
      {guests}
    </div>
  );
}
