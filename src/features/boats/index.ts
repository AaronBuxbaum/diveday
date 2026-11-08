/** boats public contract. Internals are imported only within this module. */
export type { AssignedTripInterval, TripTimeInterval } from "./rules";
export { maxConcurrentTrips, overlappingBoatIds } from "./rules";
export type { Boat, BoatPapersInput, BoatSaveOutcome } from "./store";
export {
  countBoatsWithoutRadioIdentity,
  countDeparturesByBoat,
  createBoat,
  deleteBoat,
  departureVessels,
  editBoat,
  editBoatWithinCertificate,
  getBoatById,
  getBoatForHistory,
  listBoats,
  listBoatsForHistory,
  replaceBoatPhoto,
  upcomingBoatDepartures,
} from "./store";
