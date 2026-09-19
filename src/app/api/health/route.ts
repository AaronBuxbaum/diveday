import { connection } from "next/server";

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
 * **This route does not touch the database, and that is the whole of ADR
 * 20260919-health-check-does-not-wake-the-database.** It used to `select 1`
 * through `getDb()`, which read as strictly better — liveness of the process
 * *and* its database rather than "a function booted". What that missed is the
 * arithmetic on the other side of the wire. A Route 53 health check on a
 * 30-second interval is not one request every thirty seconds: each checker in
 * every AWS region polls on its own schedule, so the endpoint receives one
 * about **every two seconds**, roughly 1.3M a month. Neon's compute scales to
 * zero after **five idle minutes** and is billed for the time it spends awake.
 * A database query every two seconds means it never gets five idle minutes,
 * ever, so the probe alone pinned the compute awake 24/7 and set the whole
 * database bill by the clock rather than by use. No caching or TTL fixes that:
 * any interval short enough to be a useful monitor is far shorter than the
 * idle timeout.
 *
 * What is still proven by a 200 here: DNS resolves to this deployment, TLS
 * terminates, the server booted, a route handler executes, and the build
 * answering is the one named in `commit`. That is exactly the failure the
 * external monitor exists for — the one where nothing inside the deployment is
 * running to report anything, so Sentry, the metric filters and the cron
 * monitors all go quiet together (ADR 20260907-external-uptime-monitor).
 *
 * Database liveness is covered three other ways, none of which polls: `/status`
 * runs the real check in the request that renders it, Sentry reports the first
 * failing user request immediately, and every cron's Sentry monitor is a
 * dead-man's switch that fires within the hour when a pass cannot reach the
 * database. The cost of the split, stated plainly: a database that fails while
 * nothing else is happening is noticed in up to an hour instead of ~4 minutes.
 *
 * What it discloses, and nothing more:
 *
 *   `status` — `"ok"`, always, because a handler that cannot run cannot answer;
 *     a dead deployment produces Vercel's own 5xx or a timeout, which is what
 *     the monitor reads.
 *   `commit` — the 7-character short SHA of the deployed build, so an operator
 *     can tell "the bad deploy is still live" from "the rollback landed"
 *     without a dashboard. Short, because a monitor only needs to compare it.
 *
 * Withheld on purpose, since each is a free gift to someone mapping the app:
 * the database hostname, connection string, driver or dependency versions, any
 * environment-variable value, the region/instance, row counts, and every byte
 * of shop or diver data.
 *
 * **`"status":"ok"` is a contract, not a detail.** The Route 53 health check in
 * §22 of `infra/lib/infra-stack.ts` matches that literal substring in the body
 * as well as the status code, so a 200 carrying somebody else's page — a CDN
 * error shell, a parked domain, a misrouted deployment — reads as down rather
 * than as up. Renaming the field or its value would leave the check green
 * forever against nothing; `observability.test.ts` reads this file and fails
 * when the string is gone.
 */
export async function GET() {
  // The check must observe *this* request, not a build-time snapshot of it.
  // With `cacheComponents` enabled a GET route handler is prerendered unless it
  // touches runtime data, and a probe answered from the build output would
  // report that the deployment was alive at the moment it was compiled — green
  // forever, including while it is down. This is what keeps the route dynamic
  // now that no database read does it incidentally.
  await connection();

  // Vercel sets this on the deployment; anything else (local, a self-hosted
  // runner) simply has no build identity to report.
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 7);

  return Response.json({ status: "ok", commit }, { headers: NO_STORE });
}
