import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * Words for `MedicalClearanceControl`, resolved server-side and passed down as
 * plain data — the house pattern for a staff Client Component, which cannot be
 * handed a `StaffTranslator` (a function is not serializable across the
 * boundary).
 *
 * In its own module rather than beside the component for the same reason
 * `paper-waiver-copy.ts` is: everything exported from a `"use client"` file is a
 * client reference, so a server page calling this from there throws at render.
 */
export type MedicalClearanceCopy = {
  recordClearance: string;
  evaluatedOnLabel: string;
  physicianNameLabel: string;
  evidenceHint: string;
  documentLabel: string;
  documentHint: string;
  recording: string;
  confirm: string;
  neverMind: string;
};

export function medicalClearanceCopy(t: StaffTranslator): MedicalClearanceCopy {
  return {
    recordClearance: t("shared.medicalClearance.recordClearance"),
    evaluatedOnLabel: t("shared.medicalClearance.evaluatedOnLabel"),
    physicianNameLabel: t("shared.medicalClearance.physicianNameLabel"),
    evidenceHint: t("shared.medicalClearance.evidenceHint"),
    documentLabel: t("shared.medicalClearance.documentLabel"),
    documentHint: t("shared.medicalClearance.documentHint"),
    recording: t("shared.medicalClearance.recording"),
    confirm: t("shared.medicalClearance.confirm"),
    neverMind: t("shared.waiverSend.neverMind"),
  };
}
