import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate, nowMs } from "@/lib/clock";
import {
  keyringOpensStored,
  openSecret,
  secretKeyFingerprint,
  secretKeyFromEnvironment,
} from "@/lib/secret-box";
import { hasRequiredStepUp } from "@/lib/security-step-up";
import { recoveryCodeHashes, TOTP_STEP_SECONDS, totpCode } from "@/lib/totp";
import { fileScopedShopContext } from "@/test/db";
import {
  beginTotpEnrollment,
  enableTotp,
  getAccountSecurity,
  getTotpSecret,
  grantStepUp,
  hasStepUp,
  refreshAccountRecoveryCodes,
  storedSealings,
  verifyAccountSecondFactor,
} from "./account-security";
import { accountSecurity, accountSessions, userAccounts } from "./schema";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`). Sequential contracts live here;
// independent-session contention is proven by account-security.postgres.test.ts.
const ctx = fileScopedShopContext();

function sealingKey() {
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") throw new Error("the unit suite configures a sealing key");
  return key.key.current;
}

/**
 * Two-factor turned on some time ago: the enrolment code spent its step, and
 * that step has long passed, so the step record is cleared to say so.
 */
async function enrolledEarlier(db: Awaited<ReturnType<typeof seededAccount>>["db"], id: string) {
  const started = await beginTotpEnrollment(db, id);
  if (!started) throw new Error("enrollment needs a sealing key");
  expect(await enableTotp(db, id, totpCode(started.secret))).toBe(true);
  await db
    .update(accountSecurity)
    .set({ lastTotpStep: null })
    .where(eq(accountSecurity.userAccountId, id));
  return started;
}

async function seededAccount() {
  const { db, shop } = ctx;
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

    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(true);
    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(false);
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

describe("refreshing account recovery codes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires an enabled second factor and rejects a wrong code without changing recovery codes", async () => {
    const { db, account } = await seededAccount();
    expect(await refreshAccountRecoveryCodes(db, account.id, "000000")).toEqual({
      ok: false,
      reason: "invalid",
    });

    const { secret } = await enrolledEarlier(db, account.id);
    const before = await getAccountSecurity(db, account.id);
    const wrong = totpCode(secret, nowMs() + 10 * TOTP_STEP_SECONDS * 1000);
    expect(await refreshAccountRecoveryCodes(db, account.id, wrong)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect((await getAccountSecurity(db, account.id))?.recoveryCodeHashes).toEqual(
      before?.recoveryCodeHashes,
    );
  });

  it("replaces old codes after a valid authenticator code", async () => {
    const { db, account } = await seededAccount();
    const { secret, recoveryCodes } = await enrolledEarlier(db, account.id);
    const result = await refreshAccountRecoveryCodes(db, account.id, totpCode(secret));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("rotation failed");
    expect(result.codes.length).toBeGreaterThan(0);
    expect(await verifyAccountSecondFactor(db, account.id, recoveryCodes[0] ?? "")).toBe(false);
    expect(await verifyAccountSecondFactor(db, account.id, result.codes[0] ?? "")).toBe(true);
  });

  it("spends the recovery code used for rotation and replaces every previous code", async () => {
    const { db, account } = await seededAccount();
    const { recoveryCodes } = await enrolledEarlier(db, account.id);
    const result = await refreshAccountRecoveryCodes(db, account.id, recoveryCodes[0] ?? "");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("rotation failed");
    expect(await verifyAccountSecondFactor(db, account.id, recoveryCodes[0] ?? "")).toBe(false);
    expect(await verifyAccountSecondFactor(db, account.id, recoveryCodes[1] ?? "")).toBe(false);
    expect(await verifyAccountSecondFactor(db, account.id, result.codes[0] ?? "")).toBe(true);
  });

  it("refuses rotation when the sealing key is unavailable", async () => {
    const { db, account } = await seededAccount();
    await enrolledEarlier(db, account.id);
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    expect(await refreshAccountRecoveryCodes(db, account.id, "000000")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("account-security TOTP", () => {
  async function enrolled() {
    const { db, account } = await seededAccount();
    const started = await enrolledEarlier(db, account.id);
    return { db, account, secret: started.secret };
  }

  /** The code typed to turn two-factor on is spent, as a sign-in code is. */
  it("refuses the enrolment code at sign-in inside its window", async () => {
    const { db, account } = await seededAccount();
    const started = await beginTotpEnrollment(db, account.id);
    if (!started) throw new Error("enrollment needs a sealing key");
    const code = totpCode(started.secret);

    expect(await enableTotp(db, account.id, code)).toBe(true);
    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(false);
  });

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

/**
 * A rotated SECRET_ENCRYPTION_KEY used to lock out every account with
 * two-factor on: the TOTP secret would not open and no recovery code would
 * match. With the old value in SECRET_ENCRYPTION_KEY_PREVIOUS, both still work,
 * and the TOTP secret moves to the new key at the next successful check.
 */
describe("account-security across a key rotation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Rotates the environment: a fresh current key, the suite's key as previous. */
  function rotate({ keepPrevious = true } = {}) {
    const previous = sealingKey().toString("base64");
    const next = randomBytes(32);
    vi.stubEnv("SECRET_ENCRYPTION_KEY", next.toString("base64"));
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", keepPrevious ? previous : "");
    return next;
  }

  async function enrolledUnderSuiteKey() {
    const { db, account } = await seededAccount();
    const started = await enrolledEarlier(db, account.id);
    return { db, account, ...started };
  }

  /**
   * The runbook's query (docs/engineering/infrastructure-runbook.md, "Rotating
   * the secret-sealing key"), with the current key's fingerprint bound: the
   * accounts that still depend on the previous key.
   */
  async function stillOnPreviousKey(
    db: Awaited<ReturnType<typeof seededAccount>>["db"],
    current: Buffer,
  ) {
    const result = await db.execute(sql`
      select user_account_id from account_security
      where totp_enabled_at is not null
        and (totp_secret_key_id is distinct from ${secretKeyFingerprint(current)}
          or (jsonb_array_length(recovery_code_hashes) > 0
            and recovery_codes_key_id is distinct from ${secretKeyFingerprint(current)}))`);
    return result.rows.map((row) => (row as { user_account_id: string }).user_account_id);
  }

  it("records which key protects each account, so a rotation can be seen to finish", async () => {
    const { db, account, secret, recoveryCodes } = await enrolledUnderSuiteKey();
    const old = sealingKey();
    const enrolledRow = await getAccountSecurity(db, account.id);
    expect(enrolledRow?.totpSecretKeyId).toBe(secretKeyFingerprint(old));
    expect(enrolledRow?.recoveryCodesKeyId).toBe(secretKeyFingerprint(old));

    const next = rotate();
    expect(await stillOnPreviousKey(db, next)).toContain(account.id);

    // A sign-in moves the secret; the paper codes stay under the old key.
    expect(await verifyAccountSecondFactor(db, account.id, totpCode(secret))).toBe(true);
    const signedIn = await getAccountSecurity(db, account.id);
    expect(signedIn?.totpSecretKeyId).toBe(secretKeyFingerprint(next));
    expect(signedIn?.recoveryCodesKeyId).toBe(secretKeyFingerprint(old));
    expect(await stillOnPreviousKey(db, next)).toContain(account.id);

    // Spending a code confirms the key the rest were hashed under.
    expect(await verifyAccountSecondFactor(db, account.id, recoveryCodes[0] ?? "")).toBe(true);
    expect((await getAccountSecurity(db, account.id))?.recoveryCodesKeyId).toBe(
      secretKeyFingerprint(old),
    );

    // Re-enrolling under the new key is what takes the account off the list.
    await db
      .update(accountSecurity)
      .set({ totpEnabledAt: null })
      .where(eq(accountSecurity.userAccountId, account.id));
    await enrolledEarlier(db, account.id);
    expect(await stillOnPreviousKey(db, next)).not.toContain(account.id);
  });

  it("locks the account out when the old key is simply dropped", async () => {
    const { db, account, secret, recoveryCodes } = await enrolledUnderSuiteKey();
    rotate({ keepPrevious: false });

    expect(await verifyAccountSecondFactor(db, account.id, totpCode(secret))).toBe(false);
    expect(await verifyAccountSecondFactor(db, account.id, recoveryCodes[0] ?? "")).toBe(false);
  });

  it("accepts a TOTP code under the previous key and re-seals the secret under the new one", async () => {
    const { db, account, secret } = await enrolledUnderSuiteKey();
    const next = rotate();

    expect(await verifyAccountSecondFactor(db, account.id, totpCode(secret))).toBe(true);
    const sealed = (await getAccountSecurity(db, account.id))?.totpSecretSealed ?? "";
    // Opens under the new key alone: the previous key can now be retired for this account.
    expect(openSecret(sealed, next)).toBe(secret);
  });

  it("leaves the secret under the previous key when the code is wrong", async () => {
    const { db, account, secret } = await enrolledUnderSuiteKey();
    rotate();
    const before = (await getAccountSecurity(db, account.id))?.totpSecretSealed;
    const wrong = totpCode(secret, nowMs() + 10 * TOTP_STEP_SECONDS * 1000);

    expect(await verifyAccountSecondFactor(db, account.id, wrong)).toBe(false);
    expect((await getAccountSecurity(db, account.id))?.totpSecretSealed).toBe(before);
  });

  it("accepts a recovery code issued under the previous key, once", async () => {
    const { db, account, recoveryCodes } = await enrolledUnderSuiteKey();
    rotate();
    const code = recoveryCodes[0] ?? "";

    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(true);
    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(false);
    expect((await getAccountSecurity(db, account.id))?.recoveryCodeHashes).toHaveLength(
      recoveryCodes.length - 1,
    );
  });

  /** The deploy's check (`scripts/check-sealing-keys.ts`, issue #2999) against this database. */
  async function deployCheck(db: Awaited<ReturnType<typeof seededAccount>>["db"]) {
    const key = secretKeyFromEnvironment();
    if (key.status !== "ok") throw new Error("the check runs with a sealing key");
    return keyringOpensStored(key.key, await storedSealings(db));
  }

  it("lets a deploy with the correct pair through", async () => {
    const { db } = await enrolledUnderSuiteKey();
    rotate();
    expect(await deployCheck(db)).toMatchObject({ status: "ok" });
  });

  it("stops a deploy whose rotated key came without its previous", async () => {
    const { db } = await enrolledUnderSuiteKey();
    rotate({ keepPrevious: false });
    expect(await deployCheck(db)).toMatchObject({
      status: "cannot_open",
      reason: "previous_missing",
    });
  });

  it("stops a deploy whose previous key is well formed but wrong", async () => {
    const { db } = await enrolledUnderSuiteKey();
    rotate();
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", randomBytes(32).toString("base64"));
    expect(await deployCheck(db)).toMatchObject({
      status: "cannot_open",
      reason: "keys_do_not_open",
    });
  });

  it("does not count an enrolment never confirmed", async () => {
    const { db, account } = await seededAccount();
    await db.delete(accountSecurity);
    expect(await beginTotpEnrollment(db, account.id)).not.toBeNull();
    rotate({ keepPrevious: false });
    expect(await deployCheck(db)).toEqual({ status: "ok", checked: 0 });
  });

  it("hashes codes issued after the rotation under the new key", async () => {
    const next = rotate();
    const { db, account, recoveryCodes } = await enrolledUnderSuiteKey();
    // The previous key is gone now; codes issued under the new one still work.
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "");
    vi.stubEnv("SECRET_ENCRYPTION_KEY", next.toString("base64"));

    expect(await verifyAccountSecondFactor(db, account.id, recoveryCodes[1] ?? "")).toBe(true);
  });
});

/**
 * **The gate every money, export and backup action asks** (security review of
 * the test-suite layer 1). `hasStepUp` is the ledger; this is the question the
 * routes put to it, read against the signed-in session, and it fails closed on
 * everything but "two-factor is off".
 */
describe("hasRequiredStepUp", () => {
  async function owner() {
    const { db, shop, account } = await seededAccount();
    const [first, second] = await Promise.all(
      ["a", "b"].map(async (tag) => {
        const [row] = await db
          .insert(accountSessions)
          .values({
            userAccountId: account.id,
            personId: account.personId,
            shopId: shop.id,
            shopSlug: shop.slug,
            roles: ["owner"],
            name: "Test Owner",
            token: `step-up-${account.id}-${tag}`,
            expiresAt: new Date(nowMs() + 3_600_000),
          })
          .returning({ id: accountSessions.id });
        if (!row) throw new Error("session insert failed");
        return row;
      }),
    );
    if (!first || !second) throw new Error("sessions missing");
    const sessionAs = (sessionId: string | undefined): DiveDaySession => ({
      user: {
        userAccountId: account.id,
        sessionId,
        personId: account.personId,
        shopId: shop.id,
        shopSlug: shop.slug,
        roles: ["owner"],
        name: "Test Owner",
        email: "owner@dive.day",
      },
    });
    const turnOnTotp = () =>
      db.insert(accountSecurity).values({ userAccountId: account.id, totpEnabledAt: nowDate() });
    return { db, account, first, second, sessionAs, turnOnTotp };
  }

  it("passes when two-factor is off, with no grant at all", async () => {
    const { db, first, sessionAs } = await owner();
    expect(await hasRequiredStepUp(db, sessionAs(first.id), "money")).toBe(true);
  });

  it("refuses with two-factor on and no grant", async () => {
    const { db, first, sessionAs, turnOnTotp } = await owner();
    await turnOnTotp();
    expect(await hasRequiredStepUp(db, sessionAs(first.id), "money")).toBe(false);
  });

  it("passes with a grant held by this session, for this purpose only", async () => {
    const { db, account, first, sessionAs, turnOnTotp } = await owner();
    await turnOnTotp();
    await grantStepUp(db, {
      userAccountId: account.id,
      accountSessionId: first.id,
      purpose: "money",
    });
    expect(await hasRequiredStepUp(db, sessionAs(first.id), "money")).toBe(true);
    expect(await hasRequiredStepUp(db, sessionAs(first.id), "export")).toBe(false);
  });

  it("refuses a grant held by another of the account's sessions", async () => {
    const { db, account, first, second, sessionAs, turnOnTotp } = await owner();
    await turnOnTotp();
    await grantStepUp(db, {
      userAccountId: account.id,
      accountSessionId: second.id,
      purpose: "money",
    });
    expect(await hasRequiredStepUp(db, sessionAs(first.id), "money")).toBe(false);
  });

  it("refuses a session that carries no session id, even with a grant on file", async () => {
    const { db, account, first, sessionAs, turnOnTotp } = await owner();
    await turnOnTotp();
    await grantStepUp(db, {
      userAccountId: account.id,
      accountSessionId: first.id,
      purpose: "money",
    });
    expect(await hasRequiredStepUp(db, sessionAs(undefined), "money")).toBe(false);
  });
});

/**
 * Step-up and turning two-factor off check a code without spending its time
 * step; sign-in spends it. A check that does not spend must also write nothing.
 */
describe("account-security unspent checks", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a code without spending its step, so sign-in can still use it", async () => {
    const { db, account } = await seededAccount();
    const { secret } = await enrolledEarlier(db, account.id);
    const code = totpCode(secret);

    expect(await verifyAccountSecondFactor(db, account.id, code, { consumeTotpStep: false })).toBe(
      true,
    );
    expect(await verifyAccountSecondFactor(db, account.id, code, { consumeTotpStep: false })).toBe(
      true,
    );
    expect((await getAccountSecurity(db, account.id))?.lastTotpStep).toBeNull();
    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(true);
    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(false);
  });

  it("still refuses a wrong code when the step is not spent", async () => {
    const { db, account } = await seededAccount();
    const { secret } = await enrolledEarlier(db, account.id);
    const wrong = totpCode(secret, nowMs() + 10 * TOTP_STEP_SECONDS * 1000);

    expect(await verifyAccountSecondFactor(db, account.id, wrong, { consumeTotpStep: false })).toBe(
      false,
    );
  });

  it("leaves a previous-key secret sealed as it was when the step is not spent", async () => {
    const { db, account } = await seededAccount();
    const { secret } = await enrolledEarlier(db, account.id);
    const before = await getAccountSecurity(db, account.id);
    const previous = sealingKey().toString("base64");
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", previous);

    expect(
      await verifyAccountSecondFactor(db, account.id, totpCode(secret), {
        consumeTotpStep: false,
      }),
    ).toBe(true);
    const after = await getAccountSecurity(db, account.id);
    expect(after?.totpSecretSealed).toBe(before?.totpSecretSealed);
    expect(after?.totpSecretKeyId).toBe(before?.totpSecretKeyId);
  });
});

describe("account-security enrolment edges", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the second factor for an account that never set one up", async () => {
    const { db, account } = await seededAccount();
    expect(await getAccountSecurity(db, account.id)).toBeNull();
    expect(await verifyAccountSecondFactor(db, account.id, "000000")).toBe(true);
  });

  it("refuses to start a second enrolment over one that is already on", async () => {
    const { db, account } = await seededAccount();
    const { secret } = await enrolledEarlier(db, account.id);
    const before = await getAccountSecurity(db, account.id);

    expect(await beginTotpEnrollment(db, account.id)).toBeNull();
    const after = await getAccountSecurity(db, account.id);
    expect(after?.totpSecretSealed).toBe(before?.totpSecretSealed);
    expect(after?.recoveryCodeHashes).toEqual(before?.recoveryCodeHashes);
    expect(await getTotpSecret(db, account.id)).toBe(secret);
  });

  it("refuses to turn two-factor on with no enrolment started", async () => {
    const { db, account } = await seededAccount();
    expect(await enableTotp(db, account.id, "000000")).toBe(false);
    expect(await getAccountSecurity(db, account.id)).toBeNull();
  });

  /** The enabling code spends its step, so presenting it again changes nothing. */
  it("refuses the enabling code a second time", async () => {
    const { db, account } = await seededAccount();
    const started = await beginTotpEnrollment(db, account.id);
    if (!started) throw new Error("enrollment needs a sealing key");
    const code = totpCode(started.secret);

    expect(await enableTotp(db, account.id, code)).toBe(true);
    const enabledAt = (await getAccountSecurity(db, account.id))?.totpEnabledAt;
    expect(await enableTotp(db, account.id, code)).toBe(false);
    expect((await getAccountSecurity(db, account.id))?.totpEnabledAt).toEqual(enabledAt);
  });

  it("shows the enrolment secret, and nothing for an account without one", async () => {
    const { db, account } = await seededAccount();
    expect(await getTotpSecret(db, account.id)).toBeNull();
    const started = await beginTotpEnrollment(db, account.id);
    expect(await getTotpSecret(db, account.id)).toBe(started?.secret);
  });

  it("shows no secret once the key that sealed it is gone", async () => {
    const { db, account } = await seededAccount();
    await beginTotpEnrollment(db, account.id);
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("SECRET_ENCRYPTION_KEY_PREVIOUS", "");

    expect(await getTotpSecret(db, account.id)).toBeNull();
  });

  /**
   * A row whose recorded key id is stale but whose secret already opens under
   * the current key: an accepted code corrects the id and leaves the
   * ciphertext alone.
   */
  it("records the current key's id without re-sealing a secret it already protects", async () => {
    const { db, account } = await seededAccount();
    const { secret } = await enrolledEarlier(db, account.id);
    await db
      .update(accountSecurity)
      .set({ totpSecretKeyId: null })
      .where(eq(accountSecurity.userAccountId, account.id));
    const before = await getAccountSecurity(db, account.id);

    expect(await verifyAccountSecondFactor(db, account.id, totpCode(secret))).toBe(true);
    const after = await getAccountSecurity(db, account.id);
    expect(after?.totpSecretKeyId).toBe(secretKeyFingerprint(sealingKey()));
    expect(after?.totpSecretSealed).toBe(before?.totpSecretSealed);
  });
});

/**
 * A missing or mis-pasted key degrades to "no": enrolment does not start, and
 * neither a TOTP code nor a recovery code is accepted. Nothing throws.
 */
describe.each([
  ["missing", { SECRET_ENCRYPTION_KEY: "" }],
  ["malformed", { SECRET_ENCRYPTION_KEY: "not-a-key" }],
  ["with a malformed previous key", { SECRET_ENCRYPTION_KEY_PREVIOUS: "c2hvcnQ=" }],
])("account-security with the sealing key %s", (_label, env) => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function breakKey() {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  }

  it("does not start an enrolment", async () => {
    const { db, account } = await seededAccount();
    breakKey();
    expect(await beginTotpEnrollment(db, account.id)).toBeNull();
    expect(await getAccountSecurity(db, account.id)).toBeNull();
  });

  it("refuses both a TOTP code and a recovery code, and spends neither", async () => {
    const { db, account } = await seededAccount();
    const { secret, recoveryCodes } = await enrolledEarlier(db, account.id);
    breakKey();
    const code = recoveryCodes[0] ?? "";

    expect(await verifyAccountSecondFactor(db, account.id, totpCode(secret))).toBe(false);
    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(false);
    expect(await enableTotp(db, account.id, totpCode(secret))).toBe(false);
    expect(await getTotpSecret(db, account.id)).toBeNull();

    vi.unstubAllEnvs();
    expect((await getAccountSecurity(db, account.id))?.recoveryCodeHashes).toHaveLength(
      recoveryCodes.length,
    );
    expect(await verifyAccountSecondFactor(db, account.id, code)).toBe(true);
  });
});
