import { request } from "@playwright/test";
import { e2eBaseURL, e2eWorkerIndexes } from "./servers";

/**
 * The first request that touches a worker's database pays getDb()'s one-time
 * migrate + seed. Pay it on every worker server here, in parallel, before any
 * test's clock starts, so the first test scheduled onto each server doesn't
 * absorb it. Each per-test reset lives in e2e/fixtures.ts.
 */
export default async function globalSetup() {
  await Promise.all(
    e2eWorkerIndexes.map(async (i) => {
      const context = await request.newContext({ baseURL: e2eBaseURL(i) });
      try {
        await context.post("/api/test/reset", { timeout: 100_000 });
        // Warm the routes every test hits first so the first test's clock
        // doesn't absorb their one-time render cost. Best-effort.
        for (const route of ["/", "/sign-in"]) {
          await context.get(route, { timeout: 100_000 }).catch(() => {});
        }
      } finally {
        await context.dispose();
      }
    }),
  );
}
