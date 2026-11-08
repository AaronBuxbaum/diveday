/** thin-boats public contract. Internals are imported only within this module. */

export type { ThinBoatInput, ThinBoatNeed } from "./rules";
export {
  THIN_BOAT_DEAL_DAYS,
  THIN_BOATS_HORIZON_DAYS,
  THIN_BOATS_HORIZON_MS,
  THIN_BOATS_SHOWN,
  thinBoatDealOpen,
  thinBoatNeed,
} from "./rules";
export type { ThinBoat } from "./store";
export { listThinBoats } from "./store";
