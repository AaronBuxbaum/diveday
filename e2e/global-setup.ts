import { chromium, request } from "@playwright/test";
import { chromiumLaunchOptions } from "./browser";
import { E2E_TEST_ROUTE_SECRET, e2eBaseURL, e2eWorkerIndexes } from "./servers";

/**
 * Pay the run's one-time costs here, where nothing is on a test's clock.
 *
 * Playwright charges a test's `timeout` for its own fixture setup, and the
 * accounting is not the one you would guess: worker-scoped fixtures are
 * excluded, test-scoped ones are not. So a slow `browser` launch costs the run
 * wall-clock but never fails it, while the very next `newPage()` — test-scoped —
 * is billed to a 15s budget it did not spend.
 *
 * That asymmetry is what "Test timeout of 15000ms exceeded while setting up
 * 'page'" turned out to mean. Two sampled CI shards:
 *
 *   | step                | run A     | run B     | every later test in the job |
 *   | ------------------- | --------- | --------- | --------------------------- |
 *   | Launch browser      | 40,891ms  | 27,670ms  | 150–175ms                   |
 *   | Create page         | 13,821ms  | 12,868ms  | 80–110ms                    |
 *
 * Not contention between shards — each shard is its own runner running a single
 * worker ("Running 34 tests using 1 worker"). It is a cold start: the first
 * launch in a job faults a few hundred MB of browser off a cold page cache,
 * right after the job untarred a ~270 MB browser cache and a build artifact,
 * and the first page creation is still paying for it. Every relaunch in the
 * same job is two orders of magnitude faster.
 *
 * So launch a browser and open a page on it before any test starts. The
 * binary is resident and its first-run work is done by the time a worker
 * launches its own, and the cost lands here, in untimed setup, instead of on
 * whichever test drew the short straw. The other half of the fix is in
 * e2e/browser.ts: run the Chromium the lockfile pins rather than whatever the
 * runner image ships.
 */
async function warmBrowser() {
  const options = chromiumLaunchOptions();
  const startedAt = Date.now();
  const browser = await chromium.launch(options);
  const launchedAt = Date.now();
  try {
    const page = await browser.newPage();
    // A real navigation, so the renderer process, the compositor, and font
    // config are all initialized — not just the browser process. Best-effort:
    // a warm-up that cannot reach the app must not fail the run before the
    // tests have had their say. But it must not be silent either — an
    // unreachable server here is the same fault every test is about to hit,
    // and saying so once up front beats reading it out of 34 timeouts.
    await page.goto(e2eBaseURL(0), { timeout: 30_000 }).catch((error) => {
      console.warn(`e2e: browser warm-up could not reach ${e2eBaseURL(0)} — ${error}`);
    });
    await page.close();
  } finally {
    await browser.close();
  }
  // One line in the job log naming the binary and what its cold start cost.
  // Reading it is how the next person confirms in seconds what took a report
  // artifact to establish here: which browser ran, and whether cold start is
  // still being absorbed up front.
  console.log(
    `e2e: warmed ${options.executablePath ?? "the Chromium pinned by @playwright/test"} — ` +
      `launch ${launchedAt - startedAt}ms, first page + navigation ${Date.now() - launchedAt}ms`,
  );
}

/**
 * The first request that touches a worker's database pays getDb()'s one-time
 * migrate + seed. Pay it on every worker server here, in parallel, before any
 * test's clock starts, so the first test scheduled onto each server doesn't
 * absorb it. Each per-test reset lives in e2e/fixtures.ts.
 */
export default async function globalSetup() {
  await Promise.all([warmServers(), warmBrowser()]);
}

async function warmServers() {
  await Promise.all(
    e2eWorkerIndexes.map(async (i) => {
      const context = await request.newContext({
        baseURL: e2eBaseURL(i),
        // /api/test/reset now requires this bearer token (src/lib/e2e-test-routes.ts);
        // this manual context is built outside Playwright's fixture system, so
        // it doesn't inherit playwright.config.ts's `use.extraHTTPHeaders`.
        extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
      });
      try {
        // This first reset pays the one-time migrate + seed, the heaviest
        // single request in the run; 30s is ample and still fails fast if the
        // server never came up.
        await context.post("/api/test/reset", { timeout: 30_000 });
        // Warm the routes every test hits first so the first test's clock
        // doesn't absorb their one-time render cost. Best-effort.
        for (const route of ["/", "/sign-in", "/shop/blue-mantis/schedule"]) {
          await context.get(route, { timeout: 30_000 }).catch(() => {});
        }
      } finally {
        await context.dispose();
      }
    }),
  );
}
