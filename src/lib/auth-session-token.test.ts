import { createHash, createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { accountSessions, people, personRoles, shops, userAccounts } from "@/db/schema";
import { createAuth, DIGEST_BLIND_SESSION_PATHS } from "@/lib/auth";
import { authSecret } from "@/lib/auth-secret";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

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
  const db = ctx.db;
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
  it("uses the supplied transaction for provider session creation and user lookup", async () => {
    const db = ctx.db;
    const [account] = await db.select().from(userAccounts).limit(1);
    if (!account) throw new Error("seed has no account");
    const [person] = await db.select().from(people).where(eq(people.id, account.personId));
    const [shop] = await db.select().from(shops).where(eq(shops.id, person.shopId));
    let sessionId = "";
    const rollback = new Error("prove provider rollback");

    await expect(
      db.transaction(async (tx) => {
        const provider = createAuth(tx);
        const context = await provider.$context;
        const session = await context.internalAdapter.createSession(account.id, false, {
          personId: person.id,
          shopId: shop.id,
          shopSlug: shop.slug,
          roles: ["owner"],
          name: person.fullName,
        });
        if (!session) throw new Error("provider did not create session");
        sessionId = session.id;
        expect((await context.internalAdapter.findUserById(account.id))?.id).toBe(account.id);
        const [stored] = await tx
          .select()
          .from(accountSessions)
          .where(eq(accountSessions.id, session.id));
        expect(stored.token).toBe(sha256(session.token));
        expect(stored.token).not.toBe(session.token);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    expect(sessionId).not.toBe("");
    expect(
      await db.select().from(accountSessions).where(eq(accountSessions.id, sessionId)),
    ).toEqual([]);
  });

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

/**
 * **better-auth's by-user session APIs are off** (issue #2493). They read
 * sessions back without naming a token, so with digests at rest they would
 * hand out or compare the digest and quietly miss: "sign out other devices"
 * would sign out nothing. DiveDay revokes by session id
 * (`src/db/account-security.ts`). The paths are disabled in the config for
 * the day a route mounts the handler, and no source may call them in-process.
 */
describe("the session APIs that cannot work over digests", () => {
  it("are refused by the handler", async () => {
    const { auth, context, session, cookieFor } = await harness();
    // The control: a path left on answers through the same URL, so a 404
    // below means "disabled", not "the handler never matched the base URL".
    const control = await auth.handler(
      new Request(`${context.baseURL}/get-session`, { headers: cookieFor(session.token) }),
    );
    expect(control.status).toBe(200);
    for (const path of DIGEST_BLIND_SESSION_PATHS) {
      const response = await auth.handler(
        new Request(`${context.baseURL}${path}`, {
          method: path === "/list-sessions" ? "GET" : "POST",
          headers: cookieFor(session.token),
        }),
      );
      expect(response.status, path).toBe(404);
    }
  });

  it("are called from no source file", () => {
    const names = DIGEST_BLIND_SESSION_PATHS.map((path) =>
      path.slice(1).replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase()),
    );
    expect(names).toEqual([
      "listSessions",
      "revokeSession",
      "revokeSessions",
      "revokeOtherSessions",
    ]);
    const pattern = new RegExp(`\\.(${names.join("|")})\\b`);
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(ts|tsx|mjs)$/.test(entry.name) ? [full] : [];
      });
    })(path.join(process.cwd(), "src"));
    const callers = files.filter(
      (file) =>
        !file.endsWith("auth-session-token.test.ts") && pattern.test(readFileSync(file, "utf8")),
    );
    expect(callers).toEqual([]);
  });
});
