import { HOUR_MS, MINUTE_MS } from "./clock";
import { AFTER_DIVE_GAP_REASONS } from "./closeout";
import type { RollCallGapReason } from "./today";

/**
 * **A roll call still open after the boat should be home** (batch 6, item 6).
 *
 * Once an after-dive count is still open after the boat was due back, the
 * owner hears about it — by email, and by a push to every device following
 * that departure's manifest — and so does the shop's shore contact, by email,
 * when the shop recorded their consent (H-20261014-stale-roll-call-recipients, `./shore-alert-contact.ts`),
 * once per departure, and Today's row for the
 * count says the alert went. The pass is hourly and asks from half an hour
 * past the end; a count nobody started is only open to Today once the boat
 * is due home (the end plus the hour's return buffer, `hasReturned`), so its
 * alert goes at the first pass after that. It informs; it never closes, reopens or gates
 * anything.
 *
 * "Open" is never decided here. The hourly pass asks the one detector the
 * Today queue and the close-out read (`listRollCallGaps`, src/db/today.ts) and
 * keeps only its after-dive reasons ({@link AFTER_DIVE_GAP_REASONS}): a dock
 * count left unfinished is paperwork, and an alert that fires on paperwork is
 * an alert nobody reads by the second week.
 */

/**
 * How long past a departure's end the pass starts asking. The earliest an
 * alert can go, not when it does: see the note above.
 */
export const STALE_ROLL_CALL_AFTER_MS = 30 * MINUTE_MS;

/**
 * How far back the pass looks. A departure that ended longer ago than this is
 * never alerted about: the Today row has carried it all along, and an alert
 * about yesterday's boat — after a deploy, or a cron that was down — would
 * arrive as news nobody can act on.
 */
export const STALE_ROLL_CALL_LOOKBACK_MS = 24 * HOUR_MS;

/** Whether a departure is due its alert now: past the wait, inside the look-back, not yet sent. */
export function staleRollCallAlertDue(input: {
  endsAt: Date;
  alertedAt: Date | null;
  now: Date;
}): boolean {
  if (input.alertedAt !== null) return false;
  const since = input.now.getTime() - input.endsAt.getTime();
  return since >= STALE_ROLL_CALL_AFTER_MS && since <= STALE_ROLL_CALL_LOOKBACK_MS;
}

/** The gap reasons that mean somebody may still be in the water — the only ones that alert. */
export function isStaleRollCallReason(reason: RollCallGapReason): boolean {
  return AFTER_DIVE_GAP_REASONS.has(reason);
}

/** A stated "did not come back", as opposed to a count nobody finished. */
export function isMissingReason(reason: RollCallGapReason): boolean {
  return reason === "missing_diver" || reason === "missing_crew";
}
