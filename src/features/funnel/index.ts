/** funnel public contract. Internals are imported only within this module. */
export type { FunnelRange } from "./store";
export {
  countDemoEntriesBySource,
  countSetupRequestsBySource,
  countSetupRequestsSince,
  countUnnotifiedSetupRequests,
  deleteSetupRequestsByEmail,
  deleteSetupRequestsByPhone,
  markSetupRequestNotified,
  recordDemoEntry,
  recordSetupRequest,
} from "./store";
