/** open-seats public contract. Internals are imported only within this module. */

export { openSeatsDebriefText } from "./labels";
export type { DepartureWithEmptySeats, OpenSeatsDebrief, OpenSeatsInput } from "./rules";
export { departuresWithEmptySeats, openSeatsDebrief, unsoldSeats } from "./rules";
export {
  comparableDepartures,
  getMonthDeparturesWithEmptySeats,
  getTripOpenSeatsDebrief,
} from "./store";
