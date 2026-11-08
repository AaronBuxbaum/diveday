import type { AppDb } from "../../db/client";
import { shoreAlertConsentRecorderName } from "../../db/shops";

export { canPersonManageShopSettings } from "../../db/authz";

/** The emergency reference page's question: who recorded the shore-alert consent. */
export async function getEmergencyReferencePage(
  db: AppDb,
  shop: { id: string; shoreAlertConsentByPersonId: string | null },
) {
  return { consentByName: await shoreAlertConsentRecorderName(db, shop) };
}
