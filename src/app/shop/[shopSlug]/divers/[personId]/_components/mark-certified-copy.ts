import type { StaffTranslator } from "@/i18n/staff-messages";
import type { MarkCertifiedCopy } from "./MarkCertifiedControl";

/**
 * Built once per render of the diver record and threaded to every
 * `MarkCertifiedControl` on it — the level cards and the specialty/nitrox list
 * share one vocabulary for the same tap, the way `waiverSendCopy` does for the
 * waiver send. Its own module rather than the client component's, so a server
 * component can call it without importing across the `"use client"` boundary
 * (the shape `paper-waiver-copy.ts` already sets).
 */
export function markCertifiedCopy(t: StaffTranslator): MarkCertifiedCopy {
  return {
    markCertified: t("divers.certifications.markCertified"),
    markingCertified: t("divers.certifications.markingCertified"),
    confirmCard: t("divers.certifications.confirmCard"),
    confirming: t("divers.certifications.confirming"),
    certifiedToast: t("divers.notices.cardCertifiedToast"),
    confirmedToast: t("divers.notices.cardConfirmedToast"),
    undo: t("shared.undoToast.undo"),
    undoPending: t("shared.undoToast.pendingLabel"),
    sightingRequired: t("divers.notices.cardSightingRequired"),
    duplicateCard: t("divers.notices.duplicateCard"),
    invalid: t("divers.notices.invalid"),
    undoFailed: t("divers.notices.cardUndoFailed"),
  };
}
