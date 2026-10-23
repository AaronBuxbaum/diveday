import type { MedicalAlertResult, MedicalAlertRevealCopy } from "@/components/MedicalAlertReveal";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import type { TripManifest } from "@/lib/manifests";

/** What a diver row's medical alert block needs. */
export type MedicalAlertView = {
  /** The seat's bound reveal, for a reader allowed the words on this departure. */
  show?: () => Promise<MedicalAlertResult>;
  /** Said to a reader who may not read it: that one exists, and who can. */
  unreadable: string;
  copy: MedicalAlertRevealCopy;
};

/**
 * **The medical alert on this row, for this reader** (issue #2960). Every
 * staffer sees the chip; `show` is bound (`bindManifestActions`) only when
 * `canPersonReadMedicalAlertOnTrip` admitted the reader, and each tap
 * re-checks on the server. Others are told who on this departure's crew can
 * read it, by name.
 */
export function medicalAlertView({
  show,
  crew,
  locale,
  t,
}: {
  show?: () => Promise<MedicalAlertResult>;
  crew: TripManifest["crew"];
  locale: string;
  t: StaffTranslator;
}): MedicalAlertView {
  const names = crew.map((member) => member.fullName);
  return {
    show,
    unreadable:
      names.length > 0
        ? t("manifest.medicalAlertReadersCrew", {
            names: cachedListFormat(locale, { type: "conjunction" }).format(names),
          })
        : t("manifest.medicalAlertReadersNoCrew"),
    copy: {
      show: t("manifest.medicalAlertShow"),
      showing: t("manifest.medicalAlertShowing"),
      showHint: t("manifest.medicalAlertShowHint"),
      failed: t("manifest.medicalAlertShowFailed"),
    },
  };
}
