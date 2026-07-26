import { sql } from "drizzle-orm";
import { Client } from "pg";
import type { AppDb } from "./client";
import { withExplicitSslMode } from "./connection-string";

export type ManifestEvent = { shopId: string; tripId: string };
type Listener = ManifestEvent & { onEvent: () => void };

const NOTIFY_CHANNEL = "manifest_events";
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

// Survive Next.js dev-server HMR the same way src/db/client.ts's db promise
// does: module state resets on reload, globalThis doesn't.
const globalForManifestEvents = globalThis as unknown as {
  divedayManifestListeners?: Set<Listener>;
  divedayManifestListenStarted?: boolean;
};

function listeners(): Set<Listener> {
  globalForManifestEvents.divedayManifestListeners ??= new Set();
  return globalForManifestEvents.divedayManifestListeners;
}

function dispatch(event: ManifestEvent): void {
  for (const listener of listeners()) {
    if (listener.shopId === event.shopId && listener.tripId === event.tripId) listener.onEvent();
  }
}

/**
 * One dedicated LISTEN connection per warm process, shared by every
 * subscriber in it — never one per SSE viewer (see ADR 20260726-manifest-push-refresh
 * for why: Neon direct connections are the scarcer resource, not app-level
 * fan-out). NOTIFY/LISTEN needs a persistent session, which Neon's pooled
 * (PgBouncer transaction-mode) DATABASE_URL cannot hold, so this always dials
 * the direct connection string. Reconnects with backoff on drop; while down,
 * subscribers simply get no push — the caller's own poll/reconnect/visibility
 * fallback is what covers that gap, not this module.
 */
function ensureListening(): void {
  if (globalForManifestEvents.divedayManifestListenStarted) return;
  globalForManifestEvents.divedayManifestListenStarted = true;
  void connectAndListen(RECONNECT_BASE_MS);
}

async function connectAndListen(retryDelayMs: number): Promise<void> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString: withExplicitSslMode(connectionString) });
  let reconnecting = false;
  const reconnect = () => {
    if (reconnecting) return;
    reconnecting = true;
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    setTimeout(
      () => void connectAndListen(Math.min(retryDelayMs * 2, RECONNECT_MAX_MS)),
      retryDelayMs,
    );
  };
  client.on("error", reconnect);
  client.on("end", reconnect);
  client.on("notification", (message) => {
    if (message.channel !== NOTIFY_CHANNEL || !message.payload) return;
    try {
      const parsed = JSON.parse(message.payload);
      if (typeof parsed?.shopId === "string" && typeof parsed?.tripId === "string") {
        dispatch({ shopId: parsed.shopId, tripId: parsed.tripId });
      }
    } catch {
      // A malformed payload (a future/rolled-back version of this code
      // publishing a different shape) is dropped rather than crashing the
      // one listener every trip's stream shares.
    }
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
  } catch {
    reconnect();
  }
}

/**
 * Subscribe to "trip X's roll call changed." Backed by Postgres LISTEN/NOTIFY
 * when DATABASE_URL is set (production/Neon); falls back to an in-process
 * dispatch with the same filtering semantics otherwise (dev/test on PGlite,
 * which has no cross-process notify to model). Returns an unsubscribe
 * function.
 */
export function subscribeManifestEvents(
  shopId: string,
  tripId: string,
  onEvent: () => void,
): () => void {
  if (process.env.DATABASE_URL) ensureListening();
  const listener: Listener = { shopId, tripId, onEvent };
  listeners().add(listener);
  return () => listeners().delete(listener);
}

/**
 * Raise "trip X's roll call changed" for every subscriber. Best-effort and
 * fire-and-forget by design (CR-008-style: never let a push failure surface
 * to a caller whose roll-call write already committed) — a publish that
 * never arrives just means subscribers fall back to their own poll.
 */
export function publishManifestEvent(db: AppDb, shopId: string, tripId: string): void {
  void publishManifestEventAsync(db, shopId, tripId).catch(() => undefined);
}

async function publishManifestEventAsync(db: AppDb, shopId: string, tripId: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    dispatch({ shopId, tripId });
    return;
  }
  // A single statement, not a session-scoped command — safe over the pooled
  // (PgBouncer transaction-mode) connection, unlike LISTEN above.
  await db.execute(sql`select pg_notify(${NOTIFY_CHANNEL}, ${JSON.stringify({ shopId, tripId })})`);
}
