import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../db/client";
import { queryAll } from "../../db/query-helpers";
import {
  capabilities,
  shopBackupDestinations,
  shopIntegrations,
  shopStripeAccounts,
  shopWhatsappAccounts,
} from "../../db/schema/index";
import { reusablePurposes } from "../../lib/capabilities";
import { type Connection, shopConnections } from "./rules";

/**
 * Every connection of one shop, in ledger order (issue #2741). Reads only the
 * columns `connectionState` derives from: no sealed credential, token hash or
 * provider id leaves this function.
 */
export async function readShopConnections(db: DbExecutor, shopId: string): Promise<Connection[]> {
  const [stripe, whatsapp, integrations, backups, feeds] = await queryAll(db, [
    () =>
      db
        .select({
          chargesEnabled: shopStripeAccounts.chargesEnabled,
          paymentsRestrictedAt: shopStripeAccounts.paymentsRestrictedAt,
          disconnectedAt: shopStripeAccounts.disconnectedAt,
          connectedAt: shopStripeAccounts.connectedAt,
          updatedAt: shopStripeAccounts.updatedAt,
        })
        .from(shopStripeAccounts)
        .where(eq(shopStripeAccounts.shopId, shopId)),
    () =>
      db
        .select({
          connectedAt: shopWhatsappAccounts.connectedAt,
          verifiedAt: shopWhatsappAccounts.verifiedAt,
        })
        .from(shopWhatsappAccounts)
        .where(eq(shopWhatsappAccounts.shopId, shopId)),
    // Disconnected rows too: they are what makes a provider `disconnected`
    // rather than `notConnected`.
    () =>
      db
        .select({
          provider: shopIntegrations.provider,
          status: shopIntegrations.status,
          lastSyncedAt: shopIntegrations.lastSyncedAt,
          connectedAt: shopIntegrations.connectedAt,
          deletedAt: shopIntegrations.deletedAt,
        })
        .from(shopIntegrations)
        .where(eq(shopIntegrations.shopId, shopId)),
    () =>
      db
        .select({
          connectedAt: shopBackupDestinations.connectedAt,
          verifiedAt: shopBackupDestinations.verifiedAt,
        })
        .from(shopBackupDestinations)
        .where(eq(shopBackupDestinations.shopId, shopId)),
    () =>
      db
        // The staff calendar feeds: the shop's reusable capabilities.
        .select({
          lastAccessedAt: capabilities.lastAccessedAt,
          revokedAt: capabilities.revokedAt,
        })
        .from(capabilities)
        .where(
          and(eq(capabilities.shopId, shopId), inArray(capabilities.purpose, reusablePurposes())),
        ),
  ]);
  return shopConnections({
    stripe: stripe[0] ?? null,
    whatsapp: whatsapp[0] ?? null,
    integrations,
    backups: backups[0] ?? null,
    calendarFeeds: feeds,
  });
}
