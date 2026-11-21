import { canPersonBackfillIntegrations, canPersonManageShopSettings } from "@/db/authz";
import type { AppDb } from "@/db/client";
import { listIntegrationSummaries } from "./summaries";

/** Shared access policy; the page awaits the tenant gate before reading providers. */
export const INTEGRATION_SETTINGS_GATE = {
  allow: canPersonManageShopSettings,
  refusal: { notice: "integrations-not-authorized" },
} as const;

/** Safe provider summaries and live owner rights for the already-gated shop. */
export async function getIntegrationSettingsPage(db: AppDb, shopId: string, personId: string) {
  const [summaries, ownerBackfill] = await Promise.all([
    listIntegrationSummaries(db, shopId),
    canPersonBackfillIntegrations(db, shopId, personId),
  ]);
  return { summaries, ownerBackfill };
}
