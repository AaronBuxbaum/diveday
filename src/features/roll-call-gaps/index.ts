/** roll-call-gaps public contract. Internals are imported only within this module. */

export type { OpenRollCall } from "./store";
export {
  listRollCallGaps,
  oneRowPerHalf,
  openAfterDiveRollCalls,
  RETURNED_ROLL_CALL_LOOKBACK_MS,
  ROLL_CALL_RESIDUE_MS,
  tripsWithSomebodyMissing,
} from "./store";
