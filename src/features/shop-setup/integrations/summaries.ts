import type { DbExecutor } from "@/db/client";
import { listShopIntegrations } from "./store";

/** Safe settings projection: credentials_sealed never crosses the feature boundary to the UI. */
export async function listIntegrationSummaries(db: DbExecutor, shopId: string) {
  const rows = await listShopIntegrations(db, shopId);
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    status: row.status,
    externalAccountId: row.externalAccountId,
    externalLabel: row.externalLabel,
    settings: row.settings,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt,
  }));
}
