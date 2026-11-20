/** boat-day public contract. Internals are imported only within this module. */

export type { DayCollision, DayDeparture } from "./rules";
export { collisionsFor, dayCollisions } from "./rules";
export type { BoatDayDeparture } from "./store";
export { getBoatDay } from "./store";
