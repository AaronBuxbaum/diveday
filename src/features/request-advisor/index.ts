/** request-advisor public contract. Internals are imported only within this module. */
export type {
  BoatAdvisorInput,
  DepartureShape,
  RequestAdvice,
  RequestAdvisor,
  RequestAdvisorInput,
} from "./rules";
export {
  adviseRequests,
  DEFAULT_DEPARTURE_CAPACITY,
  departureShapeFor,
  MAX_DEPARTURE_CAPACITY,
  transparentHeadcountAdvisor,
} from "./rules";
