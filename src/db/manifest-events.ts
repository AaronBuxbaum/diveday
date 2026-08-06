import { sql } from "drizzle-orm";
import { Client } from "pg";
import { log } from "@/lib/log";
import type { AppDb } from "./client";
import { withExplicitSslMode } from "./connection-string";
import { pushManifestChanged } from "./push-subscriptions";

export type ManifestEvent = { shopId: string; tripId: string };
type Listener = ManifestEvent & { onEvent: () => void };

const NOTIFY_CHANNEL = "manifest_events";
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30_000;

/**
 * How long the shared LISTEN connection stays open after its last subscriber
 * leaves, before it is closed (ADR 20260806-manifest-listen-connection-ceiling).
 *
 * 20260726-manifest-push-refresh originally decided this connection is "never
 * torn down once opened — an idle direct connection is cheap, and reconnect
 * churn on every subscriber count hitting zero is not worth avoiding it." The
 * first half turned out to be the expensive half: a Neon **direct** (unpooled)
 * connection is the scarcest resource in this design, and an instance that
 * served one manifest stream an hour ago went on holding one while serving
 * nothing but bookings and waivers. The linger is the answer to the second
 * half — the churn that objection is about is a viewer's own reconnect, which
 * happens every ~4 minutes (the route retires its stream at 240s and the
 * client returns ~2s later). Two minutes of idle is ~60× that gap, so a
 * reconnecting viewer never closes anything; only an instance that has
 * genuinely stopped serving manifest streams does.
 */
export const LISTEN_IDLE_CLOSE_MS = 120_000;

/**
 * Ceiling on concurrent subscribers in one warm instance — a safety valve, not
 * a routine bound, and the same shape as `MAX_BUCKETS` in
 * `src/lib/rate-limit.ts`: a documented degrade under a load nobody expects,
 * rather than an unbounded structure nobody is watching.
 *
 * At this feature's stated workload (ADR 20260804-manifest-push-transport: ~3
 * staff devices per shop with the manifest open) 500 is roughly 160 shops'
 * entire manifest fleet landing on one Fluid instance, so it should never fire
 * in normal operation. What it bounds is the case where it *does*: every
 * subscriber costs a held stream, a 25-second heartbeat timer, and a slot in
 * the dispatch loop that every NOTIFY walks, and none of that is free at an
 * unbounded count.
 *
 * Enforced by the route, not here, because refusing is a *response* decision
 * (see `src/app/api/trips/[id]/manifest-events/route.ts`): the caller degrades
 * to the poll fallback it already has. Both statements run synchronously with
 * no await between them, so reading the count and then subscribing cannot
 * interleave with another request.
 */
export const MAX_MANIFEST_SUBSCRIBERS = 500;

/**
 * The shared LISTEN connection's lifecycle, held on `globalThis` alongside the
 * listener set. `generation` is what makes closing safe: a reconnect timer
 * scheduled by a connection that has since been closed belongs to an older
 * generation and must not revive it.
 */
type ListenState = {
  generation: number;
  running: boolean;
  client: NotifyClient | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

// Survive Next.js dev-server HMR the same way src/db/client.ts's db promise
// does: module state resets on reload, globalThis doesn't.
const globalForManifestEvents = globalThis as unknown as {
  divedayManifestListeners?: Set<Listener>;
  divedayManifestListen?: ListenState;
};

function listeners(): Set<Listener> {
  globalForManifestEvents.divedayManifestListeners ??= new Set();
  return globalForManifestEvents.divedayManifestListeners;
}

function listenState(): ListenState {
  globalForManifestEvents.divedayManifestListen ??= {
    generation: 0,
    running: false,
    client: null,
    reconnectTimer: null,
    idleTimer: null,
  };
  return globalForManifestEvents.divedayManifestListen;
}

/**
 * How many SSE viewers this instance is currently fanning out to. Read by the
 * route to enforce {@link MAX_MANIFEST_SUBSCRIBERS}, and the one number an
 * operator can correlate with a direct-connection count (see
 * docs/engineering/realtime-manifest-events-runbook.md).
 */
export function manifestSubscriberCount(): number {
  return listeners().size;
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
 *
 * Opened on the first subscriber and closed {@link LISTEN_IDLE_CLOSE_MS} after
 * the last one leaves, so "one per warm instance" now means one per instance
 * *with a live viewer* rather than one per instance that has ever had one.
 */
function ensureListening(): void {
  const state = listenState();
  if (state.running) return;
  void connectAndListen(RECONNECT_BASE_MS);
}

/**
 * Close the shared connection and abandon any reconnect it had scheduled.
 * Bumping the generation first is what stops an in-flight `connectAndListen`
 * (or a pending reconnect timer from before this call) reviving a connection
 * nobody is listening on.
 */
function stopListening(reason: "idle"): void {
  const state = listenState();
  state.generation += 1;
  state.running = false;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  const client = state.client;
  state.client = null;
  if (client) {
    client.removeAllListeners();
    void Promise.resolve(client.end()).catch(() => undefined);
  }
  log("manifest_events.listen_closed", "info", { reason });
}

function cancelIdleClose(): void {
  const state = listenState();
  if (!state.idleTimer) return;
  clearTimeout(state.idleTimer);
  state.idleTimer = null;
}

/**
 * Arm the idle close when the last subscriber leaves. A no-op in the
 * in-process (PGlite) mode, where nothing was ever dialed.
 */
function scheduleIdleClose(): void {
  const state = listenState();
  if (!state.running || state.idleTimer || listeners().size > 0) return;
  state.idleTimer = setTimeout(() => {
    state.idleTimer = null;
    // Re-checked, not assumed: a subscriber that arrived and left again inside
    // the window cancels and re-arms this, but one that arrived and *stayed*
    // must keep the connection.
    if (listeners().size === 0) stopListening("idle");
  }, LISTEN_IDLE_CLOSE_MS);
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
  const state = listenState();
  // Claimed synchronously, before the first await, so a second caller landing
  // in the same tick sees `running` and does not dial a second connection.
  state.running = true;
  const generation = state.generation;
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
    // Closed while this connection was up (the last viewer left and the idle
    // window elapsed): stay down. Reviving here would re-open a direct
    // connection nobody is listening on, which is the leak this generation
    // counter exists to prevent.
    if (state.generation !== generation) return;
    if (state.client === client) state.client = null;
    const delay = nextDelayMs;
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (state.generation !== generation) return;
      void connectAndListen(Math.min(delay * 2, RECONNECT_MAX_MS), createClient);
    }, delay);
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
    if (state.generation !== generation) {
      // Closed while this was still dialing — end it rather than leave a live
      // direct connection with no owner.
      client.removeAllListeners();
      void Promise.resolve(client.end()).catch(() => undefined);
      return;
    }
    state.client = client;
    nextDelayMs = RECONNECT_BASE_MS;
    // One line per instance that holds a direct connection, which is the only
    // handle an operator has on "how many of Neon's connection slots is this
    // feature using" — there is no other visibility into it from inside the
    // app. See docs/engineering/realtime-manifest-events-runbook.md.
    log("manifest_events.listen_opened", "info", { subscribers: listeners().size });
  } catch (error) {
    // The connection ceiling arrives here: Postgres refuses with SQLSTATE
    // 53300 (too_many_connections) / 53400, and before this line that refusal
    // was completely silent — push simply stopped working on this instance
    // while every surface kept reporting healthy. The SQLSTATE is a code, not
    // a sentence, so it belongs in the log the same way any other domain code
    // does; the message (which can carry connection detail) does not.
    log("manifest_events.listen_connect_failed", "warn", {
      sqlstate: sqlState(error),
      retryInMs: nextDelayMs,
    });
    reconnect();
  }
}

/** A `pg` error's SQLSTATE, when the failure came from Postgres at all. */
function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Subscribe to "trip X's roll call changed." Backed by Postgres LISTEN/NOTIFY
 * when DATABASE_URL is set (production/Neon); falls back to an in-process
 * dispatch with the same filtering semantics otherwise (dev/test on PGlite,
 * which has no cross-process notify to model). Returns an unsubscribe
 * function.
 *
 * The first subscriber opens the shared LISTEN connection and the last one to
 * leave starts the clock on closing it — so a viewer is what holds a Neon
 * direct connection, not merely a warm instance's history of having had one
 * (ADR 20260806-manifest-listen-connection-ceiling). Callers must unsubscribe;
 * the SSE route does so from its abort listener, its `cancel()` hook, and its
 * own stream retirement.
 */
export function subscribeManifestEvents(
  shopId: string,
  tripId: string,
  onEvent: () => void,
): () => void {
  // Before anything else: a subscriber arriving inside the idle window keeps
  // the connection that is already open, rather than being handed one that is
  // about to close underneath it.
  cancelIdleClose();
  if (process.env.DATABASE_URL) ensureListening();
  const listener: Listener = { shopId, tripId, onEvent };
  listeners().add(listener);
  return () => {
    if (!listeners().delete(listener)) return;
    scheduleIdleClose();
  };
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
