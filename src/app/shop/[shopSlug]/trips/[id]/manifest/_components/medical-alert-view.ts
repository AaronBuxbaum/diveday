import type { MedicalAlertResult, MedicalAlertRevealCopy } from "@/components/MedicalAlertReveal";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";
import type { TripManifest } from "@/lib/manifests";
import { showSeatMedicalAlertAction } from "../medical-alert-action";

/** What a diver row's medical alert block needs, built once for the departure. */
export type MedicalAlertView = {
  /** One seat's bound reveal, for a reader allowed the words on this departure. */
  show?: (bookingId: string) => () => Promise<MedicalAlertResult>;
  /** Said to a reader who may not read it: that one exists, and who can. */
  unreadable: string;
  copy: MedicalAlertRevealCopy;
};

/**
 * **The medical alert on this manifest, for this reader** (issue #2960). Every
 * staffer sees the chip; `show` is bound only when `canPersonReadMedicalAlertOnTrip`
 * admitted the reader, and each tap re-checks on the server. Others are told
 * who on this departure's crew can read it, by name.
 */
export function medicalAlertView({
  mayRead,
  shopSlug,
  tripId,
  crew,
  locale,
  t,
}: {
  mayRead: boolean;
  shopSlug: string;
  tripId: string;
  crew: TripManifest["crew"];
  locale: string;
  t: StaffTranslator;
}): MedicalAlertView {
  const names = crew.map((member) => member.fullName);
  return {
    show: mayRead
      ? (bookingId) => showSeatMedicalAlertAction.bind(null, shopSlug, tripId, bookingId)
      : undefined,
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
