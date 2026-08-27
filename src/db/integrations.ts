import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { openSecret, type SecretKey, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import type { AppDb, AppTransaction, DbExecutor } from "./client";
import {
  type IntegrationCredentials,
  type IntegrationProvider,
  type IntegrationSettings,
  integrationDeliveries,
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

/**
 * The live-connection predicate every active read carries.
 *
 * A disconnect stamps `deleted_at` rather than deleting the row (issue #1015),
 * so `shop_integrations` now holds the shop's whole connection history. Every
 * question about what a shop is connected to *right now* — the settings list,
 * the fan-out that decides who an order event is owed to, the dispatcher's join
 * — has to say so, or a shop that disconnected QuickBooks last month keeps
 * getting its orders queued for it.
 */
function liveIntegration() {
  return isNull(shopIntegrations.deletedAt);
}

export async function listShopIntegrations(
  db: DbExecutor,
  shopId: string,
): Promise<ShopIntegration[]> {
  return db
    .select()
    .from(shopIntegrations)
    .where(and(eq(shopIntegrations.shopId, shopId), liveIntegration()))
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
    .where(
      and(
        eq(shopIntegrations.shopId, shopId),
        eq(shopIntegrations.provider, provider),
        liveIntegration(),
      ),
    )
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
      // Must name the partial index's own predicate: the uniqueness is over
      // *live* rows only, so a bare `(shop_id, provider)` target matches no
      // index and Postgres refuses the statement outright.
      target: [shopIntegrations.shopId, shopIntegrations.provider],
      targetWhere: isNull(shopIntegrations.deletedAt),
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
  await adoptUndeliveredDeliveries(db, row);
  return row;
}

/**
 * Reconnecting resumes the queue the disconnect left behind.
 *
 * The story this exists for is the only one there is: a shop's QuickBooks token
 * errors, the owner taps Disconnect and reconnects to fix it, and the
 * `order.paid` events the cron had not drained yet are sitting on the row that
 * was just stamped. Soft-deleting the connection stops them being destroyed
 * (issue #1015) but not stranded — `listDueIntegrationDeliveries` will never
 * look at them again, so without this the orders quietly never reach the books.
 *
 * Only `pending`/`failed` rows move; a `delivered` one stays where it was sent
 * from, because the point of that row is the record of the send. Re-sending is
 * safe regardless: `integration_sync_records` is keyed on `(shop_id, provider)`
 * now, so the customer and item lookups still resolve, and QuickBooks writes
 * carry their own request id.
 */
async function adoptUndeliveredDeliveries(
  db: AppDb | AppTransaction,
  integration: ShopIntegration,
): Promise<void> {
  const predecessors = await db
    .select({ id: shopIntegrations.id })
    .from(shopIntegrations)
    .where(
      and(
        eq(shopIntegrations.shopId, integration.shopId),
        eq(shopIntegrations.provider, integration.provider),
        ne(shopIntegrations.id, integration.id),
      ),
    );
  if (predecessors.length === 0) return;
  // `(integration_id, event_id)` is unique, so an event this connection already
  // carries would make the update *throw* rather than skip it. Read the ids
  // first rather than correlating a subquery against the same table the UPDATE
  // is walking: the set is one connection's deliveries, and a plain
  // `not in (...)` says what it means at a glance.
  const alreadyHere = await db
    .select({ eventId: integrationDeliveries.eventId })
    .from(integrationDeliveries)
    .where(eq(integrationDeliveries.integrationId, integration.id));
  await db
    .update(integrationDeliveries)
    .set({ integrationId: integration.id, updatedAt: now() })
    .where(
      and(
        inArray(
          integrationDeliveries.integrationId,
          predecessors.map((row) => row.id),
        ),
        inArray(integrationDeliveries.status, ["pending", "failed"]),
        ...(alreadyHere.length > 0
          ? [
              notInArray(
                integrationDeliveries.eventId,
                alreadyHere.map((row) => row.eventId),
              ),
            ]
          : []),
      ),
    );
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
    .set({
      settings: input.settings,
      // Saving settings clears a parked error, because for this provider that
      // *is* the fix. A QuickBooks connection is created with its event types
      // set and no income account, so the first paid order fails
      // non-retryably, `markIntegrationError` flips the row to `error`, and
      // `listDueIntegrationDeliveries` only ever looks at `connected` rows --
      // so from then on nothing retried and nothing new was even enqueued. The
      // owner filling in the income account and saving was the one act that
      // should have restarted it, and it wrote only `settings`: the row stayed
      // `error` for good, behind a red badge with no button to clear it.
      status: "connected",
      lastError: null,
      updatedAt: now(),
    })
    .where(
      and(
        eq(shopIntegrations.shopId, input.shopId),
        eq(shopIntegrations.provider, input.provider),
        liveIntegration(),
      ),
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

/**
 * Disconnect: stamp the row, and take the live credential with it.
 *
 * It used to be a plain `DELETE`, which two `ON DELETE CASCADE` children
 * followed — the undelivered outbox and the QuickBooks idempotency map (issue
 * #1015). The row now survives so a stuck queue is still findable and so the
 * shop's connection history reads honestly; the *token* does not, because a
 * disconnected integration holding a live sealed OAuth token is a credential
 * nobody is watching. `credentials_sealed` is `not null`, so it is emptied
 * rather than nulled — `readIntegrationCredentials` answers
 * `invalid_credentials` on an empty envelope, which is the truth about it.
 */
export async function disconnectShopIntegration(
  db: DbExecutor,
  shopId: string,
  provider: IntegrationProvider,
): Promise<void> {
  await db
    .update(shopIntegrations)
    .set({ deletedAt: now(), credentialsSealed: "", lastError: null, updatedAt: now() })
    .where(
      and(
        eq(shopIntegrations.shopId, shopId),
        eq(shopIntegrations.provider, provider),
        liveIntegration(),
      ),
    );
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

/**
 * The identity of one mapping. Scoped to the shop and the provider rather than
 * to a connection row, so it survives a disconnect and reconnect — see the
 * table's own docblock in schema.ts for why that is the whole point of it.
 */
export type IntegrationSyncKey = {
  shopId: string;
  provider: IntegrationProvider;
  sourceType: string;
  sourceId: string;
  operation: string;
};

function syncRecordMatches(key: IntegrationSyncKey) {
  return and(
    eq(integrationSyncRecords.shopId, key.shopId),
    eq(integrationSyncRecords.provider, key.provider),
    eq(integrationSyncRecords.sourceType, key.sourceType),
    eq(integrationSyncRecords.sourceId, key.sourceId),
    eq(integrationSyncRecords.operation, key.operation),
  );
}

export async function getIntegrationSyncRecord(db: DbExecutor, key: IntegrationSyncKey) {
  const [row] = await db
    .select()
    .from(integrationSyncRecords)
    .where(syncRecordMatches(key))
    .limit(1);
  return row ?? null;
}

export async function upsertIntegrationSyncRecord(
  db: DbExecutor,
  input: IntegrationSyncKey & { externalId: string },
) {
  const timestamp = now();
  const [row] = await db
    .insert(integrationSyncRecords)
    .values({ ...input, lastSyncedAt: timestamp, updatedAt: timestamp, lastError: null })
    .onConflictDoUpdate({
      target: [
        integrationSyncRecords.shopId,
        integrationSyncRecords.provider,
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
  input: IntegrationSyncKey & { errorCode: string },
) {
  await db
    .update(integrationSyncRecords)
    .set({ lastError: input.errorCode.slice(0, 200), updatedAt: now() })
    .where(syncRecordMatches(input));
}
