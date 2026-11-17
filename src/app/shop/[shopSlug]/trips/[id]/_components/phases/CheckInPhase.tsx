import type { ReactNode } from "react";

/**
 * **Check-in** (ADR 20261117-trip-page-clock): the front desk's phase on the
 * day, until the boat leaves. The guest list with the arrival desk, then the
 * quiet line: gear, crew, the water and roll call next.
 */
export function CheckInPhase({ guests, quiet }: { guests: ReactNode; quiet: ReactNode }) {
  return (
    <div data-phase-panel="checkin" className="space-y-6">
      {guests}
      {quiet}
    </div>
  );
}
