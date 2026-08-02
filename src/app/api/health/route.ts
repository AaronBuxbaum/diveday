import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { log } from "@/lib/log";

/**
 * A liveness probe should answer fast or not at all — a slow answer is itself
 * the failure a monitor is looking for. Well under any sane monitor timeout,
 * and far below the daily cron's budget, because nothing here does work.
 */
export const maxDuration = 5;

/**
 * `no-store`, not the `private, no-store` this directory's authenticated routes
 * use: the response is genuinely public, so `private` would be a lie, but no
 * cache anywhere may answer on the deployment's behalf — a cached "ok" from a
 * CDN edge is precisely the reading that makes an outage invisible.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * The external uptime probe. Unauthenticated, and deliberately so: this is the
 * first route in `src/app/api/` that is neither session-gated nor a bearer
 * capability, because a monitor that has to hold a credential is a monitor that
 * goes quiet when the credential rotates — and it would need that credential in
 * exactly the situation where the deployment is broken. Nothing in `src/proxy.ts`
 * covers `/api` (its matcher excludes it), so every route here self-gates; this
 * one's gate is that there is nothing worth gating.
 *
 * What that buys is paid for by disclosing the strict minimum an uptime check
 * can act on:
 *
 *   `status` — `"ok"` when a `select 1` round-trips through the same `getDb()`
 *     every request path uses, so this is liveness of the process *and* its
 *     database, not just "a function booted".
 *   `commit` — the 7-character short SHA of the deployed build, so an operator
 *     can tell "the bad deploy is still live" from "the rollback landed"
 *     without a dashboard. Short, because a monitor only needs to compare it.
 *
 * Withheld on purpose, since each is a free gift to someone mapping the app:
 * the database hostname, connection string, driver or dependency versions, any
 * environment-variable value, the region/instance, row counts, and every byte
 * of shop or diver data. The failure branch is symmetric — it reveals *that*
 * the database check failed, never the driver's error text, which routinely
 * carries hostnames and user names.
 *
 * A failed check answers 503, not 200-with-a-flag: an uptime monitor's default
 * configuration watches the status code, and a probe whose alerting depends on
 * the operator having configured body matching is a probe that will not alert.
 */
export async function GET() {
  // The check must observe *this* request, not a build-time snapshot of it.
  // With `cacheComponents` enabled a GET route handler is prerendered unless it
  // touches runtime data, and a direct Drizzle query is not something Next
  // tracks as uncached data — so without this the "health" of the deployment
  // would be whatever the database said at build time, frozen forever.
  await connection();

  // Vercel sets this on the deployment; anything else (local, a self-hosted
  // runner) simply has no build identity to report.
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7);

  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", commit }, { headers: NO_STORE });
  } catch {
    // Logged, not sent to Sentry: a monitor polls this on a fixed interval, so
    // a database outage would mint one Sentry issue per poll for as long as it
    // lasts. The monitor's own alert is the signal here; the log line is for
    // whoever then goes looking. The error object is deliberately not read —
    // see the disclosure note above.
    log("health.db_unavailable", "error", { commit });
    return Response.json({ status: "error", commit }, { status: 503, headers: NO_STORE });
  }
}
