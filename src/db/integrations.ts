import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { openSecret, type SecretKey, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import type { AppDb, AppTransaction, DbExecutor } from "./client";
import {
  type IntegrationCredentials,
  type IntegrationProvider,
  type IntegrationSettings,
  integrationOauthStates,
  integrationSyncRecords,
  type ShopIntegration,
  shopIntegrations,
} from "./schema";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type IntegrationKeyRefusal = "encryption_key_unset" | "encryption_key_invalid";

export type IntegrationCredentialResult =
  | { status: "ok"; credentials: IntegrationCredentials }
  | { status: IntegrationKeyRefusal | "invalid_credentials" };

function encryptionKey(): SecretKey | IntegrationKeyRefusal {
  const result = secretKeyFromEnvironment();
  if (result.status === "ok") return result.key;
  return result.status === "unset" ? "encryption_key_unset" : "encryption_key_invalid";
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function now(): Date {
  return nowDate();
}

export async function listShopIntegrations(
  db: DbExecutor,
  shopId: string,
): Promise<ShopIntegration[]> {
  return db
    .select()
    .from(shopIntegrations)
    .where(eq(shopIntegrations.shopId, shopId))
    .orderBy(asc(shopIntegrations.provider));
}

export async function getShopIntegration(
  db: DbExecutor,
  shopId: string,
  provider: IntegrationProvider,
): Promise<ShopIntegration | null> {
  const [row] = await db
    .select()
    .from(shopIntegrations)
    .where(and(eq(shopIntegrations.shopId, shopId), eq(shopIntegrations.provider, provider)))
    .limit(1);
  return row ?? null;
}

export async function readIntegrationCredentials(
  integration: ShopIntegration,
): Promise<IntegrationCredentialResult> {
  const key = encryptionKey();
  if (typeof key === "string") return { status: key };
  try {
    const opened = openSecret(integration.credentialsSealed, key);
    if (!opened) return { status: "invalid_credentials" };
    const parsed = JSON.parse(opened) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "invalid_credentials" };
    }
    return { status: "ok", credentials: parsed as IntegrationCredentials };
  } catch {
    return { status: "invalid_credentials" };
  }
}

export async function saveShopIntegration(
  db: AppDb | AppTransaction,
  input: {
    shopId: string;
    provider: IntegrationProvider;
    credentials: IntegrationCredentials;
    externalAccountId?: string | null;
    externalLabel?: string | null;
    settings?: IntegrationSettings;
  },
): Promise<ShopIntegration> {
  const key = encryptionKey();
  if (typeof key === "string") throw new Error(key);
  const timestamp = now();
  const credentialsSealed = sealSecret(JSON.stringify(input.credentials), key);
  const [row] = await db
    .insert(shopIntegrations)
    .values({
      shopId: input.shopId,
      provider: input.provider,
      status: "connected",
      externalAccountId: input.externalAccountId ?? null,
      externalLabel: input.externalLabel ?? null,
      credentialsSealed,
      settings: input.settings ?? {},
      lastError: null,
      connectedAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [shopIntegrations.shopId, shopIntegrations.provider],
      set: {
        status: "connected",
        externalAccountId: input.externalAccountId ?? null,
        externalLabel: input.externalLabel ?? null,
        credentialsSealed,
        settings: input.settings ?? {},
        lastError: null,
        updatedAt: timestamp,
      },
    })
    .returning();
  if (!row) throw new Error("saveShopIntegration: insert returned no row");
  return row;
}

export async function updateShopIntegrationSettings(
  db: DbExecutor,
  input: {
    shopId: string;
    provider: IntegrationProvider;
    settings: IntegrationSettings;
  },
): Promise<ShopIntegration | null> {
  const [row] = await db
    .update(shopIntegrations)
    .set({ settings: input.settings, updatedAt: now() })
    .where(
      and(eq(shopIntegrations.shopId, input.shopId), eq(shopIntegrations.provider, input.provider)),
    )
    .returning();
  return row ?? null;
}

export async function markIntegrationError(
  db: DbExecutor,
  integrationId: string,
  errorCode: string,
): Promise<void> {
  await db
    .update(shopIntegrations)
    .set({ status: "error", lastError: errorCode.slice(0, 200), updatedAt: now() })
    .where(eq(shopIntegrations.id, integrationId));
}

export async function markIntegrationHealthy(db: DbExecutor, integrationId: string): Promise<void> {
  await db
    .update(shopIntegrations)
    .set({ status: "connected", lastError: null, lastSyncedAt: now(), updatedAt: now() })
    .where(eq(shopIntegrations.id, integrationId));
}

export async function disconnectShopIntegration(
  db: DbExecutor,
  shopId: string,
  provider: IntegrationProvider,
): Promise<void> {
  await db
    .delete(shopIntegrations)
    .where(and(eq(shopIntegrations.shopId, shopId), eq(shopIntegrations.provider, provider)));
}

/** Creates a browser state and stores only its SHA-256 digest. */
export async function createIntegrationOAuthState(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    provider: IntegrationProvider;
    context?: Record<string, string>;
  },
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await db.insert(integrationOauthStates).values({
    stateHash: stateHash(state),
    shopId: input.shopId,
    personId: input.personId,
    provider: input.provider,
    context: input.context ?? {},
    expiresAt: new Date(now().getTime() + OAUTH_STATE_TTL_MS),
  });
  return state;
}

/** Atomically consumes a valid state, so a callback cannot be replayed. */
export async function consumeIntegrationOAuthState(
  db: AppDb,
  input: { state: string; provider: IntegrationProvider },
): Promise<{
  shopId: string;
  personId: string;
  provider: IntegrationProvider;
  context: Record<string, string>;
} | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(integrationOauthStates)
      .where(
        and(
          eq(integrationOauthStates.stateHash, stateHash(input.state)),
          eq(integrationOauthStates.provider, input.provider),
          gt(integrationOauthStates.expiresAt, now()),
        ),
      )
      .for("update")
      .limit(1);
    if (!row) return null;
    await tx.delete(integrationOauthStates).where(eq(integrationOauthStates.id, row.id));
    return {
      shopId: row.shopId,
      personId: row.personId,
      provider: row.provider,
      context: row.context,
    };
  });
}

export async function getIntegrationSyncRecord(
  db: DbExecutor,
  input: { integrationId: string; sourceType: string; sourceId: string; operation: string },
) {
  const [row] = await db
    .select()
    .from(integrationSyncRecords)
    .where(
      and(
        eq(integrationSyncRecords.integrationId, input.integrationId),
        eq(integrationSyncRecords.sourceType, input.sourceType),
        eq(integrationSyncRecords.sourceId, input.sourceId),
        eq(integrationSyncRecords.operation, input.operation),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function upsertIntegrationSyncRecord(
  db: DbExecutor,
  input: {
    integrationId: string;
    sourceType: string;
    sourceId: string;
    operation: string;
    externalId: string;
  },
) {
  const timestamp = now();
  const [row] = await db
    .insert(integrationSyncRecords)
    .values({ ...input, lastSyncedAt: timestamp, updatedAt: timestamp, lastError: null })
    .onConflictDoUpdate({
      target: [
        integrationSyncRecords.integrationId,
        integrationSyncRecords.sourceType,
        integrationSyncRecords.sourceId,
        integrationSyncRecords.operation,
      ],
      set: {
        externalId: input.externalId,
        lastSyncedAt: timestamp,
        updatedAt: timestamp,
        lastError: null,
      },
    })
    .returning();
  return row ?? null;
}

export async function markIntegrationSyncError(
  db: DbExecutor,
  input: {
    integrationId: string;
    sourceType: string;
    sourceId: string;
    operation: string;
    errorCode: string;
  },
) {
  await db
    .update(integrationSyncRecords)
    .set({ lastError: input.errorCode.slice(0, 200), updatedAt: now() })
    .where(
      and(
        eq(integrationSyncRecords.integrationId, input.integrationId),
        eq(integrationSyncRecords.sourceType, input.sourceType),
        eq(integrationSyncRecords.sourceId, input.sourceId),
        eq(integrationSyncRecords.operation, input.operation),
      ),
    );
}
