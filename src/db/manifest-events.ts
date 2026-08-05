import { sql } from "drizzle-orm";
import { Client } from "pg";
import type { AppDb } from "./client";
import { withExplicitSslMode } from "./connection-string";
import { pushManifestChanged } from "./push-subscriptions";

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

/**
 * A real `pg.Client` restricted to the methods this module calls. Narrowed so
 * tests can drive the LISTEN/reconnect/notification-parsing logic below with
 * a fake in-process client instead of a real Postgres connection — the thing
 * ADR 20260726-manifest-push-refresh flags as this module's one coverage gap.
 */
export type NotifyClient = Pick<Client, "connect" | "query" | "end" | "on" | "removeAllListeners">;

/**
 * Exported so tests can supply a fake `createClient` and observe LISTEN
 * issuance, notification dispatch/filtering, and reconnect-with-backoff
 * without a real Postgres server. Production always omits `createClient`
 * (defaults to a real direct-connection `pg.Client`) — see the module
 * docblock above for why it's always the direct, not pooled, connection.
 */
export async function connectAndListen(
  retryDelayMs: number,
  createClient?: () => NotifyClient,
): Promise<void> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!createClient && !connectionString) return;
  const client =
    createClient?.() ??
    new Client({ connectionString: withExplicitSslMode(connectionString as string) });
  let reconnecting = false;
  // Mutable, unlike the `retryDelayMs` parameter: reset to the base delay
  // once this attempt's LISTEN actually succeeds, so a connection that later
  // drops after a long healthy run retries quickly again instead of
  // inheriting whatever backoff this attempt escalated to on the way up.
  let nextDelayMs = retryDelayMs;
  const reconnect = () => {
    if (reconnecting) return;
    reconnecting = true;
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    const delay = nextDelayMs;
    setTimeout(
      () => void connectAndListen(Math.min(delay * 2, RECONNECT_MAX_MS), createClient),
      delay,
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
    nextDelayMs = RECONNECT_BASE_MS;
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
 * Raise "trip X's roll call changed" for every subscriber. The caller awaits
 * this — unlike a bare unawaited promise, which a serverless runtime can
 * freeze mid-flight the instant its response completes (the same lesson
 * src/app/forgot-password/actions.ts already learned once, via `after()`;
 * this call site can't reach for `after()` itself since recordRollCall runs
 * outside a request scope in tests, so awaiting a self-swallowing promise is
 * the version that works in both places). It never throws: a publish failure
 * is caught and swallowed here (CR-008-style) so it never surfaces to a
 * caller whose roll-call write already committed — a publish that never
 * arrives just means subscribers fall back to their own poll.
 */
export async function publishManifestEvent(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) {
      dispatch({ shopId, tripId });
      return;
    }
    // A single statement, not a session-scoped command — safe over the
    // pooled (PgBouncer transaction-mode) connection, unlike LISTEN above.
    await db.execute(
      sql`select pg_notify(${NOTIFY_CHANNEL}, ${JSON.stringify({ shopId, tripId })})`,
    );
  } catch {
    // Best-effort by design — see docblock above.
  }
  // Web Push rides the same seam rather than each of this function's call
  // sites remembering to send one (ADR 20260804-manifest-web-push). It reaches
  // the devices the NOTIFY above cannot: a phone whose page is frozen has no
  // SSE stream to deliver into. Awaited, not fire-and-forget, because a
  // serverless invocation can be frozen the moment its response is returned —
  // an un-awaited push would simply not be sent. It swallows its own failures,
  // and its own coalescing window is what keeps a burst of writes from
  // becoming a burst of notifications.
  await pushManifestChanged(db, shopId, tripId);
}
