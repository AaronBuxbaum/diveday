import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/client";
import { createAuth } from "@/lib/auth";

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
 */
describe("the better-auth schema contract (in-memory PGlite)", () => {
  it("serves a request instead of refusing on a schema mismatch", async () => {
    const auth = createAuth(await createTestDb());

    // Any endpoint would do — the check runs ahead of all of them. This one
    // needs no state: no cookie, so the honest answer is a null session, and
    // reaching that answer at all means the schema check passed.
    await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
  });
});
