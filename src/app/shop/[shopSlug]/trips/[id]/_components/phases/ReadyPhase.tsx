import type { ReactNode } from "react";

/**
 * **Getting ready** (ADR 20261117-trip-page-clock): the front desk's phase,
 * from shop-local midnight of the day before. The fix list with its remote
 * remedies, then gear to pack and tomorrow's water.
 */
export function ReadyPhase({ guests, prep }: { guests: ReactNode; prep: ReactNode }) {
  return (
    <div data-phase-panel="ready" className="space-y-6">
      {guests}
      {prep}
    </div>
  );
}
