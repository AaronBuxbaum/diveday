import { request } from "@playwright/test";

/**
 * The first request that touches the database pays Next's route-compile cost
 * plus getDb()'s one-time migrate+seed — on top of that, every test's
 * beforeEach now calls /api/test/reset (e2e/fixtures.ts), which reseeds
 * again. Left to the first test, that stack blows through its 60s budget.
 * Pay it once here, before any test's clock starts.
 */
export default async function globalSetup() {
  const context = await request.newContext({ baseURL: "http://127.0.0.1:3000" });
  try {
    await context.post("/api/test/reset", { timeout: 100_000 });
  } finally {
    await context.dispose();
  }
}
