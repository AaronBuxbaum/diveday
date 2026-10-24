import { canPersonPrintMedicalAlerts } from "@/db/authz";
import { getDb } from "@/db/client";
import { tripHasMedicalAlert } from "@/db/medical-alerts";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { recordTripPrintPdfAction } from "../print-actions";
import { PrintTripBundleButton } from "./PrintTripBundleButton";

/**
 * **"Print with medical alerts"**, beside "Print packet" (issue #2990): the
 * owner or a manager, on a departure where a seat has an alert. Absent for
 * everyone else, and the print route checks again and records the print on
 * each diver's trail, so this render is never the only gate. Opened by the
 * same form-and-`window.open` button as the packet, never a prefetching link.
 */
export async function PrintWithMedicalAlertsLink({
  shop,
  personId,
  tripId,
}: {
  shop: { id: string; slug: string; defaultLocale: string };
  personId: string;
  tripId: string;
}) {
  const db = await getDb();
  if (!(await canPersonPrintMedicalAlerts(db, shop.id, personId))) return null;
  if (!(await tripHasMedicalAlert(db, shop.id, tripId))) return null;
  const t = staffTranslator(await requestLocale(shop.defaultLocale));
  return (
    <PrintTripBundleButton
      href={shopPath(shop.slug, "trips", tripId, "print", "medical-alerts")}
      label={t("trips.about.printWithMedicalAlerts")}
      popupBlockedLabel={t("shared.printButton.popupBlocked")}
      recordAction={recordTripPrintPdfAction.bind(null, shop.slug, tripId)}
      flush
    />
  );
}
