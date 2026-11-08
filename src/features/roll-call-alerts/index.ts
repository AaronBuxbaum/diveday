/** roll-call-alerts public contract. Internals are imported only within this module. */

export {
  isMissingReason,
  isStaleRollCallReason,
  STALE_ROLL_CALL_AFTER_MS,
  STALE_ROLL_CALL_LOOKBACK_MS,
  staleRollCallAlertDue,
} from "./rules";
export type { StaleRollCallSummary } from "./store";
export { sendStaleRollCallAlerts } from "./store";
