import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * A PGlite closed before it has finished opening must still close.
 *
 * That is the ordinary case, not an edge: `seededTestDb()` hands back a client
 * that is still hydrating, and a test that never queries it (it asserts on a
 * validation error, or on a mock) reaches the per-test close while the client
 * is mid-open. `openLocalDb` does the same when a migration throws early.
 * PGlite 0.5.10 made `close()` hold the query lock while it waited for the
 * open to finish, and the open's own last step is a query, so the two waited
 * on each other forever: CI saw it as "Hook timed out in 60000ms" on tests
 * that never touched their database. `package.json` pins 0.5.9 for that
 * reason; this is what a later bump has to pass.
 */
describe("PGlite close", () => {
  it("closes a client that has not finished opening", async () => {
    const client = new PGlite();
    expect(client.ready).toBe(false);

    await client.close();

    expect(client.closed).toBe(true);
  });
});
