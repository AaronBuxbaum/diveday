import type { MonthlyReport } from "./reporting";

/**
 * **Sailed / Still to sail** (fourth UX review, item 22). "October so far"
 * counts every departure in October, so on the 14th next week's half-sold
 * boats pulled the fill rate down and their deposits counted as revenue. The
 * month's figure stays what it was; under it, the part that has left and the
 * part still for sale.
 *
 * `sailed` is the same report over the departures that left before now. The
 * rest is the month less it: seats and money subtract, and each side's fill
 * is its own booked over its own offered. Null when the month has nothing on
 * one side, where the split would only restate the figure.
 */
export type SailedSplit = {
  seats: { sailed: number; toSail: number };
  fill: { sailed: number | null; toSail: number | null };
  revenueCents: { sailed: number; toSail: number };
};

export function sailedSplit(month: MonthlyReport, sailed: MonthlyReport): SailedSplit | null {
  const toSailTrips = month.tripCount - sailed.tripCount;
  if (sailed.tripCount === 0 || toSailTrips <= 0) return null;
  const toSailBooked = month.seatsBooked - sailed.seatsBooked;
  const toSailOffered = month.seatsOffered - sailed.seatsOffered;
  return {
    seats: { sailed: sailed.seatsBooked, toSail: toSailBooked },
    fill: {
      sailed: sailed.fillRate,
      toSail: toSailOffered > 0 ? toSailBooked / toSailOffered : null,
    },
    revenueCents: { sailed: sailed.revenueCents, toSail: month.revenueCents - sailed.revenueCents },
  };
}
