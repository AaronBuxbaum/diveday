import { test as base, expect } from "@playwright/test";

/**
 * Specs run serially against one shared dev-server/database (see
 * playwright.config.ts), so a mutation in one test (a booking, a cert capture,
 * a cancelled trip) used to leak into the next test's assertions. Reset the
 * demo shop's schedule to its seeded fixture state before every test so each
 * one starts from the same baseline regardless of run order.
 */
export const test = base.extend({});

test.beforeEach(async ({ request }) => {
  await request.post("/api/test/reset");
});

export { expect };
