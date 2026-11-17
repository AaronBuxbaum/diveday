import type { ReactNode } from "react";

/**
 * **Filling** (ADR 20261117-trip-page-clock): the owner's phase, until the day
 * before. For now it hosts the guest list and its bands as they were; the
 * fix list, the ways to fill a seat and the inline plan arrive in later
 * layers of the rebuild.
 */
export function FillingPhase({ guests }: { guests: ReactNode }) {
  return <div data-phase-panel="filling">{guests}</div>;
}
