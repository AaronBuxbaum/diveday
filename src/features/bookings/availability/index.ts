/** availability public contract. Internals are imported only within this module. */

export type {
  AvailabilityDeparture,
  AvailabilityDocument,
  AvailabilityShop,
  AvailabilityTripInput,
} from "./rules";
export {
  AVAILABILITY_SCHEMA,
  AVAILABILITY_WINDOW_DAYS,
  availabilityDocument,
  availabilityWindow,
  seatsOpen,
} from "./rules";
export { AVAILABILITY_TRIP_LIMIT, publicAvailabilityTrips } from "./store";
