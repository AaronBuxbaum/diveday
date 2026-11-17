/** deck-counts public contract. Internals are imported only within this module. */
export type { DeckCountComparison } from "./rules";
export { compareDeckCount, DECK_COUNT_MAX, parseDeckCount } from "./rules";
export type { RecordDeckCountOutcome } from "./store";
export { latestDeckCounts, recordDeckCount } from "./store";
