/**
 * The gear register — the public surface.
 *
 * This file is the whole importable contract: everything outside these files
 * reaches for `./gear` (or `@/db/gear`), never one of the siblings below. The
 * implementation is split along the register's own sections:
 *
 * | Sibling | What lives there |
 * | --- | --- |
 * | `./gear-shared.ts` | the live-rows filters, a reservation's holder, the enum drift checks |
 * | `./gear-items.ts` | the units: create, edit, status, soft delete, restore, count |
 * | `./gear-service.ts` | service events and the clocks they set |
 * | `./gear-reservations.ts` | holding a unit: reserve, check out, return, release, re-window |
 * | `./gear-register.ts` | the register page's readers and one unit's record |
 * | `./gear-availability.ts` | free units, open service concerns, a trip's assignments |
 * | `./gear-returns.ts` | due back, overdue, fit-adjusted returns |
 * | `./gear-service-due.ts` | which units are due for service |
 *
 * `gear-rentals.ts`, `gear-counter-rentals.ts` and `gear-import.ts` predate this
 * split and keep their own import paths. Adding a function to a sibling does
 * not publish it — name it here too.
 */

export {
  type AvailableGearUnit,
  gearItemKindsById,
  listAvailableGearUnits,
  listTripGearAssignments,
  openServiceConcerns,
  type TripGearAssignment,
} from "./gear-availability";
export {
  type CreateGearItemOutcome,
  countGearItems,
  createGearItem,
  type DeleteGearItemOutcome,
  deleteGearItem,
  type GearItemInput,
  type RestoreGearItemOutcome,
  restoreGearItem,
  type SetGearItemStatusOutcome,
  setGearItemStatus,
  type UpdateGearItemOutcome,
  updateGearItem,
} from "./gear-items";
export {
  countGearItemsByKind,
  type DeletedGearItemRow,
  type GearItemDetail,
  type GearRegisterGroups,
  type GearRegisterRow,
  type GearRowReservation,
  gearRegisterGroups,
  getGearItemDetail,
  listDeletedGearItems,
  listGearItems,
} from "./gear-register";
export {
  checkOutGearReservation,
  checkOutTripGearSet,
  countOpenTripGearReservations,
  type GearPickScreen,
  type GearReservationActionOutcome,
  type ReserveGearUnitOutcome,
  releaseGearReservation,
  releaseUnclaimedGearReservations,
  releaseUnclaimedGearReservationsForTrips,
  reserveGearUnit,
  returnGearReservation,
  returnTripGearSet,
  rewindowTripGearReservations,
} from "./gear-reservations";
export {
  type FitAdjustedReturn,
  fitAdjustedReturnTeaching,
  type GearReturnRow,
  listFitAdjustedReturns,
  listGearDueBack,
  listOverdueGearReservations,
} from "./gear-returns";
export {
  type GearServiceEventRow,
  latestServiceClocks,
  listGearServiceEvents,
  type RecordGearServiceOutcome,
  recordGearService,
} from "./gear-service";
export {
  type GearServiceDueRow,
  listGearServiceDue,
  listGearServiceDueRows,
} from "./gear-service-due";
export { openGearReservation } from "./gear-shared";
