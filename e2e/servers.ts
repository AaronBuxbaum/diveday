import { cpus } from "node:os";

/**
 * Shared topology for the e2e server fleet, imported by playwright.config.ts,
 * global-setup.ts, and fixtures.ts so the three never drift.
 *
 * Each Playwright worker gets its own precompiled `next start` server on its
 * own port, backed by its own in-memory PGlite database. The servers serve a
 * single read-only production build, so the only per-worker state is that
 * isolated database — which `/api/test/reset` restores before each test. That
 * isolation is what lets the suite run fully parallel.
 */
// Each worker runs BOTH a headless browser AND its own Next server, so every
// worker costs ~2 cores, not one — hence cpus/2 rather than Playwright's usual
// cpus/2-assumes-one-browser-per-worker default (which would double-book here).
// This used to divide by 4 instead: an earlier round found 2 workers on a
// 4-core CI runner (4 heavy processes total) blew assertion timeouts under
// contention and made the parallel run *slower* than serial, so the budget was
// doubled to be safe. That finding predates the CI runners moving from 3-core
// macOS to real 4-core/16GB Linux boxes (20260730-linux-ci-runners.md) and
// wasn't revisited after — a later run on the current hardware put 2 workers
// on 4 cores with no timeouts, confirming the doubled budget was calibrated
// for the weaker runners it no longer runs on
// (20260731-ci-parallelization-resources-build-concurrency.md). Override with
// E2E_WORKERS if a future runner change reintroduces contention.
const envWorkers = Number(process.env.E2E_WORKERS);
const defaultWorkers = Math.max(1, Math.floor(cpus().length / 2));

/** How many parallel worker servers to run (and therefore Playwright workers). */
export const E2E_WORKER_COUNT =
  Number.isFinite(envWorkers) && envWorkers > 0 ? Math.floor(envWorkers) : defaultWorkers;

/** First port; worker i listens on E2E_BASE_PORT + i. */
export const E2E_BASE_PORT = Number(process.env.E2E_BASE_PORT ?? 3100) || 3100;

export function e2ePort(workerIndex: number): number {
  return E2E_BASE_PORT + workerIndex;
}

export function e2eBaseURL(workerIndex: number): string {
  return `http://127.0.0.1:${e2ePort(workerIndex)}`;
}

/**
 * Start one worker's Next server under the repository supervisor. Keeping the
 * command here makes the process-group lifecycle part of the shared topology,
 * rather than an easily missed string in Playwright config.
 */
export function e2eServerCommand(port: number): string {
  return `node scripts/e2e-server.mjs --hostname 127.0.0.1 --port ${port} --keepAliveTimeout 120000`;
}

export const e2eWorkerIndexes: number[] = Array.from({ length: E2E_WORKER_COUNT }, (_, i) => i);

/**
 * Bearer secret the harness must present to every `/api/test/*` route
 * (specialist-optimization-audit-20260731.md §5) — `e2eTestRouteAuthorized`
 * (src/lib/e2e-test-routes.ts) fails closed without it, exactly like
 * `CRON_SECRET` on the reminders cron route, so a misconfigured deployment
 * satisfying only the env-var predicate (DIVEDAY_E2E=1 left set, PGlite
 * fallback) still can't reach these routes. A fixed test-only value, pinned
 * into both the worker servers' env (playwright.config.ts's `serverEnv`) and
 * every outgoing test request (`use.extraHTTPHeaders` + this file's own
 * manual context in global-setup.ts) — not meant to resist anything beyond
 * "this request came from the e2e harness," the same bar `AUTH_SECRET`'s
 * `diveday-e2e-secret` pin sets a few lines up in playwright.config.ts.
 */
export const E2E_TEST_ROUTE_SECRET =
  process.env.DIVEDAY_E2E_SECRET || "diveday-e2e-test-route-secret";

/**
 * Bearer secret the scheduled routes under `/api/cron/*` require. Same shape
 * and same bar as `E2E_TEST_ROUTE_SECRET` above: a fixed, test-only value
 * pinned into the worker servers' env, not meant to resist anything beyond
 * "this request came from the e2e harness".
 *
 * Pinned so a spec can actually *run* a scheduled pass rather than assert
 * around it. The minimum-head-count sweep is the first one that needed it —
 * its whole product claim is that a departure cancels itself at a stated
 * moment, and a test that never fires the sweep is testing the form, not the
 * promise. The routes still fail closed without it, which is the property
 * `minimum-seats.spec.ts` also asserts.
 */
export const E2E_CRON_SECRET = process.env.CRON_SECRET || "diveday-e2e-cron-secret";

/**
 * The instant the whole e2e fleet pretends "now" is. The demo seed is
 * clock-anchored and dozens of surfaces render relative time, so against a live
 * clock every visual baseline diffs on nothing but the passage of
 * time — a departure's rounded slot advances, the Today queue reorders as a
 * trip sails, dates roll at midnight. Freezing a single instant, shared by the
 * server (`DIVEDAY_CLOCK`, read by src/lib/clock.ts) and the browser
 * (the `context` init script in e2e/fixtures.ts), makes those surfaces
 * pixel-identical on every run without masking away the very text a regression
 * would change.
 *
 * A mid-morning weekday in the shop's timezone (America/New_York, so 09:30 EDT)
 * leaves the seeded "sails today" departure comfortably in the future and the
 * board populated — the demo looks like an active dive day, forever.
 *
 * Overridable via DIVEDAY_CLOCK for a one-off run at a different instant (e.g.
 * to reproduce a time-of-day-specific layout), but the committed default is
 * what CI and the reg-suit reference baselines pin to.
 */
export const E2E_FROZEN_CLOCK = process.env.DIVEDAY_CLOCK || "2026-07-21T13:30:00.000Z";

/**
 * The public origin the fleet's servers advertise (`APP_HOST`). `next start`
 * is a production runtime, and `checkPublicHost`
 * (src/lib/notifications/index.ts) refuses a loopback origin there, so a
 * blank or `http://127.0.0.1:…` value leaves `publicAppUrl()` null and pins
 * every origin-dependent surface — the embed snippets, the first-run share
 * URL, canonical/OpenGraph links, and above all pay-at-booking, which the
 * diver-facing promo-code box hangs off — in its "hosting isn't configured"
 * branch.
 *
 * Nothing has to resolve this hostname. The app only ever *prints* it;
 * outbound HTTP is disabled fleet-wide (DIVEDAY_DISABLE_EXTERNAL_HTTP) and
 * Stripe checkout stays `disabledCheckoutProvider` with no STRIPE_SECRET_KEY,
 * so no request is ever made to it. `.example` is reserved (RFC 2606) and can
 * never be registered by anyone.
 *
 * It does not switch payments on by itself either: `payAtBooking` also needs a
 * priced trip and `canAcceptPayments`, and the demo seed provides neither —
 * a test opts in by creating a priced trip and POSTing
 * /api/test/seed-stripe-account.
 *
 * **Must match the `APP_HOST` in package.json's `e2e:build`.** Metadata for
 * prerendered routes (robots.txt, sitemap.xml, the marketing pages' canonical
 * and og:image) is resolved against `metadataBase` at *build* time, so a build
 * that disagrees with the running server emits both origins into the same
 * document. e2e/seo.spec.ts's og:image assertions fail on the duplicate, which
 * is the guard against the two drifting apart.
 */
export const E2E_APP_HOST = process.env.APP_HOST || "https://e2e.diveday.example";
