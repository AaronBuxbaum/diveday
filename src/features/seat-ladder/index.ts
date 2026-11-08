/** seat-ladder public contract. Internals are imported only within this module. */
export type { DepartureRollCall, SeatEvidence, SeatLadder, SeatRecords, SeatRung } from "./rules";
export {
  isAfterTheDive,
  joinedAtADiveSite,
  leftAtTheDock,
  readSeatLadder,
  sailingUnsaid,
} from "./rules";
