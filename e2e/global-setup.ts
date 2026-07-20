import { request } from "@playwright/test";
import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { e2eBaseURL, e2eWorkerIndexes } from "./servers";

// Public routes whose first render does the heavy lifting (module graph load,
// DB query paths, React tree) that would otherwise land on whichever test hits
// them first. GETting them here warms those paths on every server while the
// clock isn't running.
const WARM_ROUTES = ["/", "/sign-in", `/shop/${DEMO_SHOP_SLUG}/schedule`];

/**
 * The first request that touches a worker's database pays getDb()'s one-time
 * migrate + seed; the first render of each route pays its one-time
 * initialization. Every test's beforeEach also calls /api/test/reset
 * (e2e/fixtures.ts), which reseeds. Pay all of that on every worker server
 * here, in parallel, before any test's clock starts — otherwise the first
 * tests scheduled onto each server absorb it and can exceed their timeout.
 */
export default async function globalSetup() {
  await Promise.all(
    e2eWorkerIndexes.map(async (i) => {
      const context = await request.newContext({ baseURL: e2eBaseURL(i) });
      try {
        await context.post("/api/test/reset", { timeout: 100_000 });
        for (const route of WARM_ROUTES) {
          await context.get(route, { timeout: 100_000 }).catch(() => {});
        }
      } finally {
        await context.dispose();
      }
    }),
  );
}
