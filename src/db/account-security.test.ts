import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { secretKeyFromEnvironment } from "@/lib/secret-box";
import { recoveryCodeHashes, TOTP_STEP_SECONDS, totpCode } from "@/lib/totp";
import { seededShopContext } from "@/test/db";
import {
  beginTotpEnrollment,
  enableTotp,
  getAccountSecurity,
  grantStepUp,
  hasStepUp,
  verifyAccountSecondFactor,
} from "./account-security";
import { accountSecurity, accountSessions, userAccounts } from "./schema";

function sealingKey() {
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") throw new Error("the unit suite configures a sealing key");
  return key.key;
}

async function seededAccount() {
  const { db, shop } = await seededShopContext();
  const [account] = await db
    .select({ id: userAccounts.id, personId: userAccounts.personId })
    .from(userAccounts)
    .limit(1);
  if (!account) throw new Error("seeded account missing");
  return { db, shop, account };
}

describe("account-security recovery codes", () => {
  it("allows a recovery code to be consumed only once", async () => {
    const { db, account } = await seededAccount();
    const code = "ABCD234567";
    await db.insert(accountSecurity).values({
      userAccountId: account.id,
      totpEnabledAt: nowDate(),
      recoveryCodeHashes: recoveryCodeHashes([code], sealingKey(), account.id),
    });

    const results = await Promise.all([
      verifyAccountSecondFactor(db, account.id, code),
      verifyAccountSecondFactor(db, account.id, code),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await getAccountSecurity(db, account.id))?.recoveryCodeHashes).toEqual([]);
    expect(
      await db
        .select({ id: accountSecurity.userAccountId })
        .from(accountSecurity)
        .where(eq(accountSecurity.userAccountId, account.id)),
    ).toHaveLength(1);
  });

  /** Codes are read off a printed sheet, so spacing and case are the reader's. */
  it("accepts a recovery code however it was typed back", async () => {
    const { db, account } = await seededAccount();
    await db.insert(accountSecurity).values({
      userAccountId: account.id,
      totpEnabledAt: nowDate(),
      recoveryCodeHashes: recoveryCodeHashes(["ABCD234567"], sealingKey(), account.id),
    });

    expect(await verifyAccountSecondFactor(db, account.id, " abcd-234567 ")).toBe(true);
  });

  it("refuses a code hashed for a different account", async () => {
    const { db, account } = await seededAccount();
    await db.insert(accountSecurity).values({
      userAccountId: account.id,
      totpEnabledAt: nowDate(),
      // The same plaintext, salted for somebody else: the digest must not match.
      recoveryCodeHashes: recoveryCodeHashes(["ABCD234567"], sealingKey(), "another-account"),
    });

    expect(await verifyAccountSecondFactor(db, account.id, "ABCD234567")).toBe(false);
  });
});

describe("account-security TOTP", () => {
  async function enrolled() {
    const { db, account } = await seededAccount();
    const started = await beginTotpEnrollment(db, account.id);
    if (!started) throw new Error("enrollment needs a sealing key");
    expect(await enableTotp(db, account.id, totpCode(started.secret))).toBe(true);
    return { db, account, secret: started.secret };
  }

  it("accepts the code the authenticator is showing", async () => {
    const { db, account, secret } = await enrolled();
    expect(await verifyAccountSecondFactor(db, account.id, totpCode(secret))).toBe(true);
  });

  /**
   * The anti-replay control the module's own docblock promises. A code seen
   * over a shoulder or captured in a proxy log stays valid for the rest of its
   * window unless the step it belongs to is spent on first use.
   */
  it("spends the time step, so the same code cannot be presented twice", async () => {
    const { db, account, secret } = await enrolled();
    const code = totpCode(secret);

    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(true);
    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(false);
  });

  it("spends the step the code belonged to, not whichever step is current", async () => {
    const { db, account, secret } = await enrolled();
    const now = nowMs();
    // A code from the previous step, accepted as drift and consumed as its own.
    const previous = totpCode(secret, now - TOTP_STEP_SECONDS * 1000);

    expect(await verifyAccountSecondFactor(db, account.id, previous)).toBe(true);
    expect(await verifyAccountSecondFactor(db, account.id, previous)).toBe(false);
    // The current step is still ahead of the spent one, so it still works.
    expect(await verifyAccountSecondFactor(db, account.id, totpCode(secret, now))).toBe(true);
  });

  it("leaves the step unspent when the caller only checks", async () => {
    const { db, account, secret } = await enrolled();
    const code = totpCode(secret);

    expect(await verifyAccountSecondFactor(db, account.id, code, { consumeTotpStep: false })).toBe(
      true,
    );
    expect(await verifyAccountSecondFactor(db, account.id, code, { consumeTotpStep: false })).toBe(
      true,
    );
  });

  it("refuses a wrong code", async () => {
    const { db, account, secret } = await enrolled();
    const wrong = totpCode(secret, nowMs() + 10 * TOTP_STEP_SECONDS * 1000);
    expect(await verifyAccountSecondFactor(db, account.id, wrong)).toBe(false);
  });

  it("does not enable two-factor until a real code proves the secret was scanned", async () => {
    const { db, account } = await seededAccount();
    const started = await beginTotpEnrollment(db, account.id);
    if (!started) throw new Error("enrollment needs a sealing key");

    expect(await enableTotp(db, account.id, "000000")).toBe(false);
    expect((await getAccountSecurity(db, account.id))?.totpEnabledAt).toBeNull();
  });
});

describe("step-up grants", () => {
  async function sessionFor(
    db: Awaited<ReturnType<typeof seededAccount>>["db"],
    account: { id: string; personId: string },
    shop: { id: string; slug: string },
  ) {
    const [session] = await db
      .insert(accountSessions)
      .values({
        userAccountId: account.id,
        personId: account.personId,
        shopId: shop.id,
        shopSlug: shop.slug,
        roles: ["owner"],
        name: "Test Owner",
        token: `test-${account.id}`,
        expiresAt: new Date(nowMs() + 3_600_000),
      })
      .returning({ id: accountSessions.id });
    if (!session) throw new Error("session insert failed");
    return session;
  }

  it("grants for one purpose and one session, and nothing else", async () => {
    const { db, shop, account } = await seededAccount();
    const session = await sessionFor(db, account, shop);

    expect(
      await grantStepUp(db, {
        userAccountId: account.id,
        accountSessionId: session.id,
        purpose: "money",
      }),
    ).not.toBeNull();

    const asked = (purpose: "money" | "export" | "backup", accountSessionId: string) =>
      hasStepUp(db, { userAccountId: account.id, accountSessionId, purpose });

    expect(await asked("money", session.id)).toBe(true);
    expect(await asked("export", session.id)).toBe(false);
    expect(await asked("money", crypto.randomUUID())).toBe(false);
  });

  /** A grant for a session that is not this account's is not a grant. */
  it("refuses to grant against a session the account does not own", async () => {
    const { db, shop, account } = await seededAccount();
    const session = await sessionFor(db, account, shop);

    expect(
      await grantStepUp(db, {
        userAccountId: crypto.randomUUID(),
        accountSessionId: session.id,
        purpose: "money",
      }),
    ).toBeNull();
  });
});
