import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";

/**
 * What a shop connects outward: backup destinations and deliveries,
 * integrations (Shopify, QuickBooks, Zapier) and their outbox, and staff
 * calendar feeds.
 */

export const shopBackupDestinations = pgTable("shop_backup_destinations", {
  /** One destination per shop, like `shop_whatsapp_accounts` — reconfiguring is an upsert, never a second row. */
  shopId: uuid("shop_id")
    .primaryKey()
    .references(() => shops.id),
  /**
   * The S3-compatible API origin the weekly bundle is PUT to — AWS S3, Cloudflare
   * R2, Backblaze B2, MinIO, anything speaking SigV4. HTTPS only, and never a
   * loopback/private host; `src/features/backup-export` refuses those before a
   * row is written (the server is the one making this request).
   */
  endpoint: text("endpoint").notNull(),
  /** The SigV4 signing region ("us-east-1", "auto" for R2). Part of the signature, not routing. */
  region: text("region").notNull(),
  bucket: text("bucket").notNull(),
  /** Optional key prefix inside the bucket ("diveday/"); empty means the bucket root. */
  prefix: text("prefix").notNull().default(""),
  /**
   * The credential's public identifier. Stored plain — it names the key the
   * way a Stripe account id names an account — and shown back to staff so they
   * can tell which credential is connected.
   */
  accessKeyId: text("access_key_id").notNull(),
  /**
   * The secret access key, sealed with AES-256-GCM (`src/lib/secret-box.ts`) —
   * never plaintext, exactly like `shop_whatsapp_accounts.access_token_sealed`.
   * It is a live credential to storage the shop owns; a database dump must not
   * be enough to use it, and no code path ever returns it to a caller or a UI.
   */
  secretAccessKeySealed: text("secret_access_key_sealed").notNull(),
  connectedAt: appNowTimestamp("connected_at").notNull(),
  /** Set when a delivery has actually landed in the bucket, so staff see proven rather than merely saved. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  updatedAt: appNowTimestamp("updated_at").notNull(),
});

export const backupDeliveryStatus = pgEnum("backup_delivery_status", [
  "started",
  "succeeded",
  "failed",
  "superseded",
]);

export const backupDeliveryTrigger = pgEnum("backup_delivery_trigger", ["scheduled", "manual"]);

/**
 * One row per backup delivery attempt — the shop-visible answer to "when did
 * my data last actually land in my bucket". Append-only: a row is inserted as
 * `started` and finished in place as `succeeded`/`failed`, so a crash
 * mid-delivery leaves an honest `started` row rather than silence.
 * `error_code` carries a code, never a sentence — the UI picks the words
 * (ADR 20260731-domain-layer-copy-leaks).
 */
export const shopBackupDeliveries = pgTable(
  "shop_backup_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /**
     * The ISO week this delivery covers ("2026-W32"). The weekly cron skips a
     * shop that already has a succeeded scheduled delivery for the period, so a
     * re-invoked cron never uploads the same week twice.
     */
    periodKey: text("period_key").notNull(),
    trigger: backupDeliveryTrigger("trigger").notNull(),
    status: backupDeliveryStatus("status").notNull(),
    /** Where in the bucket the bundle went (prefix included); null until the key is computed. */
    objectKey: text("object_key"),
    /** Uploaded bundle size in bytes; bigint because a photo-heavy shop clears 2 GiB. */
    byteCount: bigint("byte_count", { mode: "number" }),
    errorCode: text("error_code"),
    startedAt: appNowTimestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("shop_backup_deliveries_shop_started_idx").on(table.shopId, table.startedAt),
    index("shop_backup_deliveries_shop_period_idx").on(table.shopId, table.periodKey),
  ],
);

/**
 * One scheduled shop backup claim per shop and ISO week; attempt tokens fence late workers.
 * Completed and expired claims are retained 400 days.
 */
export const shopBackupDeliveryClaims = pgTable(
  "shop_backup_delivery_claims",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.shopId, table.periodKey] }),
    index("shop_backup_delivery_claims_lease_idx").on(table.leaseUntil),
  ],
);

/**
 * The platform's scheduler checkpoint for each shop, kept separate from the
 * shop-visible history for destinations the shop owns. One row per shop makes
 * scheduling fair across weeks without retaining an unbounded attempt history.
 */
export const platformBackupProgress = pgTable(
  "platform_backup_progress",
  {
    shopId: uuid("shop_id")
      .primaryKey()
      .references(() => shops.id, { onDelete: "cascade" }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
  },
  (table) => [
    index("platform_backup_progress_attempted_idx").on(table.lastAttemptAt),
    index("platform_backup_progress_lease_idx").on(table.leaseUntil),
  ],
);

/** Provider ids are deliberately closed here; adding a provider requires a registry entry. */
export const integrationProvider = pgEnum("integration_provider", [
  "shopify",
  "quickbooks",
  "zapier",
  "square",
]);

export const integrationConnectionStatus = pgEnum("integration_connection_status", [
  "connected",
  "error",
]);

export const integrationDeliveryStatus = pgEnum("integration_delivery_status", [
  "pending",
  "processing",
  "delivered",
  "failed",
]);

/** Non-secret provider configuration. Secrets and OAuth tokens live sealed in credentials_sealed. */
export type IntegrationSettings = {
  eventTypes?: string[];
  shopDomain?: string;
  environment?: "sandbox" | "production";
  incomeAccountId?: string;
  squareLocationId?: string;
  squareLocationName?: string;
};

/** The one encrypted credential envelope shared by OAuth and webhook providers. */
export type IntegrationCredentials = Record<string, string | number | undefined>;

/** One connected provider per shop. A row is the registry's durable installation record. */
export const shopIntegrations = pgTable(
  "shop_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    provider: integrationProvider("provider").notNull(),
    status: integrationConnectionStatus("status").notNull().default("connected"),
    /** Realm id, Shopify shop id, or another non-secret provider identifier. */
    externalAccountId: text("external_account_id"),
    /** Safe display label, never an access token or URL secret. */
    externalLabel: text("external_label"),
    credentialsSealed: text("credentials_sealed").notNull(),
    settings: jsonb("settings").$type<IntegrationSettings>().notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    connectedAt: appNowTimestamp("connected_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
    /**
     * Disconnected, not destroyed (ADR 20260820-every-delete-is-soft). Tapping
     * Disconnect used to `DELETE` this row, and the two `ON DELETE CASCADE`
     * children went with it — the undelivered outbox and, worse, the QuickBooks
     * idempotency map, so reconnecting after an errored token re-created every
     * already-synced customer (issue #1015). The unique index below is partial
     * over live rows precisely so a reconnect can insert a fresh row beside the
     * stamped one.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("shop_integrations_shop_provider_unique")
      .on(table.shopId, table.provider)
      .where(sql`${table.deletedAt} is null`),
    index("shop_integrations_shop_status_idx").on(table.shopId, table.status),
  ],
);

/** Short-lived, one-time OAuth state. Only the hash of the browser state is stored. */
export const integrationOauthStates = pgTable(
  "integration_oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stateHash: text("state_hash").notNull(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    provider: integrationProvider("provider").notNull(),
    context: jsonb("context").$type<Record<string, string>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("integration_oauth_states_hash_unique").on(table.stateHash),
    index("integration_oauth_states_expiry_idx").on(table.expiresAt),
  ],
);

/** Transactional business event. The idempotency key makes order replays harmless. */
export const integrationEvents = pgTable(
  "integration_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("integration_events_shop_idempotency_unique").on(
      table.shopId,
      table.idempotencyKey,
    ),
    index("integration_events_shop_created_idx").on(table.shopId, table.createdAt),
  ],
);

/** Delivery state for one event/provider pair. This is the retryable outbox. */
export const integrationDeliveries = pgTable(
  "integration_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => shopIntegrations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => integrationEvents.id, { onDelete: "cascade" }),
    status: integrationDeliveryStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: appNowTimestamp("next_attempt_at").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("integration_deliveries_integration_event_unique").on(
      table.integrationId,
      table.eventId,
    ),
    index("integration_deliveries_due_idx").on(table.status, table.nextAttemptAt),
    index("integration_deliveries_shop_created_idx").on(table.shopId, table.createdAt),
  ],
);

/**
 * Idempotent mapping from a DiveDay source record to a provider record.
 *
 * **Keyed on `(shop_id, provider)`, deliberately not on one `shop_integrations`
 * row.** This table is the *only* thing that stops `ensureQuickBooksCustomer`
 * POSTing a second Customer with the same `DisplayName` for a diver it has
 * already synced, and a shop reconnects a provider exactly when something has
 * gone wrong — an errored token, a re-auth. Hanging it off the connection row
 * meant the mapping either cascaded away with the disconnect or, once the
 * disconnect went soft, sat orphaned beside a new row that started with an
 * empty map: both spellings of the same duplicate (issue #1015). A connection
 * is a credential; the mapping is a fact about the shop's own books, and it
 * outlives any one credential.
 */
export const integrationSyncRecords = pgTable(
  "integration_sync_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    provider: integrationProvider("provider").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    operation: text("operation").notNull(),
    externalId: text("external_id").notNull(),
    /** Minimal read-only Square receipt observation; never raw provider payloads or card data. */
    receiptEvidence: jsonb("receipt_evidence").$type<{
      environment: "sandbox" | "production";
      merchantId: string;
      paymentId: string;
      locationId: string;
      currency: string;
      totalCents: number;
      tipCents: number;
      refundedCents: number;
      receiptNumber: string | null;
    }>(),
    lastSyncedAt: appNowTimestamp("last_synced_at").notNull(),
    lastError: text("last_error"),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("integration_sync_records_source_unique").on(
      table.shopId,
      table.provider,
      table.sourceType,
      table.sourceId,
      table.operation,
    ),
    // One Square payment can evidence only one order, even across shops sharing a merchant.
    uniqueIndex("integration_sync_records_square_receipt_unique")
      .on(table.externalId)
      .where(
        sql`${table.sourceType} = 'square_payment_receipt' and ${table.operation} = 'receipt'`,
      ),
    index("integration_sync_records_external_idx").on(
      table.shopId,
      table.provider,
      table.externalId,
    ),
  ],
);

export type ShopBackupDestination = typeof shopBackupDestinations.$inferSelect;

export type ShopBackupDelivery = typeof shopBackupDeliveries.$inferSelect;

export type BackupDeliveryTrigger = (typeof backupDeliveryTrigger.enumValues)[number];

export type IntegrationProvider = (typeof integrationProvider.enumValues)[number];

export type IntegrationConnectionStatus = (typeof integrationConnectionStatus.enumValues)[number];

export type IntegrationDeliveryStatus = (typeof integrationDeliveryStatus.enumValues)[number];

export type ShopIntegration = typeof shopIntegrations.$inferSelect;

export type IntegrationOauthState = typeof integrationOauthStates.$inferSelect;

export type IntegrationEvent = typeof integrationEvents.$inferSelect;

export type IntegrationDelivery = typeof integrationDeliveries.$inferSelect;

export type IntegrationSyncRecord = typeof integrationSyncRecords.$inferSelect;
