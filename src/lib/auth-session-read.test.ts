import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import { createAuth, readSessionFrom, sessionCookieWriteDue } from "@/lib/auth";
import { authSecret } from "@/lib/auth-secret";
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
};

async function signedInHarness(): Promise<Harness> {
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
