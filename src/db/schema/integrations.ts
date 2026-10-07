import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { people, shops } from "./core";

/**
 * What a shop connects outward: backup destinations and deliveries,
 * integrations (Shopify, QuickBooks, Xero, Zapier) and their outbox, and staff
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
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when a delivery has actually landed in the bucket, so staff see proven rather than merely saved. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const backupDeliveryStatus = pgEnum("backup_delivery_status", [
  "started",
  "succeeded",
  "failed",
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
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("shop_backup_deliveries_shop_started_idx").on(table.shopId, table.startedAt),
    index("shop_backup_deliveries_shop_period_idx").on(table.shopId, table.periodKey),
  ],
);

/** Provider ids are deliberately closed here; adding a provider requires a registry entry. */
export const integrationProvider = pgEnum("integration_provider", [
  "shopify",
  "quickbooks",
  "zapier",
  "xero",
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
  /** Xero chart-of-accounts codes: where the sale lands, and which bank account took the money. */
  salesAccountCode?: string;
  bankAccountCode?: string;
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
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_sync_records_source_unique").on(
      table.shopId,
      table.provider,
      table.sourceType,
      table.sourceId,
      table.operation,
    ),
    index("integration_sync_records_external_idx").on(
      table.shopId,
      table.provider,
      table.externalId,
    ),
  ],
);

/**
 * What a `calendar_feeds` row exposes. `assignments` is one staff member's own
 * crewed departures; `shop_trips` is every scheduled departure at the shop, for
 * an owner or manager who keeps the whole operation on one calendar.
 */
export const calendarFeedScope = pgEnum("calendar_feed_scope", ["assignments", "shop_trips"]);

/**
 * A long-lived, revocable bearer credential over a read-only iCalendar feed
 * (docs ADR 20260730-calendar-feed-subscriptions). Google, Apple, and Outlook
 * subscribe by URL and poll it on their own schedule, so unlike a
 * `booking_capabilities` row this one has no expiry: a feed that died after 60
 * days would silently stop updating a captain's calendar, which is worse than
 * the credential living until it is rotated. Rotation is the mitigation, and
 * `issueCalendarFeed` revokes the prior row for the same person+scope so a
 * leaked URL stops working the moment a new one is minted.
 *
 * Only the hash is stored; the raw token exists solely in the response that
 * issued it, which is why the staff page can show the URL once and thereafter
 * only offers to rotate it.
 */
export const calendarFeeds = pgTable(
  "calendar_feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    scope: calendarFeedScope("scope").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Stamped on each successful fetch so staff can tell a subscribed calendar
     * from a URL nobody ever pasted anywhere. Deliberately coarse — calendar
     * clients poll often, and a per-hit write on a hot path buys nothing.
     */
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The verify-path lookup: hash the bearer token, find the row.
    index("calendar_feeds_token_hash_idx").on(table.tokenHash),
    // "Does this person already have a live feed for this scope?" — the
    // issue/rotate path and the staff settings panel both ask exactly this.
    index("calendar_feeds_person_scope_idx").on(table.personId, table.scope, table.revokedAt),
    /**
     * At most one *live* feed per person and scope, enforced by the database
     * rather than by `issueCalendarFeed`'s revoke-then-insert being careful.
     *
     * Under READ COMMITTED, two concurrent issues for the same person+scope
     * can each find nothing to revoke and both insert, leaving two live
     * tokens — which quietly breaks the promise this feature is built on,
     * that minting a link is what retires the previous one. The old token
     * does still get revoked in every interleaving, so this is not a way to
     * keep a leaked URL alive; it is the "issue == rotate" invariant that
     * fails, and the settings panel would then show two subscriptions where
     * the model says there is one.
     */
    uniqueIndex("calendar_feeds_live_person_scope_idx")
      .on(table.personId, table.scope)
      .where(sql`${table.revokedAt} IS NULL`),
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
