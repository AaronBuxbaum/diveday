import { and, asc, eq, isNull } from "drizzle-orm";
import type { SealedSecretSample } from "@/lib/secret-box";
import type { DbExecutor } from "./client";
import {
  shopBackupDestinations,
  shopIntegrations,
  shops,
  shopWhatsappAccounts,
} from "./schema";

/**
 * One stored value of each sealed-secret kind the deploy's key check samples
 * besides two-factor (`keyringOpensSamples`, `scripts/check-sealing-keys.ts`;
 * issue #3022): a WhatsApp access token, a connector's credential envelope and
 * a backup destination's access key. The oldest row of each kind, because the
 * oldest is the one most likely still sealed under a previous key. Read-only.
 * Left out: a demo shop, whose seeded backup key is deliberately not a real
 * sealed value (`seedBackup`) and would fail every deploy; and a connector
 * that was disconnected, as it is nowhere read.
 */
export async function sealedSecretSamples(
  db: DbExecutor,
): Promise<SealedSecretSample[]> {
  const [whatsapp] = await db
    .select({ sealed: shopWhatsappAccounts.accessTokenSealed })
    .from(shopWhatsappAccounts)
    .innerJoin(shops, eq(shops.id, shopWhatsappAccounts.shopId))
    .where(eq(shops.isDemo, false))
    .orderBy(
      asc(shopWhatsappAccounts.connectedAt),
      asc(shopWhatsappAccounts.shopId),
    )
    .limit(1);
  const [connector] = await db
    .select({ sealed: shopIntegrations.credentialsSealed })
    .from(shopIntegrations)
    .innerJoin(shops, eq(shops.id, shopIntegrations.shopId))
    .where(and(isNull(shopIntegrations.deletedAt), eq(shops.isDemo, false)))
    .orderBy(asc(shopIntegrations.connectedAt), asc(shopIntegrations.id))
    .limit(1);
  const [backup] = await db
    .select({ sealed: shopBackupDestinations.secretAccessKeySealed })
    .from(shopBackupDestinations)
    .innerJoin(shops, eq(shops.id, shopBackupDestinations.shopId))
    .where(eq(shops.isDemo, false))
    .orderBy(
      asc(shopBackupDestinations.connectedAt),
      asc(shopBackupDestinations.shopId),
    )
    .limit(1);
  return [
    whatsapp && { kind: "whatsapp" as const, sealed: whatsapp.sealed },
    connector && { kind: "connector" as const, sealed: connector.sealed },
    backup && { kind: "backup" as const, sealed: backup.sealed },
  ].filter((sample): sample is SealedSecretSample => Boolean(sample));
}
