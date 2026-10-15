import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  beginTotpEnrollment,
  enableTotp,
  getAccountSecurity,
  verifyAccountSecondFactor,
} from "@/db/account-security";
import type { AppDb } from "@/db/client";
import { accountSessions, accountStepUps, people, personRoles, userAccounts } from "@/db/schema";
import { nowDate, nowMs } from "@/lib/clock";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { TOTP_STEP_SECONDS, totpCode } from "@/lib/totp";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { redirectedTo, staffSession } from "@/test/staff-session";

/**
 * The second-factor doors on Settings > Security, run against a real database
 * and the real in-memory rate limiter, with only the session and Next's
 * request primitives faked.
 *
 * Every test mints its own account: the limiter buckets by account id and
 * the frozen clock never refills a bucket, so a shared account would carry one
 * test's spent attempts into the next.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => nextHeadersStub());
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));

const { requireShopSurface } = await import("@/lib/session");
const { disableTotpAction, verifyStepUpAction } = await import("./actions");

const ctx = fileScopedShopContext();

let seq = 0;

/** A live owner with an account, a session row, and TOTP switched on. */
async function enrolledOwner(db: AppDb, shop: { id: string; slug: string }) {
  seq += 1;
  const email = `security.${seq}@demo.invalid`;
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: `Security ${seq}`, email })
    .returning();
  if (!person) throw new Error("person insert failed");
  await db.insert(personRoles).values({ personId: person.id, role: "owner" });
  const [account] = await db
    .insert(userAccounts)
    .values({ personId: person.id, email, hashedPassword: "x", status: "active" })
    .returning();
  if (!account) throw new Error("account insert failed");
  const sessionId = await sessionRow(db, shop, person.id, account.id);
  const started = await beginTotpEnrollment(db, account.id);
  if (!started) throw new Error("the unit suite configures a sealing key");
  expect(await enableTotp(db, account.id, totpCode(started.secret))).toBe(true);
  return { personId: person.id, accountId: account.id, sessionId, secret: started.secret };
}

async function sessionRow(
  db: AppDb,
  shop: { id: string; slug: string },
  personId: string,
  accountId: string,
) {
  seq += 1;
  const [row] = await db
    .insert(accountSessions)
    .values({
      userAccountId: accountId,
      token: `token-${seq}`,
      expiresAt: new Date(nowDate().getTime() + 86_400_000),
      personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      roles: ["owner"],
      name: "Security",
    })
    .returning();
  if (!row) throw new Error("session insert failed");
  return row.id;
}

function signIn(personId: string, sessionId: string) {
  const { db, shop } = ctx;
  const session = staffSession({ shopId: shop.id, shopSlug: shop.slug, personId });
  session.user.sessionId = sessionId;
  vi.mocked(requireShopSurface).mockResolvedValue({
    session,
    db,
    shop,
  } as unknown as Awaited<ReturnType<typeof requireShopSurface>>);
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

const securityPage = (slug: string) => shopPath(slug, "settings", "security");

describe("disableTotpAction", () => {
  it("refuses with no code or a wrong one, and two-factor stays on", async () => {
    const { db, shop } = ctx;
    const owner = await enrolledOwner(db, shop);
    signIn(owner.personId, owner.sessionId);

    for (const entries of [{}, { code: "000000" }] as Record<string, string>[]) {
      const to = await redirectedTo(() => disableTotpAction(shop.slug, form(entries)));
      expect(to).toBe(noticeUrl(securityPage(shop.slug), "code-invalid"));
    }
    const security = await getAccountSecurity(db, owner.accountId);
    expect(security?.totpEnabledAt).not.toBeNull();
    expect(security?.totpSecretSealed).not.toBeNull();
  });

  it("stops listening after five wrong codes, even to the right one", async () => {
    const { db, shop } = ctx;
    const owner = await enrolledOwner(db, shop);
    signIn(owner.personId, owner.sessionId);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const to = await redirectedTo(() => disableTotpAction(shop.slug, form({ code: "000000" })));
      expect(to).toBe(noticeUrl(securityPage(shop.slug), "code-invalid"));
    }
    const to = await redirectedTo(() =>
      disableTotpAction(shop.slug, form({ code: totpCode(owner.secret) })),
    );

    expect(to).toBe(noticeUrl(securityPage(shop.slug), "too-many-attempts"));
    expect((await getAccountSecurity(db, owner.accountId))?.totpEnabledAt).not.toBeNull();
  });

  it("turns two-factor off on the current code", async () => {
    const { db, shop } = ctx;
    const owner = await enrolledOwner(db, shop);
    signIn(owner.personId, owner.sessionId);

    const to = await redirectedTo(() =>
      disableTotpAction(shop.slug, form({ code: totpCode(owner.secret) })),
    );

    expect(to).toBe(noticeUrl(securityPage(shop.slug), "two-factor-disabled"));
    const security = await getAccountSecurity(db, owner.accountId);
    expect(security?.totpEnabledAt).toBeNull();
    expect(security?.totpSecretSealed).toBeNull();
  });
});

describe("verifyStepUpAction", () => {
  const returnTo = (slug: string) => shopPath(slug, "orders");

  async function grants(db: AppDb, accountId: string) {
    return db.select().from(accountStepUps).where(eq(accountStepUps.userAccountId, accountId));
  }

  it("grants the purpose to this session and resumes at the shop path it was given", async () => {
    const { db, shop } = ctx;
    const owner = await enrolledOwner(db, shop);
    signIn(owner.personId, owner.sessionId);

    const to = await redirectedTo(() =>
      verifyStepUpAction(
        shop.slug,
        form({ purpose: "money", returnTo: returnTo(shop.slug), code: totpCode(owner.secret) }),
      ),
    );

    expect(to).toBe(returnTo(shop.slug));
    const [grant] = await grants(db, owner.accountId);
    expect(grant).toMatchObject({ accountSessionId: owner.sessionId, purpose: "money" });
  });

  it.each([
    ["another site", "https://evil.example/shop"],
    ["a protocol-relative host", "//evil.example/x"],
    ["another shop", "/shop/someone-else/orders"],
  ])("refuses a return path to %s and grants nothing", async (_, target) => {
    const { db, shop } = ctx;
    const owner = await enrolledOwner(db, shop);
    signIn(owner.personId, owner.sessionId);

    const to = await redirectedTo(() =>
      verifyStepUpAction(
        shop.slug,
        form({ purpose: "money", returnTo: target, code: totpCode(owner.secret) }),
      ),
    );

    expect(to).toBe(noticeUrl(securityPage(shop.slug), "security-invalid"));
    expect(await grants(db, owner.accountId)).toEqual([]);
  });

  it("refuses an unknown purpose", async () => {
    const { db, shop } = ctx;
    const owner = await enrolledOwner(db, shop);
    signIn(owner.personId, owner.sessionId);

    const to = await redirectedTo(() =>
      verifyStepUpAction(
        shop.slug,
        form({ purpose: "erase", returnTo: returnTo(shop.slug), code: totpCode(owner.secret) }),
      ),
    );

    expect(to).toBe(noticeUrl(securityPage(shop.slug), "security-invalid"));
    expect(await grants(db, owner.accountId)).toEqual([]);
  });

  it("will not grant a step-up onto another account's session", async () => {
    const { db, shop } = ctx;
    const owner = await enrolledOwner(db, shop);
    const other = await enrolledOwner(db, shop);
    // Owner's own code, but a session claim naming the other account's row.
    signIn(owner.personId, other.sessionId);

    const to = await redirectedTo(() =>
      verifyStepUpAction(
        shop.slug,
        form({ purpose: "export", returnTo: returnTo(shop.slug), code: totpCode(owner.secret) }),
      ),
    );

    expect(to).toBe(noticeUrl(securityPage(shop.slug), "security-invalid"));
    expect(await grants(db, owner.accountId)).toEqual([]);
    expect(await grants(db, other.accountId)).toEqual([]);
  });

  /**
   * A decision, pinned: a step-up does **not** spend the TOTP time step
   * (`consumeTotpStep: false`), so a staffer who has just signed in is not
   * locked out of the next challenge for the rest of the window. The cost is
   * that the code stays good for that window. Changing this is a security
   * call, not a refactor. Aaron confirmed the rule on 2026-10-15.
   */
  it("leaves the code's time step unspent", async () => {
    const { db, shop } = ctx;
    const owner = await enrolledOwner(db, shop);
    signIn(owner.personId, owner.sessionId);
    // Turning two-factor on spent the current step; the next one is still
    // unspent, and the checker's one step of drift takes it now.
    const code = totpCode(owner.secret, nowMs() + TOTP_STEP_SECONDS * 1000);
    const before = (await getAccountSecurity(db, owner.accountId))?.lastTotpStep;

    await redirectedTo(() =>
      verifyStepUpAction(
        shop.slug,
        form({ purpose: "backup", returnTo: returnTo(shop.slug), code }),
      ),
    );

    expect((await getAccountSecurity(db, owner.accountId))?.lastTotpStep).toBe(before);
    // Sign-in, which does spend it, still takes the same code once.
    expect(await verifyAccountSecondFactor(db, owner.accountId, code)).toBe(true);
    expect(await verifyAccountSecondFactor(db, owner.accountId, code)).toBe(false);
  });
});
