/** diver-status public contract. Internals are imported only within this module. */
export type { DiverFileKind, DiverStatusKind, DiverStatusRow, DiverStatusTarget } from "./rules";
export {
  bookingIsAhead,
  buildDiverStatus,
  foldsIntoFile,
  nextBookingAhead,
  splitDiverStatus,
} from "./rules";
