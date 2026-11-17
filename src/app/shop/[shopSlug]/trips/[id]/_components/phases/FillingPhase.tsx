import type { ReactNode } from "react";

/**
 * **Filling** (ADR 20261117-trip-page-clock): the owner's phase, until the day
 * before. Every way to fill a seat, the booked guests beside the trip's facts,
 * then what comes next.
 */
export function FillingPhase({ guests, next }: { guests: ReactNode; next: ReactNode }) {
  return (
    <div data-phase-panel="filling" className="space-y-6">
      {guests}
      {next}
    </div>
  );
}
