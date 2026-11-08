/** trip-promos public contract. Internals are imported only within this module. */
export type {
  DealOutcome,
  OutstandingLastMinutePromo,
  OutstandingLastMinutePromoPage,
  TripLastMinutePromo,
  TripLastMinutePromoRecipientItem,
} from "./store";
export {
  getActiveTripPromoByCode,
  lastMinuteDealOutcomes,
  listOutstandingLastMinutePromos,
  listTripLastMinutePromoRecipients,
  listTripLastMinutePromos,
  TRIP_DEAL_PAGE_SIZE,
  tripIdsNeverSentLastMinuteDeal,
  tripIdsSuitedToADeal,
} from "./store";
