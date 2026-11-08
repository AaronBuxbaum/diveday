/** last-dive public contract. Internals are imported only within this module. */
export type { LastKnownDive, RecordLastDiveOutcome } from "./store";
export { EARLIEST_LAST_DIVE, lastKnownDive, latestKnownDive, recordLastDive } from "./store";
