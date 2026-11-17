/**
 * Whether Edit trip shows the dive safety record (whether these dives went
 * past no-decompression limits): once the plan is closed, and on a cancelled
 * trip only when the dock count put someone aboard. The cancel and blow-out
 * writers refuse a boat that may have left the dock (`src/db/blowouts.ts`,
 * `src/db/aboard-at-sea.ts`), so this is the rare record of a boat scrubbed
 * with people aboard; a trip nobody boarded has nothing to record.
 */
export function safetyRecordShown({
  detailsEditable,
  cancelled,
  boarded,
}: {
  detailsEditable: boolean | undefined;
  cancelled: boolean;
  /** Seats the dock count recorded aboard (`listDepartureBoardedByTrip`). */
  boarded: number;
}): boolean {
  if (detailsEditable !== false) return false;
  return !cancelled || boarded > 0;
}
