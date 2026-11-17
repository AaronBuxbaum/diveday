/**
 * Whether Edit trip shows the dive safety record (whether these dives went
 * past no-decompression limits): once the plan is closed, and on a cancelled
 * trip only when someone boarded. A blow-out after the first tank still
 * counts for flying guidance; a trip that never sailed has nothing to record.
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
