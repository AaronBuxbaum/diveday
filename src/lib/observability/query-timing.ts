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
 * ## What `ms` is
 *
 * Wall time from the first moment the pass asked for its record (its first
 * statement, or the gate that armed the report, whichever came first) to the
 * moment the response finished. It is *not* time spent inside the database —
 * Drizzle's logger fires before a statement is sent and is never told when it
 * returns, and timing it properly means wrapping the driver in
 * `src/db/client.ts`. Read it next to `queries`: a page whose `ms` moves while
 * its `queries` stays flat is waiting on something other than round trips.
 * `performance.now()` rather than the app clock, because the e2e fleet freezes
 * the clock and a frozen clock times everything at zero.
 *
 * Server-only by construction: `node:async_hooks` does not resolve in a
 * browser bundle, and the one importer is `src/db/client.ts`.
 */
export type QueryStats = {
  /** Statements sent in this scope so far. */
  queries: number;
  /** `performance.now()` when the scope's record was first asked for. */
  startedAt: number;
  /** The route template the report names, once a gate has armed it. */
  route: string | null;
  /** Whether a report has been scheduled for this scope — it is scheduled once. */
  armed: boolean;
};

function freshStats(): QueryStats {
  return { queries: 0, startedAt: performance.now(), route: null, armed: false };
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
        ms: Math.round(performance.now() - stats.startedAt),
      });
    });
  } catch {
    stats.armed = false;
  }
}
