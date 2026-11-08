/** trip-stages public contract. Internals are imported only within this module. */
export type { RecordTripStageOutcome } from "./store";
export {
  latestTripStage,
  latestTripStagesByTrip,
  readDepartureStage,
  recordTripStage,
} from "./store";
