import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * Words for `PaperWaiverControl`, resolved server-side and passed down as plain
 * data — the house pattern for a staff Client Component, which can't be handed
 * a `StaffTranslator` (a function is not serializable across the boundary).
 *
 * In its own module rather than beside the component for the same reason
 * `waiver-send-types.ts` is: everything exported from a `"use client"` file is a
 * client reference, so a server page calling `paperWaiverCopy()` from there
 * throws "attempted to call it from the server" at render — a runtime failure
 * that `tsc` and a jsdom component test both wave straight through, and that
 * shows up as a blank client-only page.
 */
export type PaperWaiverCopy = {
  markSignedOnPaper: string;
  medicalAttestationLabel: string;
  recording: string;
  recordPaperSignature: string;
  neverMind: string;
};

export function paperWaiverCopy(t: StaffTranslator): PaperWaiverCopy {
  return {
    markSignedOnPaper: t("shared.paperWaiver.markSignedOnPaper"),
    medicalAttestationLabel: t("shared.paperWaiver.medicalAttestationLabel"),
    recording: t("shared.paperWaiver.recording"),
    recordPaperSignature: t("shared.paperWaiver.recordPaperSignature"),
    neverMind: t("shared.waiverSend.neverMind"),
  };
}
