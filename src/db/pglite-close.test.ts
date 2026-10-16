import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { describe, expect, it } from "vitest";
import { closePglite } from "./close-pglite";

/**
 * A PGlite closed before it has finished opening must still close.
 *
 * That is the ordinary case, not an edge: `seededTestDb()` hands back a client
 * that is still hydrating, and a test that never queries it (it asserts on a
 * validation error, or on a mock) reaches the per-test close while the client
 * is mid-open. `openLocalDb` does the same when a migration throws early.
 * PGlite 0.5.10 made a bare `close()` deadlock there (see `close-pglite.ts`),
 * which CI saw as "Hook timed out in 60000ms" on tests that never touched
 * their database. Every close goes through `closePglite`; this is what it has
 * to pass on every PGlite bump.
 */
describe("closePglite", () => {
  it("closes a client that has not finished opening", async () => {
    const client = new PGlite();
    expect(client.ready).toBe(false);

    await closePglite(client);

    expect(client.closed).toBe(true);
  });

  it("closes a client with the extensions the app loads, mid-open", async () => {
    const client = new PGlite({ extensions: { pg_trgm, btree_gist } });
    expect(client.ready).toBe(false);

    await closePglite(client);

    expect(client.closed).toBe(true);
  });
});
