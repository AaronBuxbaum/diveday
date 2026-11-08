/** processor-erasure public contract. Internals are imported only within this module. */

export type {
  AttemptProcessorErasureOutcome,
  DischargeProcessorErasureResult,
  ProcessorErasureTargetInput,
  RecordProcessorErasureObligationsInput,
  RetryProcessorErasureResult,
} from "./store";
export {
  attemptProcessorErasure,
  attemptProcessorErasures,
  dischargeProcessorErasure,
  MAX_AUTOMATIC_DELETE_ATTEMPTS,
  recordProcessorErasureObligations,
  retryPendingProcessorErasures,
  retryProcessorErasure,
} from "./store";
