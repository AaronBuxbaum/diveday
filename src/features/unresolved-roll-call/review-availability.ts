/**
 * Capture and review stay disabled until complete intent matching, lifecycle
 * and erasure-fenced authorization have been verified end to end. A lookup by
 * event ID alone does not prove a device's queued observation was retained.
 */
export function unresolvedReviewAvailable(): boolean {
  return false;
}

/** Deferral must remain off until the review revision is enforced across old
 * and new writers and its audit, export and retention lifecycle is complete. */
export function unresolvedDeferralAvailable(): boolean {
  return false;
}
