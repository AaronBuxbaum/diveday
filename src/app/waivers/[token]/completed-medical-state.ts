import type { WaiverRecord } from "@/db/schema";
import { calculateMedicalResult } from "@/lib/medical";
import { isUnresolvedMedicalHold } from "@/lib/waivers";

export type CompletedMedicalRecord = Pick<
  WaiverRecord,
  | "status"
  | "supersededAt"
  | "medicalClearedAt"
  | "medicalClearanceDeclinedAt"
  | "medicalAnswers"
  | "diverMedicalFormSentAt"
>;
export type CompletedMedicalState =
  | "complete"
  | "referral"
  | "shop_review"
  | "form_sent"
  | "declined";

/** Presentation only: incomplete answers still hold under the existing domain gate. */
export function completedMedicalState(record: CompletedMedicalRecord): CompletedMedicalState {
  if (!isUnresolvedMedicalHold(record)) return "complete";
  if (record.medicalClearanceDeclinedAt) return "declined";
  if (record.diverMedicalFormSentAt) return "form_sent";
  return record.medicalAnswers &&
    calculateMedicalResult(record.medicalAnswers).status === "physician_review"
    ? "referral"
    : "shop_review";
}
