import { createHash, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accountSessions, people, personRoles, shops, userAccounts } from "@/db/schema";
import { createAuth } from "@/lib/auth";
import { authSecret } from "@/lib/auth-secret";
import { seededTestDb } from "@/test/db";

/**
 * **A session row stores a digest of its token, never the token** (code review
 * 2026-10-11, item 40).
 *
 * The cookie carries the raw token; `account_sessions.token` holds its SHA-256,
 * the way `account_tokens.token_hash` holds a reset link's. A copy of the
 * table, a replica or a support query then hands its reader nothing a browser
 * could present. Runs the real better-auth instance over a seeded database,
 * because the hashing sits between better-auth and its adapter
 * (`withHashedSessionTokens`, src/lib/session-token-hash.ts) and only the real
 * session lifecycle shows every call it has to cover.
 */

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function harness() {
  const db = await seededTestDb();
  const auth = createAuth(db);
  const [account] = await db
    .select({
      id: userAccounts.id,
      personId: people.id,
      name: people.fullName,
      shopId: shops.id,
      shopSlug: shops.slug,
    })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .innerJoin(shops, eq(shops.id, people.shopId))
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(eq(personRoles.role, "owner"))
    .limit(1);
  if (!account) throw new Error("seed has no owner with an account");
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(account.id, false, {
    personId: account.personId,
    shopId: account.shopId,
    shopSlug: account.shopSlug,
    roles: ["owner"],
    name: account.name,
  });
  if (!session) throw new Error("failed to create a session");
  /** better-call's signed cookie for `value`: `<value>.<base64 HMAC-SHA256>`. */
  const cookieFor = (value: string) => {
    const signature = createHmac("sha256", authSecret ?? "")
      .update(value)
      .digest("base64");
    return new Headers({
      cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${value}.${signature}`)}`,
    });
  };
  const storedToken = async () => {
    const [row] = await db
      .select({ token: accountSessions.token })
      .from(accountSessions)
      .where(eq(accountSessions.id, session.id));
    return row?.token;
  };
  return { auth, context, session, cookieFor, storedToken };
}

describe("a session token at rest", () => {
  it("is stored as its SHA-256, while better-auth hands back the raw token", async () => {
    const { session, storedToken } = await harness();

    expect(session.token).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(await storedToken()).toBe(sha256(session.token));
  });

  it("still signs the browser in from the raw token in its cookie", async () => {
    const { auth, session, cookieFor } = await harness();

    const read = await auth.api.getSession({
      headers: cookieFor(session.token),
      query: { disableCookieCache: true },
    });

    expect(read?.session.id).toBe(session.id);
    expect(read?.session.token).toBe(session.token);
  });

  it("signs nobody in from the stored digest, even in a correctly signed cookie", async () => {
    const { auth, cookieFor, storedToken } = await harness();
    const digest = await storedToken();
    if (!digest) throw new Error("session row missing");

    const read = await auth.api.getSession({
      headers: cookieFor(digest),
      query: { disableCookieCache: true },
    });

    expect(read).toBeNull();
  });

  it("finds, slides and revokes the session by its raw token", async () => {
    const { context, session, storedToken } = await harness();

    const found = await context.internalAdapter.findSession(session.token);
    expect(found?.session.id).toBe(session.id);
    expect(found?.session.token).toBe(session.token);

    const later = new Date(session.expiresAt.getTime() + 60_000);
    const updated = await context.internalAdapter.updateSession(session.token, {
      expiresAt: later,
    });
    expect(updated?.token).toBe(session.token);
    expect(await storedToken()).toBe(sha256(session.token));

    await context.internalAdapter.deleteSession(session.token);
    expect(await storedToken()).toBeUndefined();
  });
});
