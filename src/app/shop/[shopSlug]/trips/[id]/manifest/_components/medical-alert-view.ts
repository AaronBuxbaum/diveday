import type {
  MedicalAlertEmergencyCopy,
  MedicalAlertResult,
  MedicalAlertRevealCopy,
} from "@/components/MedicalAlertReveal";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** What a diver row's medical alert block needs. */
export type MedicalAlertView = {
  /** The seat's bound reveal, for a reader allowed the words on this departure. */
  show?: () => Promise<MedicalAlertResult>;
  /** Said to a reader who may not read it: who can, and to ask one of them. */
  unreadable: string;
  copy: MedicalAlertRevealCopy;
  /** Keeps the revealed words through closing and reopening the sheet. */
  keepAs: string;
  /** This seat on the device's saved copy, for the no-signal fallback. */
  savedCopy: { tripId: string; bookingId: string };
  /** "Emergency: show the alert", for a reader the crew rule refuses, until the trip's days end (issue #2990). */
  emergency?: { show: () => Promise<MedicalAlertResult>; copy: MedicalAlertEmergencyCopy };
};

/**
 * **The medical alert on this row, for this reader** (issue #2960, H-20261023-medical-alert-for-the).
 * Every staffer sees the chip; `show` is bound (`bindManifestActions`) only
 * when `canPersonReadMedicalAlertOnTrip` admitted the reader, and each tap
 * re-checks on the server. Others are told who can read it (the owner, a
 * manager, or crew a manager put on this departure) and to ask one of them.
 * No names: a crew member who rostered themselves is on the crew list and
 * still cannot read it.
 */
export function medicalAlertView({
  show,
  emergencyShow,
  tripId,
  bookingId,
  t,
}: {
  show?: () => Promise<MedicalAlertResult>;
  /** Bound only when `show` is not: a staffer the crew rule refuses, until the trip's days end. */
  emergencyShow?: () => Promise<MedicalAlertResult>;
  tripId: string;
  bookingId: string;
  t: StaffTranslator;
}): MedicalAlertView {
  return {
    show,
    unreadable: t("manifest.medicalAlertReaders"),
    copy: {
      show: t("manifest.medicalAlertShow"),
      showing: t("manifest.medicalAlertShowing"),
      showHint: t("manifest.medicalAlertShowHint"),
      failed: t("manifest.medicalAlertShowFailed"),
      notReviewed: t("manifest.medicalAlertNotReviewed"),
      noSignal: t("manifest.medicalAlertNoSignal"),
      fromSavedCopy: t.raw("manifest.medicalAlertFromSavedCopy"),
    },
    keepAs: `${tripId}:${bookingId}`,
    savedCopy: { tripId, bookingId },
    emergency:
      !show && emergencyShow
        ? {
            show: emergencyShow,
            copy: {
              offer: t("manifest.medicalAlertEmergencyOffer"),
              confirmBody: t("manifest.medicalAlertEmergencyConfirmBody"),
              confirm: t("manifest.medicalAlertEmergencyConfirm"),
              cancel: t("manifest.medicalAlertEmergencyCancel"),
              noSignal: t("manifest.medicalAlertEmergencyNoSignal"),
              notYet: t("manifest.medicalAlertEmergencyNotYet"),
              closed: t("manifest.medicalAlertEmergencyClosed"),
            },
          }
        : undefined,
  };
}
