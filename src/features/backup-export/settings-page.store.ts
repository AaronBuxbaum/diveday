import type { AppDb } from "@/db/client";
import { canPersonExportShopData, PAGE_SIZE } from "@/db/export";
import { listBackupDeliveries } from "./delivery-store";
import { getShopBackupDestination } from "./destination-store";

/** Shared access policy; pages await this gate before starting the reader. */
export const BACKUP_SETTINGS_GATE = {
  allow: canPersonExportShopData,
  refusal: { notice: "export-not-authorized" },
} as const;

/** Read only after the page has resolved its shop surface and access policy. */
export async function getBackupSettingsPage(db: AppDb, shopId: string, page: number) {
  const [destination, deliveries, latest] = await Promise.all([
    getShopBackupDestination(db, shopId),
    listBackupDeliveries(db, shopId, { page, pageSize: PAGE_SIZE.section }),
    listBackupDeliveries(db, shopId, { page: 1, pageSize: 1 }),
  ]);
  return { destination, deliveries, latestDelivery: latest.rows[0] ?? null };
}
