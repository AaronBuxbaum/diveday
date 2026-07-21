import path from "node:path";
import { test as base, expect } from "@playwright/test";
import { signInAsOwner } from "./helpers";
import { e2eBaseURL } from "./servers";

/**
 * Each Playwright worker owns a private Next server + in-memory database (see
 * playwright.config.ts). A worker's base URL is derived from its parallel
 * index so its page and request fixtures always talk to that worker's own
 * server — this is what lets the suite run `fullyParallel` without one test's
 * mutation leaking into another's assertions.
 */
export const test = base.extend<object, { workerBaseURL: string; ownerStorageState: string }>({
  // Playwright derives fixture dependencies from the first argument's
  // destructuring pattern, so it must stay an object pattern even though this
  // worker fixture depends on nothing but its worker index.
  workerBaseURL: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires the destructuring pattern.
    async ({}, use, workerInfo) => {
      await use(e2eBaseURL(workerInfo.parallelIndex));
    },
    { scope: "worker" },
  ],

  // Point the built-in page/request fixtures at this worker's own server.
  baseURL: async ({ workerBaseURL }, use) => {
    await use(workerBaseURL);
  },

  // One real UI sign-in per worker; every staff test after that starts from
  // the saved session instead of walking the sign-in form again (which was
  // the single largest cost in the suite — ~27 sign-ins at ~2s each).
  // auth.spec.ts still exercises the live sign-in/sign-out flow.
  ownerStorageState: [
    async ({ workerBaseURL, browser }, use, workerInfo) => {
      const statePath = path.join(
        workerInfo.project.outputDir,
        `.owner-session-${workerInfo.parallelIndex}.json`,
      );
      const context = await browser.newContext({ baseURL: workerBaseURL });
      const page = await context.newPage();
      await signInAsOwner(page);
      await context.storageState({ path: statePath });
      await context.close();
      await use(statePath);
    },
    { scope: "worker" },
  ],
});

/**
 * Start every test in the calling scope (file or describe block) signed in as
 * the seeded owner, via the per-worker saved session. Tests that must begin
 * signed out (public flows, auth itself) simply don't call this.
 */
export function signedInAsOwner() {
  test.use({
    storageState: async ({ ownerStorageState }, use) => {
      await use(ownerStorageState);
    },
  });
}

/**
 * Reset this worker's demo shop to the seeded fixture before every test so each
 * starts from the same baseline regardless of order. It runs against the
 * worker's own database, so parallel resets never interfere.
 */
test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

export { expect };
