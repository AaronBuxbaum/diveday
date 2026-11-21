/** booking-handoff public contract. Internals are imported only within this module. */

export type { KnownDiverFact, KnownDiverSources } from "./rules";
export {
  foldKnownDiverFacts,
  HANDOFF_OFFER_COOLDOWN_MS,
  HANDOFF_QUERY_PARAM,
  HANDOFF_TTL_MS,
  handoffHref,
  NEVER_HANDED_OFF,
} from "./rules";
export type { HandoffOfferOutcome, KnownDiver } from "./store";
export {
  consumeBookingHandoff,
  issueBookingHandoff,
  lastGearFor,
  offerBookingHandoffByEmail,
  readKnownDiver,
} from "./store";
