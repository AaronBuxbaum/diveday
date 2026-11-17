import type { ReactNode } from "react";

/**
 * **Check-in** (ADR 20261117-trip-page-clock): the front desk's phase on the
 * day, until the boat leaves. It hosts the guest list with the arrival desk
 * (each cleared guest's tap, walk-ins, no-shows, turn-aways).
 */
export function CheckInPhase({ guests }: { guests: ReactNode }) {
  return <div data-phase-panel="checkin">{guests}</div>;
}
