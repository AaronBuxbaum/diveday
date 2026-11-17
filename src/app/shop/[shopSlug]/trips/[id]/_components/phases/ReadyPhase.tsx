import type { ReactNode } from "react";

/**
 * **Getting ready** (ADR 20261117-trip-page-clock): the front desk's phase,
 * from shop-local midnight of the day before. For now it hosts the guest list
 * and its bands as they were.
 */
export function ReadyPhase({ guests }: { guests: ReactNode }) {
  return <div data-phase-panel="ready">{guests}</div>;
}
