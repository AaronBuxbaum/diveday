import type { PGlite } from "@electric-sql/pglite";

/**
 * Close a PGlite, waiting first for it to finish opening.
 *
 * Every PGlite close in this repo goes through here. Since 0.5.10, `close()`
 * takes the query lock and only then waits for the open to finish, while the
 * open's last steps (array types, extension init) are queries that need that
 * same lock. A client closed mid-open therefore waits on itself forever. That
 * is the ordinary case, not an edge: `seededTestDb()` hands back a client that
 * is still hydrating, and a test that never queries it reaches its per-test
 * close mid-open. Waiting for `waitReady` outside the lock lets the open finish
 * first. A failed open rejects here instead of hanging.
 */
export async function closePglite(client: PGlite): Promise<void> {
  await client.waitReady;
  await client.close();
}
