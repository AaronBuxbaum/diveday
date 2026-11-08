/** check-in public contract. Internals are imported only within this module. */
export type { ArrivalElsewhere } from "./arrival-elsewhere.store";
export { arrivalElsewhere, readArrivalLookup } from "./arrival-elsewhere.store";
export { counterIsClear, counterTally, isBlockedAtCounter, isTurnedAwayAtCounter } from "./rules";
export type {
  ArrivalOfflineInput,
  ArrivalOfflineRefusal,
  CheckInOutcome,
  CheckInQueueRow,
  UndoCheckInOutcome,
} from "./store";
export { checkInBooking, hasArrivals, listCheckInQueue, undoCheckInBooking } from "./store";
