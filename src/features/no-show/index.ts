/** no-show public contract. Internals are imported only within this module. */
export type { MarkNoShowOutcome, UndoNoShowOutcome } from "./store";
export {
  activeStaffRecorderId,
  markBookingNoShow,
  noShowSalvage,
  undoBookingNoShow,
} from "./store";
