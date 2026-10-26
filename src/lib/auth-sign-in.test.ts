import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { beginTotpEnrollment, enableTotp } from "@/db/account-security";
import type { AppDb } from "@/db/client";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import {
  accountSecurity,
  accountSessions,
  accountSignInChallenges,
  userAccounts,
} from "@/db/schema";
import { totpCode } from "@/lib/totp";
import { fileScopedShopContext } from "@/test/db";

const ctx = fileScopedShopContext();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(async () => {}) }));

const { getDb } = await import("@/db/client");
const { checkRateLimit, rateLimitKey } = await import("@/lib/rate-limit");
const { createAuth } = await import("@/lib/auth");

const OWNER = DEV_STAFF_LOGINS.owner;

/**
 * The credentials chokepoint, adversarially: the real better-auth instance
 * over a seeded database, called the way the sign-in actions call it. Every
 * refusal is checked for what it did *not* do as well — no session row — since
 * a refusal that still mints a session is the failure that matters.
 */
async function harness() {
  const db = ctx.db;
  vi.mocked(getDb).mockResolvedValue(db);
  const auth = createAuth(db);
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.email, OWNER.email));
  if (!account) throw new Error("seed has no owner account");
  const signIn = (body: { email: string; password: string; totpCode?: string }) =>
    auth.api.signInDiveDayCredentials({ body, headers: new Headers() });
  return { db, account, signIn, auth };
}

async function sessionsFor(db: AppDb, accountId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(accountSessions)
    .where(eq(accountSessions.userAccountId, accountId));
  return row?.total ?? 0;
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("signing in with DiveDay credentials", () => {
  it("opens one session and answers with three fields, never the stored row", async () => {
    const { db, account, signIn } = await harness();
    const before = await sessionsFor(db, account.id);

    const answer = await signIn(OWNER);

    if (answer.pending) throw new Error("unexpected pending sign-in");
    expect(Object.keys(answer.user).sort()).toEqual(["email", "id", "name"]);
    // The shop the sign-in lands on, named by the server: a staff session's own.
    expect(answer.shopSlug).toBe("blue-mantis");
    expect(JSON.stringify(answer)).not.toMatch(/hashed|password/i);
    expect(await sessionsFor(db, account.id)).toBe(before + 1);
  });

  it("refuses a wrong password and an unknown address with the same answer, and opens nothing", async () => {
    const { db, account, signIn } = await harness();
    const before = await sessionsFor(db, account.id);

    await expect(signIn({ email: OWNER.email, password: "not-it" })).rejects.toMatchObject({
      message: "invalid_credentials",
    });
    await expect(
      signIn({ email: "nobody@demo.invalid", password: OWNER.password }),
    ).rejects.toMatchObject({ message: "invalid_credentials" });
    expect(await sessionsFor(db, account.id)).toBe(before);
  });

  it("refuses a rate-limited attempt before it checks the password", async () => {
    const { db, account, signIn } = await harness();
    const before = await sessionsFor(db, account.id);
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 60_000 });

    await expect(signIn(OWNER)).rejects.toMatchObject({ message: "rate_limited" });
    expect(await sessionsFor(db, account.id)).toBe(before);
  });

  it("refuses a malformed address without reaching the database", async () => {
    const { signIn } = await harness();
    vi.mocked(getDb).mockClear();
    await expect(signIn({ email: "not-an-address", password: "x" })).rejects.toThrow();
    expect(getDb).not.toHaveBeenCalled();
  });

  describe("with a second factor enabled", () => {
    /** Enrolled earlier: the enrolment code's step has passed, so its record is cleared. */
    async function enrolled() {
      const h = await harness();
      const started = await beginTotpEnrollment(h.db, h.account.id);
      if (!started) throw new Error("enrollment needs a sealing key");
      expect(await enableTotp(h.db, h.account.id, totpCode(started.secret))).toBe(true);
      await h.db
        .update(accountSecurity)
        .set({ lastTotpStep: null })
        .where(eq(accountSecurity.userAccountId, h.account.id));
      return { ...h, secret: started.secret };
    }

    async function pending(h: Awaited<ReturnType<typeof enrolled>>) {
      const { headers, response } = await h.auth.api.signInDiveDayCredentials({
        body: OWNER,
        headers: new Headers(),
        returnHeaders: true,
      });
      expect(response).toEqual({ pending: true, user: null, shopSlug: null });
      const raw = headers.get("set-cookie") ?? "";
      const match = raw.match(/((?:__Host-)?diveday\.pending_sign_in)=([A-Za-z0-9_-]{43})/);
      if (!match) throw new Error("pending cookie missing");
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Strict/i);
      expect(raw).toMatch(/Max-Age=300/i);
      expect(raw).not.toMatch(/session_token=[^;\s,]+/);
      return { headers: new Headers({ cookie: `${match[1]}=${match[2]}` }), raw };
    }

    it("returns the pending cookie while creating no authenticated session", async () => {
      const h = await enrolled();
      const before = await sessionsFor(h.db, h.account.id);
      await pending(h);
      expect(await sessionsFor(h.db, h.account.id)).toBe(before);
      expect(await h.db.select().from(accountSignInChallenges)).toHaveLength(1);
    });

    it("uses the hermetic fleet's exact configured loopback transport without trusting Host", async () => {
      vi.stubEnv("DIVEDAY_E2E", "1");
      vi.stubEnv("PORT", "4123");
      onTestFinished(() => {
        vi.unstubAllEnvs();
      });
      const h = await enrolled();
      const accepted = await h.auth.api.signInDiveDayCredentials({
        body: OWNER,
        headers: new Headers({ origin: "http://127.0.0.1:4123", "sec-fetch-site": "same-origin" }),
        returnHeaders: true,
      });
      expect(accepted.response.pending).toBe(true);
      expect(accepted.headers.get("set-cookie")).toMatch(
        /(?:^|, )diveday\.pending_sign_in=[A-Za-z0-9_-]{43}/,
      );
      expect(accepted.headers.get("set-cookie")).not.toContain("__Host-diveday.pending_sign_in");
      await expect(
        h.auth.api.signInDiveDayCredentials({
          body: OWNER,
          headers: new Headers({ origin: "http://127.0.0.1:4124", host: "127.0.0.1:4123" }),
        }),
      ).rejects.toMatchObject({ message: "invalid_origin" });
      await expect(
        h.auth.api.signInDiveDayCredentials({
          body: OWNER,
          headers: new Headers({ origin: "http://127.0.0.1:4123", "sec-fetch-site": "cross-site" }),
        }),
      ).rejects.toMatchObject({ message: "invalid_origin" });
      expect(await sessionsFor(h.db, h.account.id)).toBe(0);
    });

    it("clears account A's browser session and cache without creating or promoting account B's session", async () => {
      const h = await enrolled();
      const previous = await h.auth.api.signInDiveDayCredentials({
        body: DEV_STAFF_LOGINS.captain,
        headers: new Headers(),
        returnHeaders: true,
      });
      if (previous.response.pending) throw new Error("captain unexpectedly pending");
      const cookie = previous.headers
        .getSetCookie()
        .map((line) => line.split(";")[0])
        .filter((pair) => !pair.endsWith("="))
        .join("; ");
      const oldHeaders = new Headers({ cookie });
      expect(
        (await h.auth.api.getSession({ headers: oldHeaders, query: { disableCookieCache: true } }))
          ?.user.id,
      ).toBe(previous.response.user.id);
      const pending = await h.auth.api.signInDiveDayCredentials({
        body: OWNER,
        headers: oldHeaders,
        returnHeaders: true,
      });
      expect(pending.response.pending).toBe(true);
      expect(pending.headers.get("set-cookie")).toMatch(/session_token=;[^,]*Max-Age=0/i);
      expect(pending.headers.get("set-cookie")).toMatch(/session_data=;[^,]*Max-Age=0/i);
      expect(await sessionsFor(h.db, h.account.id)).toBe(0);
      // Clearing the browser is not a claim that A's persisted session was revoked.
      expect(await sessionsFor(h.db, previous.response.user.id)).toBe(1);
      const handle = pending.headers
        .get("set-cookie")
        ?.match(/((?:__Host-)?diveday\.pending_sign_in)=([A-Za-z0-9_-]{43})/);
      if (!handle) throw new Error("pending cookie missing");
      const pendingHeaders = new Headers({ cookie: `${handle[1]}=${handle[2]}` });
      expect(
        await h.auth.api.completeDiveDaySignIn({
          body: { totpCode: "bad-code" },
          headers: pendingHeaders,
        }),
      ).toEqual({ status: "invalid_code" });
      await h.auth.api.cancelDiveDaySignIn({ headers: pendingHeaders });
      expect(await sessionsFor(h.db, h.account.id)).toBe(0);
      expect(await h.auth.api.getSession({ headers: new Headers() })).toBeNull();
    });

    it("refuses the enrollment TOTP, then accepts recovery using only the cookie and code", async () => {
      const h = await enrolled();
      const started = await beginTotpEnrollment(h.db, h.account.id);
      // Enrollment is already enabled; its original step can be marked spent directly.
      expect(started).toBeNull();
      const cookie = await pending(h);
      const before = await sessionsFor(h.db, h.account.id);
      expect(
        await h.auth.api.completeDiveDaySignIn({
          body: { totpCode: "malformed" },
          headers: cookie.headers,
        }),
      ).toEqual({ status: "invalid_code" });
      expect(await sessionsFor(h.db, h.account.id)).toBe(before);
      const { response, headers } = await h.auth.api.completeDiveDaySignIn({
        body: { totpCode: totpCode(h.secret) },
        headers: cookie.headers,
        returnHeaders: true,
      });
      expect(response.status).toBe("signed_in");
      expect(JSON.stringify(response)).not.toMatch(/hashed|password|token/i);
      expect(headers.get("set-cookie")).toContain("session_token");
      expect(headers.get("set-cookie")).toMatch(/pending_sign_in=;[^,]*Max-Age=0/i);
      expect(await sessionsFor(h.db, h.account.id)).toBe(before + 1);
      expect(
        await h.auth.api.completeDiveDaySignIn({
          body: { totpCode: totpCode(h.secret) },
          headers: cookie.headers,
        }),
      ).toEqual({ status: "restart" });
    });

    it("refuses a TOTP that was already consumed by enrollment", async () => {
      const h = await enrolled();
      const code = totpCode(h.secret);
      // enableTotp consumes the same current step again, as the enrollment writer does.
      expect(await enableTotp(h.db, h.account.id, code)).toBe(true);
      const cookie = await pending(h);
      expect(
        await h.auth.api.completeDiveDaySignIn({
          body: { totpCode: code },
          headers: cookie.headers,
        }),
      ).toEqual({ status: "invalid_code" });
      expect(await sessionsFor(h.db, h.account.id)).toBe(0);
    });

    it("Back clears the cookie and invalidates the proof", async () => {
      const h = await enrolled();
      const cookie = await pending(h);
      const cancelled = await h.auth.api.cancelDiveDaySignIn({
        headers: cookie.headers,
        returnHeaders: true,
      });
      expect(cancelled.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
      expect(await h.db.select().from(accountSignInChallenges)).toEqual([]);
      expect(
        await h.auth.api.completeDiveDaySignIn({
          body: { totpCode: totpCode(h.secret) },
          headers: cookie.headers,
        }),
      ).toEqual({ status: "restart" });
    });

    it("charges the IP budget before resolving a missing handle", async () => {
      const h = await enrolled();
      vi.mocked(checkRateLimit).mockClear();
      expect(
        await h.auth.api.completeDiveDaySignIn({
          body: { totpCode: "123456" },
          headers: new Headers(),
        }),
      ).toEqual({ status: "restart" });
      expect(checkRateLimit).toHaveBeenCalledTimes(1);
      expect(vi.mocked(checkRateLimit).mock.calls[0][0]).toBe(
        rateLimitKey("sign-in-ip", "203.0.113.9"),
      );
    });

    it("refuses cross-origin requests at each direct HTTP chokepoint", async () => {
      const h = await enrolled();
      const context = await h.auth.$context;
      for (const [path, body] of [
        ["diveday-credentials", OWNER],
        ["diveday-second-factor", { totpCode: "123456" }],
        ["diveday-cancel", {}],
      ] as const) {
        const response = await h.auth.handler(
          new Request(`${context.baseURL}/sign-in/${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: "https://evil.example" },
            body: JSON.stringify(body),
          }),
        );
        expect(response.status).toBe(403);
      }
      const response = await h.auth.handler(
        new Request(`${context.baseURL}/sign-in/diveday-second-factor`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ totpCode: "123456" }),
        }),
      );
      expect(response.status).toBe(403);
      expect(await sessionsFor(h.db, h.account.id)).toBe(0);
    });
  });
});
