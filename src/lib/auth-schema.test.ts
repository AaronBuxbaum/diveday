import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/lib/auth";
import { unseededTestDb } from "@/test/db";

/**
 * better-auth 1.7.3 compares the Drizzle tables it was handed against the
 * models it writes, once, on the first request that reaches it — and refuses
 * to serve that request, and every request after it, while the two disagree
 * (issue #1588). A required column it never writes and a column it writes that
 * does not exist are both fatal, so sign-in stops working the moment either
 * appears. Nothing else notices: the app compiles, every other test passes,
 * and `pnpm dev` starts happily.
 *
 * That is what this file is for. `createAuth` is the real configuration, so a
 * `notNull()` added to `user_accounts` or a column better-auth starts writing
 * after an upgrade fails here rather than in a browser sitting on /sign-in
 * with no error on screen.
 *
 * What it does *not* prove: the check introspects the Drizzle table objects,
 * not the database, so it pins `src/db/schema.ts` against better-auth's models
 * and says nothing about whether the matching migration was generated.
 * The test database is the migrated snapshot (`unseededTestDb`), so a missing
 * migration fails this suite by another route — just not through this assertion.
 */
describe("the better-auth schema contract (in-memory PGlite)", () => {
  it("serves a request instead of refusing on a schema mismatch", async () => {
    // The migrated snapshot, hydrated, not a whole-schema PGlite built inside
    // the test (about 9 s alone, over its limit with three suites at once).
    const db = await unseededTestDb();
    // The no-cookie read below never touches the database, and a PGlite closed
    // before its first query hangs the teardown: one round trip first.
    await db.execute(sql`select 1`);
    const auth = createAuth(db);

    // Any endpoint would do — the check runs ahead of all of them. This one
    // needs no state: no cookie, so the honest answer is a null session, and
    // reaching that answer at all means the schema check passed.
    await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
  });
});
