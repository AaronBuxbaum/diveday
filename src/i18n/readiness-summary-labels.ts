import type {
  ChecklistCategory,
  ChecklistDetailCode,
  DiverChecklistItem,
} from "@/lib/readiness-summary";
import type { DiverMessageKey, DiverTranslator } from "./messages";

/** Where each checklist category's word lives in the diver bundle. */
export const CHECKLIST_CATEGORY_KEYS: Record<ChecklistCategory, DiverMessageKey> = {
  waiver: "ready.checklistCategoryWaiver",
  certification: "ready.checklistCategoryCertification",
  payment: "ready.checklistCategoryPayment",
  setup: "ready.checklistCategorySetup",
};

/**
 * Every `ChecklistDetailCode` `buildDiverChecklist` can produce, to its
 * diver-voiced sentence. None of these need interpolation — the diver
 * checklist deliberately stays generic rather than naming a specific
 * certification level or specialty (that detail is for staff; see
 * `src/i18n/readiness-labels.ts`).
 */
export const CHECKLIST_DETAIL_KEYS: Record<ChecklistDetailCode, DiverMessageKey> = {
  requirements_not_configured: "ready.checklistDetail.setupGeneric",
  readiness_unavailable: "ready.checklistDetail.readinessUnavailable",
  identity_unconfirmed: "ready.checklistDetail.identityUnconfirmed",
  under_minimum_age: "ready.checklistDetail.underMinimumAge",
  waiver_not_sent: "ready.checklistDetail.waiverNotSent",
  waiver_pending: "ready.checklistDetail.waiverPending",
  waiver_expired: "ready.checklistDetail.waiverExpired",
  medical_review: "ready.checklistDetail.medicalReview",
  certification_missing: "ready.checklistDetail.certificationMissing",
  certification_pending: "ready.checklistDetail.certificationPending",
  certification_expired: "ready.checklistDetail.certificationExpired",
  certification_insufficient: "ready.checklistDetail.certificationInsufficient",
  specialty_missing: "ready.checklistDetail.specialtyMissing",
  specialty_pending: "ready.checklistDetail.specialtyPending",
  specialty_expired: "ready.checklistDetail.specialtyExpired",
  specialty_import_unconfirmed: "ready.checklistDetail.specialtyImportUnconfirmed",
  nitrox_missing: "ready.checklistDetail.nitroxMissing",
  nitrox_pending: "ready.checklistDetail.nitroxPending",
  payment_due: "ready.checklistDetail.paymentDue",
  payment_refunded: "ready.checklistDetail.paymentDue",
  waiver_done: "ready.checklistDetail.waiverDone",
  certification_done: "ready.checklistDetail.certificationDone",
  payment_done: "ready.checklistDetail.paymentDone",
  certification_multiple_needed: "ready.checklistDetail.certificationMultipleNeeded",
  setup_generic: "ready.checklistDetail.setupGeneric",
};

export function checklistCategoryText(t: DiverTranslator, category: ChecklistCategory): string {
  return t(CHECKLIST_CATEGORY_KEYS[category]);
}

export function checklistDetailText(t: DiverTranslator, item: DiverChecklistItem): string {
  return t(CHECKLIST_DETAIL_KEYS[item.detailCode]);
}
