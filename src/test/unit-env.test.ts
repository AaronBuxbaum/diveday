import { describe, expect, it } from "vitest";

/**
 * **The unit suite never opens the developer's dev database** (issue #2101).
 *
 * `getDb()` (src/db/client.ts) opens `process.env.PGLITE_DATA_DIR ?? ".pglite"`,
 * and a few tests reach it through a real server action (the find-my-booking
 * tests in src/app/s/[shopSlug]/actions.test.ts). With nothing set, those tests
 * opened `.pglite`: red with "already open by process N" while `pnpm dev` held
 * the directory, and migrating and seeding the developer's own database when it
 * did not. vitest.config.ts's `env` points every worker at a private in-memory
 * database instead; this reads it back from inside a worker, where it lands.
 */
describe("unit test environment", () => {
  it("points getDb() at a private in-memory database, never .pglite", () => {
    expect(process.env.PGLITE_DATA_DIR).toBe("memory");
  });
});
