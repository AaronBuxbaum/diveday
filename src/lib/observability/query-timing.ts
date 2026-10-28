import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { log } from "@/lib/log";

/**
 * **How many statements a server render sent, and how long it took** (app audit
 * 2026-10-07, item 4).
 *
 * Before this, every performance number about a staff page was inferred from
 * reading the code: nothing on the server counted a query or timed a render.
 * `src/test/query-count.ts` counts statements in a test; this counts them in
 * the running app, through the same hook — Drizzle's `logger`, which the
 * driver calls once per statement it sends, `BEGIN`/`COMMIT` included.
 *
 * ## The scope a count belongs to
 *
 * Two, and the first one found wins:
 *
 * 1. **An explicit scope**, {@link withQueryStats}: an `AsyncLocalStorage`
 *    store, for a test or a script that wants the cost of one call path.
 * 2. **The render pass**: a React `cache()`d record, one per React request
 *    scope, which is not always one per HTTP request: issue #1121 measured
 *    the staff shell and the page beside it rendering in separate passes, and
 *    on 2026-10-07 (Next 16.4) they shared one (`src/db/blockers.ts`). Either
 *    way each pass reports its own line, so a navigation that logs two lines
 *    rendered in two passes - which is itself worth knowing.
 *
 * Outside both — a cron, a route handler, a server action, a test that did not
 * ask — React's `cache()` calls straight through, so the count lands on a
 * fresh record nobody holds and is dropped. That is the whole "off" path: one
 * store lookup and one integer increment per statement, and nothing written.
 *
 * ## What `ms` and `db_ms` are
 *
 * `ms` is wall time from the first moment the pass asked for its record (its
 * first statement, or the gate that armed the report, whichever came first) to
 * the moment the response finished.
 *
 * `db_ms` is time spent waiting on the database: each statement timed from the
 * moment it is handed to the driver to the moment its answer comes back, and
 * summed (issue #2352). Drizzle's logger fires before a statement is sent and
 * is never told when it returns, so the timing is a wrapper around the
 * driver's own `query()` ({@link withStatementTiming}, installed in
 * `src/db/client.ts`). Statements sent together each count in full, so
 * `db_ms` can exceed `ms` on a page that fans out. Read the two side by side:
 * a page whose `ms` moves while its `db_ms` stays flat is waiting on
 * something other than the database, and one whose `db_ms` moves while its
 * `queries` stays flat has a slow statement.
 *
 * `performance.now()` rather than the app clock, because the e2e fleet freezes
 * the clock and a frozen clock times everything at zero.
 *
 * Server-only by construction: `node:async_hooks` does not resolve in a
 * browser bundle, and the one importer is `src/db/client.ts`.
 */
export type QueryStats = {
  /** Statements sent in this scope so far. */
  queries: number;
  /** Milliseconds those statements took, each timed at the driver and summed. */
  dbMs: number;
  /** `performance.now()` when the scope's record was first asked for. */
  startedAt: number;
  /** The route template the report names, once a gate has armed it. */
  route: string | null;
  /** Whether a report has been scheduled for this scope — it is scheduled once. */
  armed: boolean;
  /** Present only for test-only request diagnostics. */
  inFlightStatements?: Map<number, number>;
  /** Present only for test-only request diagnostics. */
  statementSequence?: number;
};

function freshStats(): QueryStats {
  return {
    queries: 0,
    dbMs: 0,
    startedAt: performance.now(),
    route: null,
    armed: false,
  };
}

const explicitScope = new AsyncLocalStorage<QueryStats>();

/** One record per React render pass; a passthrough everywhere else (see above). */
const renderPassStats = cache(freshStats);

/** The record the statement being sent right now belongs to. */
export function currentQueryStats(): QueryStats {
  return explicitScope.getStore() ?? renderPassStats();
}

/**
 * The Drizzle `logger` that does the counting. Handed to the driver once, in
 * `src/db/client.ts`; it never sees parameters, and it keeps none of the SQL.
 */
export const queryTimingLogger = {
  logQuery(): void {
    currentQueryStats().queries += 1;
  },
};

/**
 * Time one statement into the scope that sent it. The scope is read when the
 * statement is handed over, in the caller's own async context, never when the
 * driver answers, so a pooled connection's callbacks cannot move the time to
 * another request.
 */
export function timeStatement<T>(send: () => Promise<T>): Promise<T> {
  const stats = currentQueryStats();
  const sentAt = performance.now();
  const inFlightStatements = stats.inFlightStatements;
  let statementId: number | null = null;
  if (inFlightStatements) {
    stats.statementSequence = (stats.statementSequence ?? 0) + 1;
    statementId = stats.statementSequence;
    inFlightStatements.set(statementId, sentAt);
  }
  const finish = () => {
    if (statementId !== null) inFlightStatements?.delete(statementId);
    stats.dbMs += performance.now() - sentAt;
  };
  try {
    return send().finally(finish);
  } catch (error) {
    finish();
    throw error;
  }
}

/**
 * **The driver, with every statement timed** — a proxy over a PGlite client
 * or a `pg` pool that times `query()`, and hands back a timed client from the
 * two doors a transaction goes through: PGlite's `transaction(callback)` and
 * the pool's `connect()`. Everything else passes through to the driver itself.
 * The proxy keeps the driver's prototype, so Drizzle's own "is this a pool?"
 * check still answers the same.
 */
export function withStatementTiming<Client extends object>(client: Client): Client {
  return new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property === "query") {
        return (...args: unknown[]) =>
          timeStatement(() => Reflect.apply(value, target, args) as Promise<unknown>);
      }
      if (property === "transaction") {
        return (callback: (tx: object) => unknown, ...rest: unknown[]) =>
          Reflect.apply(value, target, [
            (tx: object) => callback(withStatementTiming(tx)),
            ...rest,
          ]);
      }
      if (property === "connect") {
        return (...args: unknown[]) => {
          const connected = Reflect.apply(value, target, args);
          // The callback form (no promise) is never used by Drizzle; pass it through.
          return connected instanceof Promise
            ? connected.then((connection: object) => withStatementTiming(connection))
            : connected;
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * Run `work` in a scope of its own and hand back what it cost alongside its
 * result. For tests and the measurement harness; a render never needs it.
 */
export async function withQueryStats<T>(
  work: () => Promise<T>,
): Promise<{ result: T; stats: QueryStats }> {
  const stats = freshStats();
  const result = await explicitScope.run(stats, work);
  return { result, stats };
}

/**
 * Add bounded server-side timing evidence to an API handler in E2E only.
 * The event-loop probe and query scope do not observe request data; the log
 * contains only a fixed route label and numeric timings/counts.
 */
export async function withE2EApiTiming<T>(route: string, work: () => Promise<T>): Promise<T> {
  if (process.env.DIVEDAY_E2E !== "1") return work();

  const stats = freshStats();
  stats.inFlightStatements = new Map();
  stats.statementSequence = 0;
  let previousTick = performance.now();
  let maxEventLoopLagMs = 0;
  const probe = setInterval(() => {
    const now = performance.now();
    maxEventLoopLagMs = Math.max(maxEventLoopLagMs, now - previousTick - 20);
    previousTick = now;
  }, 20);
  probe.unref?.();
  const startedAt = performance.now();
  let snapshots = 0;
  const report = () => {
    let oldestStartedAt = Number.POSITIVE_INFINITY;
    const inFlightStatements = stats.inFlightStatements;
    for (const sentAt of inFlightStatements?.values() ?? []) {
      oldestStartedAt = Math.min(oldestStartedAt, sentAt);
    }
    try {
      log("test.api_request_timing", "info", {
        route,
        ms: Math.round(performance.now() - startedAt),
        db_ms: Math.round(stats.dbMs),
        queries: stats.queries,
        in_flight_statements: inFlightStatements?.size ?? 0,
        oldest_statement_age_ms: inFlightStatements?.size
          ? Math.round(performance.now() - oldestStartedAt)
          : 0,
        event_loop_lag_ms: Math.max(0, Math.round(maxEventLoopLagMs)),
        snapshot: snapshots,
      });
    } catch {
      // Test diagnostics must never alter a route's response or rejection.
    }
  };
  const watchdog = setInterval(() => {
    snapshots += 1;
    if (snapshots >= 5) clearInterval(probe);
    report();
    if (snapshots >= 5) clearInterval(watchdog);
  }, 5_000);
  watchdog.unref?.();

  try {
    return await explicitScope.run(stats, work);
  } finally {
    clearInterval(probe);
    clearInterval(watchdog);
    if (performance.now() - startedAt >= 500) {
      snapshots += 1;
      report();
    }
  }
}

/** What a render reports, once its response has gone. */
export const QUERY_TIMING_EVENT = "render.db_queries";

/** Schedules a task for after the response — `after` from `next/server`, injected. */
export type AfterResponse = (task: () => void) => void;

/**
 * Name the render pass's route and, the first time this is called in the
 * pass, schedule one {@link QUERY_TIMING_EVENT} line for after the response.
 *
 * A later call only renames the route, so a page can sharpen the label a
 * broad gate armed. A `fallback` label names the pass only when nothing else
 * has: the staff gate and the shell both pass one, so whichever of them runs
 * first can never overwrite the page's own name if they share its pass.
 *
 * Outside a render pass or an explicit scope it does nothing at all.
 *
 * `schedule` throwing — `after` outside any request scope, which is every
 * unit test that calls a gate — is not an error worth surfacing: there is no
 * response to wait for, so there is nothing to report.
 */
export function reportRenderQueries(
  route: string,
  schedule: AfterResponse,
  { fallback = false }: { fallback?: boolean } = {},
): void {
  const stats = currentQueryStats();
  // Outside every scope each ask is a fresh record (a server action, a route
  // handler): the statements this call would report land somewhere else, so
  // a line from here would always say zero. Say nothing instead.
  if (stats !== currentQueryStats()) return;
  if (!fallback || stats.route === null) stats.route = route;
  if (stats.armed) return;
  stats.armed = true;
  try {
    schedule(() => {
      log(QUERY_TIMING_EVENT, "info", {
        route: stats.route,
        queries: stats.queries,
        db_ms: Math.round(stats.dbMs),
        ms: Math.round(performance.now() - stats.startedAt),
      });
    });
  } catch {
    stats.armed = false;
  }
}
