/**
 * Waivers — the public surface.
 *
 * This file is the whole importable contract: everything outside these files
 * reaches for `./waivers` (or `@/db/waivers`), never a `waivers-*` sibling. The
 * implementation is split along the groups a reader navigates by:
 *
 * | Sibling | What lives there |
 * | --- | --- |
 * | `./waivers-templates.ts` | the release text: current template, history, saving a version, exposure of a change |
 * | `./waivers-audit.ts` | reading signed records back: integrity audit, staff and diver copies |
 * | `./waivers-requests.ts` | issuing a signing link, and whether one is live |
 * | `./waivers-completion.ts` | the bearer's side: token, draft, guardian, emergency contact, completion |
 * | `./waivers-delivery-status.ts` | how a request reached the diver, per channel |
 * | `./waivers-in-person.ts` | a release signed at the counter |
 * | `./waivers-medical.ts` | a physician's evaluation, the medical hold, retiring a refusal |
 * | `./waivers-trip-status.ts` | each booking's waiver status on a departure |
 *
 * Adding a function to a sibling does not publish it — name it here too. The
 * siblings import each other by file, so this barrel is never in a cycle.
 */

export {
  getSignedWaiverForDiver,
  getSignedWaiverRecordForShop,
  listSignedWaiversByPerson,
  listWaiverIntegrityAudit,
  type SignedWaiverEntry,
  type SignedWaiverForDiver,
  WAIVER_INTEGRITY_PAGE_SIZE,
  type WaiverIntegrityAuditPage,
} from "./waivers-audit";
export {
  type CompleteWaiverOutcome,
  completeWaiver,
  type EmergencyContactInput,
  type GuardianInput,
  getEmergencyContactForBearer,
  getEmergencyContactForPerson,
  getWaiverForToken,
  saveBookingEmergencyContact,
  savePersonEmergencyContact,
  saveWaiverDraft,
  staleWaiverRecordForToken,
  type TokenWaiverState,
} from "./waivers-completion";
export {
  type DiverWaiverRequestStatus,
  getDiverWaiverChannelStates,
  getDiverWaiverRequestStatus,
  recordWaiverDelivery,
  type WaiverChannelDeliveryState,
  type WaiverChannelDeliveryStates,
} from "./waivers-delivery-status";
export {
  type InPersonWaiverOutcome,
  type InPersonWaiverSubject,
  recordInPersonWaiver,
} from "./waivers-in-person";
export {
  getMedicalClearanceDocument,
  hasUnansweredMedicalHold,
  type MedicalEvaluationOutcome,
  type MedicalEvaluationResult,
  type RetireMedicalRefusalResult,
  recordMedicalEvaluation,
  retireMedicalRefusal,
} from "./waivers-medical";
export {
  hasLivePersonWaiverRequest,
  hasLiveWaiverRequest,
  type IssueWaiverOutcome,
  issueWaiverRequest,
} from "./waivers-requests";
export {
  getCurrentWaiverTemplate,
  listWaiverTemplateHistory,
  type SaveWaiverTemplateInput,
  type SaveWaiverTemplateResult,
  type StandingWaiverExposure,
  saveWaiverTemplate,
  standingWaiverExposure,
  type WaiverDeliveryChannel,
} from "./waivers-templates";
export { listTripsWaiverStatuses, listTripWaiverStatuses } from "./waivers-trip-status";
