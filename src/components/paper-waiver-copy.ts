import { staffGuardianRelationshipOptions } from "@/i18n/guardian-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { GuardianRelationship } from "@/lib/guardian";

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
  /**
   * The guardian half of the form, shown only for a diver who is a minor
   * today (ADR 20260907-guardian-co-signature). Always resolved — the words
   * cost nothing to carry and the surface decides whether to draw them, which
   * keeps `requiresGuardian` a single boolean rather than a copy handoff.
   */
  guardian: {
    nameLabel: string;
    relationshipLabel: string;
    relationshipChoose: string;
    relationshipOptions: Array<{ value: GuardianRelationship; label: string }>;
    /**
     * The namesake confirmation, drawn only on a form that has already been
     * refused for it (issue #1573). Resolved unconditionally like the rest —
     * the surface decides whether it appears.
     */
    namesakeLabel: string;
  };
};

export function paperWaiverCopy(t: StaffTranslator): PaperWaiverCopy {
  return {
    markSignedOnPaper: t("shared.paperWaiver.markSignedOnPaper"),
    medicalAttestationLabel: t("shared.paperWaiver.medicalAttestationLabel"),
    recording: t("shared.paperWaiver.recording"),
    recordPaperSignature: t("shared.paperWaiver.recordPaperSignature"),
    neverMind: t("shared.waiverSend.neverMind"),
    guardian: {
      nameLabel: t("shared.paperWaiver.guardianNameLabel"),
      relationshipLabel: t("shared.paperWaiver.guardianRelationshipLabel"),
      relationshipChoose: t("shared.paperWaiver.guardianRelationshipChoose"),
      relationshipOptions: staffGuardianRelationshipOptions(t),
      namesakeLabel: t("shared.paperWaiver.guardianNamesakeLabel"),
    },
  };
}
