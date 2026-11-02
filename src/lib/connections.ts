import type {
  ShopBackupDestination,
  ShopIntegration,
  ShopStripeAccount,
  ShopWhatsappAccount,
} from "@/db/schema";

/**
 * **A Connection** is a thing outside the shop that DiveDay talks to on the
 * shop's behalf: Stripe, the shop's WhatsApp number, Shopify, QuickBooks,
 * Zapier, the backup bucket, and the staff calendar feeds (issue #2741).
 *
 * Each one keeps its own credential table, because each seals a different
 * secret, and each table already says whether it is on and when it last
 * worked. What was missing was one word for that answer. `connectionState`
 * derives it from the row's own columns, with no state column and no table of
 * its own, so a page that shows a connection and the flow that changes it can
 * never disagree about which state it is in.
 *
 * The four states, as codes (the page words them):
 *
 * - `notConnected`: there is no row. The shop never connected it.
 * - `connected`: it is on and nothing about it needs the shop.
 * - `needsAttention`: it is on, but the provider has refused or not finished
 *   something only the shop can fix (Stripe has turned card payments off, an
 *   integration's last sync errored).
 * - `disconnected`: the shop or the provider turned it off and the row
 *   remembers that it was once on.
 */
export const CONNECTION_STATES = [
  "notConnected",
  "connected",
  "needsAttention",
  "disconnected",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];

/** Every connection a shop can have, in the order the ledger lists them. */
export const CONNECTION_PROVIDERS = [
  "stripe",
  "whatsapp",
  "shopify",
  "quickbooks",
  "zapier",
  "backups",
  "calendarFeeds",
] as const;

export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

/** One line of the ledger: which connection, its state, and when it last worked. */
export type Connection = {
  provider: ConnectionProvider;
  state: ConnectionState;
  /** When it last proved itself, or null when nothing has proved it yet. */
  lastSeenAt: Date | null;
};

/** The columns of each row shape the state is derived from, and nothing sealed. */
export type StripeConnectionRow = Pick<
  ShopStripeAccount,
  "chargesEnabled" | "paymentsRestrictedAt" | "disconnectedAt" | "connectedAt" | "updatedAt"
>;
export type WhatsappConnectionRow = Pick<ShopWhatsappAccount, "connectedAt" | "verifiedAt">;
export type IntegrationConnectionRow = Pick<
  ShopIntegration,
  "provider" | "status" | "lastSyncedAt" | "connectedAt" | "deletedAt"
>;
export type BackupConnectionRow = Pick<ShopBackupDestination, "connectedAt" | "verifiedAt">;
/** A staff calendar feed: live until revoked, seen when a calendar last fetched it. */
export type CalendarFeedConnectionRow = {
  lastAccessedAt: Date | null;
  revokedAt: Date | null;
};

/** Everything `shopConnections` reads: one optional row per single-row table, every row of the rest. */
export type ConnectionRows = {
  stripe: StripeConnectionRow | null;
  whatsapp: WhatsappConnectionRow | null;
  /** Live rows and disconnected ones; a live row wins over a disconnected one. */
  integrations: readonly IntegrationConnectionRow[];
  backups: BackupConnectionRow | null;
  calendarFeeds: readonly CalendarFeedConnectionRow[];
};

/** The latest of some instants, ignoring the missing ones. */
function latest(...instants: readonly (Date | null | undefined)[]): Date | null {
  let best: Date | null = null;
  for (const instant of instants) {
    if (instant && (!best || instant.getTime() > best.getTime())) best = instant;
  }
  return best;
}

/**
 * Stripe. A deauthorize stamps `disconnected_at`; card payments off (Stripe
 * restricted the account, or onboarding is unfinished) is the shop's to fix.
 */
export function stripeConnection(row: StripeConnectionRow | null): Connection {
  if (!row) return { provider: "stripe", state: "notConnected", lastSeenAt: null };
  if (row.disconnectedAt) {
    return { provider: "stripe", state: "disconnected", lastSeenAt: row.disconnectedAt };
  }
  const state: ConnectionState =
    row.paymentsRestrictedAt || !row.chargesEnabled ? "needsAttention" : "connected";
  return { provider: "stripe", state, lastSeenAt: row.updatedAt };
}

/**
 * WhatsApp. Disconnecting deletes the row (it holds a live credential), so
 * there is no `disconnected` here: no row is `notConnected`. Last seen is the
 * test send that proved it, else the moment it was connected.
 */
export function whatsappConnection(row: WhatsappConnectionRow | null): Connection {
  if (!row) return { provider: "whatsapp", state: "notConnected", lastSeenAt: null };
  return {
    provider: "whatsapp",
    state: "connected",
    lastSeenAt: row.verifiedAt ?? row.connectedAt,
  };
}

/**
 * One integration provider. A live row (no `deleted_at`) is the answer when
 * there is one; otherwise the latest disconnected row says it was once on.
 */
export function integrationConnection(
  provider: IntegrationConnectionRow["provider"],
  rows: readonly IntegrationConnectionRow[],
): Connection {
  const mine = rows.filter((row) => row.provider === provider);
  const live = mine.find((row) => !row.deletedAt);
  if (live) {
    return {
      provider,
      state: live.status === "error" ? "needsAttention" : "connected",
      lastSeenAt: live.lastSyncedAt ?? live.connectedAt,
    };
  }
  const lastDisconnect = latest(...mine.map((row) => row.deletedAt));
  if (lastDisconnect) return { provider, state: "disconnected", lastSeenAt: lastDisconnect };
  return { provider, state: "notConnected", lastSeenAt: null };
}

/**
 * The backup bucket. One row, removed on disconnect; last seen is the
 * delivery that actually landed, so a bucket nothing has reached yet says so.
 */
export function backupsConnection(row: BackupConnectionRow | null): Connection {
  if (!row) return { provider: "backups", state: "notConnected", lastSeenAt: null };
  return { provider: "backups", state: "connected", lastSeenAt: row.verifiedAt };
}

/**
 * The staff calendar feeds, read in by calendar apps. Any live feed is
 * `connected`, seen when a calendar last fetched any of them; only revoked
 * feeds is `disconnected`.
 */
export function calendarFeedsConnection(rows: readonly CalendarFeedConnectionRow[]): Connection {
  const live = rows.filter((row) => !row.revokedAt);
  if (live.length > 0) {
    return {
      provider: "calendarFeeds",
      state: "connected",
      lastSeenAt: latest(...live.map((row) => row.lastAccessedAt)),
    };
  }
  const lastRevoke = latest(...rows.map((row) => row.revokedAt));
  if (lastRevoke)
    return { provider: "calendarFeeds", state: "disconnected", lastSeenAt: lastRevoke };
  return { provider: "calendarFeeds", state: "notConnected", lastSeenAt: null };
}

/** One connection's state from the rows, for a caller that has already read them. */
export function connectionState(provider: ConnectionProvider, rows: ConnectionRows): Connection {
  switch (provider) {
    case "stripe":
      return stripeConnection(rows.stripe);
    case "whatsapp":
      return whatsappConnection(rows.whatsapp);
    case "shopify":
    case "quickbooks":
    case "zapier":
      return integrationConnection(provider, rows.integrations);
    case "backups":
      return backupsConnection(rows.backups);
    case "calendarFeeds":
      return calendarFeedsConnection(rows.calendarFeeds);
  }
}

/** Every connection of the shop, in ledger order. */
export function shopConnections(rows: ConnectionRows): Connection[] {
  return CONNECTION_PROVIDERS.map((provider) => connectionState(provider, rows));
}
