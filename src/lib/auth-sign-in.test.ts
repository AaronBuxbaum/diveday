import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginTotpEnrollment, enableTotp } from "@/db/account-security";
import type { AppDb } from "@/db/client";
import { DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { accountSessions, userAccounts } from "@/db/schema";
import { totpCode } from "@/lib/totp";
import { seededTestDb } from "@/test/db";

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
const { checkRateLimit } = await import("@/lib/rate-limit");
const { createAuth } = await import("@/lib/auth");

const OWNER = DEV_STAFF_LOGINS.owner;

/**
 * The credentials chokepoint, adversarially: the real better-auth instance
 * over a seeded database, called the way the sign-in actions call it. Every
 * refusal is checked for what it did *not* do as well — no session row — since
 * a refusal that still mints a session is the failure that matters.
 */
async function harness() {
  const db = await seededTestDb();
  vi.mocked(getDb).mockResolvedValue(db);
  const auth = createAuth(db);
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.email, OWNER.email));
  if (!account) throw new Error("seed has no owner account");
  const signIn = (body: { email: string; password: string; totpCode?: string }) =>
    auth.api.signInDiveDayCredentials({ body, headers: new Headers() });
  return { db, account, signIn };
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

    expect(Object.keys(answer.user).sort()).toEqual(["email", "id", "name"]);
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
    async function enrolled() {
      const h = await harness();
      const started = await beginTotpEnrollment(h.db, h.account.id);
      if (!started) throw new Error("enrollment needs a sealing key");
      expect(await enableTotp(h.db, h.account.id, totpCode(started.secret))).toBe(true);
      return { ...h, secret: started.secret };
    }

    it("asks for the code, and refuses a wrong one, opening nothing either time", async () => {
      const { db, account, signIn } = await enrolled();
      const before = await sessionsFor(db, account.id);

      await expect(signIn(OWNER)).rejects.toMatchObject({ message: "two_factor_required" });
      await expect(signIn({ ...OWNER, totpCode: "000000" })).rejects.toMatchObject({
        message: "invalid_two_factor",
      });
      expect(await sessionsFor(db, account.id)).toBe(before);
    });

    it("accepts the current code once, and refuses the same code replayed", async () => {
      const { db, account, signIn, secret } = await enrolled();
      const before = await sessionsFor(db, account.id);
      const code = totpCode(secret);

      await signIn({ ...OWNER, totpCode: code });
      await expect(signIn({ ...OWNER, totpCode: code })).rejects.toMatchObject({
        message: "invalid_two_factor",
      });
      expect(await sessionsFor(db, account.id)).toBe(before + 1);
    });
  });
});
