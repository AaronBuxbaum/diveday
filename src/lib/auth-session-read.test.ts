import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { revokeAccountSession, revokeAllAccountSessions } from "@/db/account-security";
import type { AppDb } from "@/db/client";
import { accountSessions, people, personRoles, shops, userAccounts } from "@/db/schema";
import { createAuth, readSessionFrom, sessionCookieWriteDue } from "@/lib/auth";
import { authSecret } from "@/lib/auth-secret";
import * as clock from "@/lib/clock";
import { DAY_MS } from "@/lib/clock";
import { seededTestDb } from "@/test/db";

/**
 * Issue #2263: every staff server action used to re-set the session cookie
 * cache, because the session read asked better-auth for the live row and
 * better-auth then always wrote `session_data`. Next takes a cookie written in
 * an action for a mutation, so a read-only action refreshed the whole route
 * and re-prefetched every link on the page.
 *
 * These run the real better-auth instance (`createAuth`) over a seeded
 * database with a real session row, so what they prove is better-auth's own
 * behaviour under the queries `readSessionFrom` sends, not a stub's.
 */

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;
const ONE_DAY_S = 24 * 60 * 60;

type Harness = {
  auth: ReturnType<typeof createAuth>;
  db: AppDb;
  token: string;
  sessionId: string;
  expiresAt: Date;
  sessionCookie: string;
  accountId: string;
};

/**
 * A signed-in session for the seed's first account holding `role`. Pass an
 * earlier harness's `db` and `auth` to mint a second session in the same
 * database: another device, or another account.
 */
async function signedInHarness(
  on?: { db: AppDb; auth: ReturnType<typeof createAuth> },
  role: "owner" | "captain" = "owner",
  initializeTestClock = true,
): Promise<Harness> {
  const db = on?.db ?? (await seededTestDb());
  const auth = on?.auth ?? createAuth(db);
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
    .where(eq(personRoles.role, role))
    .limit(1);
  if (!account) throw new Error(`seed has no ${role} with an account`);
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(account.id, false, {
    personId: account.personId,
    shopId: account.shopId,
    shopSlug: account.shopSlug,
    roles: [role],
    name: account.name,
  });
  if (!session) throw new Error("failed to create a session");
  if (initializeTestClock) {
    await db
      .update(accountSessions)
      .set({ lastHumanActivityAt: new Date(session.expiresAt.getTime() - SEVEN_DAYS_S * 1000) })
      .where(eq(accountSessions.id, session.id));
  }
  // better-call's signed cookie: `<value>.<base64 HMAC-SHA256>`, URI-encoded.
  const signature = createHmac("sha256", authSecret ?? "")
    .update(session.token)
    .digest("base64");
  const sessionCookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(
    `${session.token}.${signature}`,
  )}`;
  return {
    auth,
    db,
    token: session.token,
    sessionId: session.id,
    expiresAt: session.expiresAt,
    sessionCookie,
    accountId: account.id,
  };
}

/** The instant the session was minted: the one `now` at which nothing is due. */
function mintedAt(harness: Harness): number {
  return harness.expiresAt.getTime() - SEVEN_DAYS_S * 1000;
}

/** A warm `session_data` cookie, written the way better-auth writes it. */
async function warmCacheCookie(harness: Harness): Promise<string> {
  const { headers } = await harness.auth.api.getSession({
    headers: new Headers({ cookie: harness.sessionCookie }),
    query: { disableCookieCache: true },
    returnHeaders: true,
  });
  const dataCookie = headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .find((pair) => pair.includes("session_data="));
  if (!dataCookie) throw new Error("better-auth wrote no session_data cookie");
  return dataCookie;
}

function cookiesOf(...pairs: string[]): Headers {
  return new Headers({ cookie: pairs.join("; ") });
}

describe("the session read writes no cookie it does not owe (issue #2263)", () => {
  it("checks the clock after the session read, not before a delayed database response", async () => {
    const harness = await signedInHarness();
    const cookie = cookiesOf(harness.sessionCookie);
    const quiet = await harness.auth.api.getSession({
      headers: cookie,
      query: { disableCookieCache: true, disableRefresh: true },
    });
    const boundary = mintedAt(harness) + 12 * 60 * 60 * 1000;
    let current = boundary - 1;
    const clockSpy = vi.spyOn(clock, "nowMs").mockImplementation(() => current);
    try {
      const api = new Proxy(harness.auth.api, {
        get(target, property, receiver) {
          if (property === "getSession")
            return async () => {
              current = boundary;
              return quiet;
            };
          return Reflect.get(target, property, receiver);
        },
      });
      const delayed = new Proxy(harness.auth, {
        get(target, property, receiver) {
          return property === "api" ? api : Reflect.get(target, property, receiver);
        },
      });
      expect(await readSessionFrom(delayed, cookie)).toBeNull();
    } finally {
      clockSpy.mockRestore();
    }
  });
  it("reads a newly minted Better Auth session without manually repairing its activity field", async () => {
    const harness = await signedInHarness(undefined, "owner", false);
    const [row] = await harness.db
      .select()
      .from(accountSessions)
      .where(eq(accountSessions.id, harness.sessionId));
    expect(row?.lastHumanActivityAt).toBeInstanceOf(Date);
    expect(
      await readSessionFrom(
        harness.auth,
        cookiesOf(harness.sessionCookie),
        row?.lastHumanActivityAt.getTime(),
      ),
    ).not.toBeNull();
  });
  it("refuses a session at twelve hours of inactivity even with a warm cookie", async () => {
    const harness = await signedInHarness();
    const warm = await warmCacheCookie(harness);
    const issued = mintedAt(harness);
    expect(
      await readSessionFrom(
        harness.auth,
        cookiesOf(harness.sessionCookie, warm),
        issued + 12 * 60 * 60 * 1000,
      ),
    ).toBeNull();
  });

  it("asks better-auth for a read that sets nothing, where the old read set the cache", async () => {
    const harness = await signedInHarness();
    const headers = cookiesOf(harness.sessionCookie);

    const quiet = await harness.auth.api.getSession({
      headers,
      query: { disableCookieCache: true, disableRefresh: true },
      returnHeaders: true,
    });
    expect(quiet.response?.session.id).toBe(harness.sessionId);
    expect(quiet.headers.getSetCookie()).toEqual([]);

    // The read every action used to make: it re-sets the cache every time.
    const old = await harness.auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
      returnHeaders: true,
    });
    expect(old.headers.getSetCookie().join("\n")).toContain("session_data=");
  });

  it("reads once, quietly, when the cache is warm and the refresh is not due", async () => {
    const harness = await signedInHarness();
    const headers = cookiesOf(harness.sessionCookie, await warmCacheCookie(harness));
    const getSession = vi.spyOn(harness.auth.api, "getSession");

    const session = await readSessionFrom(harness.auth, headers, mintedAt(harness));

    expect(session?.user.sessionId).toBe(harness.sessionId);
    expect(session?.user.roles).toEqual(["owner"]);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSession.mock.calls[0]?.[0]?.query).toEqual({
      disableCookieCache: true,
      disableRefresh: true,
    });
  });

  it("warms a cold cache, so the proxy's redirects keep reading it", async () => {
    const harness = await signedInHarness();
    const getSession = vi.spyOn(harness.auth.api, "getSession");

    const session = await readSessionFrom(
      harness.auth,
      cookiesOf(harness.sessionCookie),
      mintedAt(harness),
    );

    expect(session?.user.sessionId).toBe(harness.sessionId);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(getSession.mock.calls[1]?.[0]?.query).toEqual({ disableCookieCache: true });
  });

  it("rewrites a cache left by another session", async () => {
    const other = await signedInHarness();
    const harness = await signedInHarness();
    // A cache sealed for a different session row, under the same secret.
    const foreign = await warmCacheCookie(other);
    const getSession = vi.spyOn(harness.auth.api, "getSession");

    await readSessionFrom(
      harness.auth,
      cookiesOf(harness.sessionCookie, foreign),
      mintedAt(harness),
    );

    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("still slides the session forward when the refresh is due", async () => {
    const harness = await signedInHarness();
    const warm = await warmCacheCookie(harness);
    // Two days into a seven-day session, past the one-day `updateAge`.
    const context = await harness.auth.$context;
    const aged = new Date(harness.expiresAt.getTime() - 2 * DAY_MS);
    await context.internalAdapter.updateSession(harness.token, { expiresAt: aged });
    const getSession = vi.spyOn(harness.auth.api, "getSession");

    const session = await readSessionFrom(
      harness.auth,
      cookiesOf(harness.sessionCookie, warm),
      mintedAt(harness),
    );

    expect(session?.user.sessionId).toBe(harness.sessionId);
    expect(getSession).toHaveBeenCalledTimes(2);
    const row = await context.internalAdapter.findSession(harness.token);
    expect(row?.session.expiresAt.getTime()).toBeGreaterThan(aged.getTime());
  });

  it("refuses a revoked session even with a warm cache in hand", async () => {
    const harness = await signedInHarness();
    const warm = await warmCacheCookie(harness);
    const context = await harness.auth.$context;
    await context.internalAdapter.deleteSession(harness.token);

    const session = await readSessionFrom(
      harness.auth,
      cookiesOf(harness.sessionCookie, warm),
      mintedAt(harness),
    );

    expect(session).toBeNull();
  });
});

/**
 * The two revokes on Settings > Security, through the functions the actions
 * call (`src/db/account-security.ts`), against the read every staff request
 * makes. A warm `session_data` cache is in hand each time, because that cookie
 * is what a stolen browser still holds.
 */
describe("revoking sessions from Settings > Security", () => {
  it("ends the revoked device's next read, and leaves the account's other device signed in", async () => {
    const laptop = await signedInHarness();
    const phone = await signedInHarness(laptop);
    const warm = await warmCacheCookie(phone);

    expect(await revokeAccountSession(laptop.db, laptop.accountId, phone.sessionId)).toBe(true);

    expect(
      await readSessionFrom(phone.auth, cookiesOf(phone.sessionCookie, warm), mintedAt(phone)),
    ).toBeNull();
    const still = await readSessionFrom(
      laptop.auth,
      cookiesOf(laptop.sessionCookie),
      mintedAt(laptop),
    );
    expect(still?.user.sessionId).toBe(laptop.sessionId);
  });

  it("will not revoke another account's session by id", async () => {
    const owner = await signedInHarness();
    const captain = await signedInHarness(owner, "captain");
    expect(owner.accountId).not.toBe(captain.accountId);

    expect(await revokeAccountSession(owner.db, owner.accountId, captain.sessionId)).toBe(false);

    const read = await readSessionFrom(
      captain.auth,
      cookiesOf(captain.sessionCookie),
      mintedAt(captain),
    );
    expect(read?.user.sessionId).toBe(captain.sessionId);
  });

  /**
   * "Sign out everywhere" ends *every* session of the account, the one that
   * pressed it included: the action then sends that browser to sign-in
   * (`revokeAllSessionsAction`). Another account's sessions are untouched.
   */
  it("revoke-all ends every session of the account, this one included, and no one else's", async () => {
    const laptop = await signedInHarness();
    const phone = await signedInHarness(laptop);
    const captain = await signedInHarness(laptop, "captain");
    const warmPhone = await warmCacheCookie(phone);

    await revokeAllAccountSessions(laptop.db, laptop.accountId);

    expect(
      await readSessionFrom(phone.auth, cookiesOf(phone.sessionCookie, warmPhone), mintedAt(phone)),
    ).toBeNull();
    expect(
      await readSessionFrom(laptop.auth, cookiesOf(laptop.sessionCookie), mintedAt(laptop)),
    ).toBeNull();
    const other = await readSessionFrom(
      captain.auth,
      cookiesOf(captain.sessionCookie),
      mintedAt(captain),
    );
    expect(other?.user.sessionId).toBe(captain.sessionId);
  });
});

describe("sessionCookieWriteDue", () => {
  const live = { id: "s1", shopId: "shop", shopSlug: "blue-mantis", roles: ["owner"] };
  const expiresAt = new Date("2026-07-28T00:00:00.000Z");
  const minted = expiresAt.getTime() - SEVEN_DAYS_S * 1000;
  const base = {
    expiresAt,
    expiresInSec: SEVEN_DAYS_S,
    updateAgeSec: ONE_DAY_S,
    live,
    cached: live,
  };

  it("owes nothing to a fresh session whose cache agrees", () => {
    expect(sessionCookieWriteDue({ ...base, now: minted })).toBe(false);
    expect(sessionCookieWriteDue({ ...base, now: minted + ONE_DAY_S * 1000 - 1 })).toBe(false);
  });

  it("owes the sliding refresh from the instant it is due, as better-auth counts it", () => {
    expect(sessionCookieWriteDue({ ...base, now: minted + ONE_DAY_S * 1000 })).toBe(true);
  });

  it("owes a write to a cold cache, or one that disagrees with the live row", () => {
    expect(sessionCookieWriteDue({ ...base, now: minted, cached: null })).toBe(true);
    for (const cached of [
      { ...live, id: "s2" },
      { ...live, shopId: "other" },
      { ...live, shopSlug: "other" },
      { ...live, roles: ["manager"] },
      { ...live, roles: ["owner", "manager"] },
      { ...live, roles: [] },
    ]) {
      expect(sessionCookieWriteDue({ ...base, now: minted, cached })).toBe(true);
    }
  });
});
