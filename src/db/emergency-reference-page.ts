import type { AppDb } from "./client";
import { shoreAlertConsentRecorderName } from "./shops";

export { canPersonManageShopSettings } from "./authz";

/** The emergency reference page's question: who recorded the shore-alert consent. */
export async function getEmergencyReferencePage(
  db: AppDb,
  shop: { id: string; shoreAlertConsentByPersonId: string | null },
) {
  return { consentByName: await shoreAlertConsentRecorderName(db, shop) };
}
