// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PASSWORD_RESET_TTL_MS } from "@/lib/account-tokens";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { checkAccountToken, consumeAccountToken, issueAccountToken } from "./account-tokens";
import type { AppDb } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { userAccounts } from "./schema";

async function seededAccountId(db: AppDb): Promise<string> {
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email))
    .limit(1);
  if (!account) throw new Error("seeded owner account missing");
  return account.id;
}

describe("account tokens (in-memory PGlite)", () => {
  it("issues a token that checks and consumes back to the same account", async () => {
    const { db } = await seededShopContext();
    const userAccountId = await seededAccountId(db);
    const issued = await issueAccountToken(db, { userAccountId, purpose: "email_verification" });

    expect(
      await checkAccountToken(db, { token: issued.token, purpose: "email_verification" }),
    ).toEqual({ userAccountId });
    expect(
      await consumeAccountToken(db, { token: issued.token, purpose: "email_verification" }),
    ).toEqual({ userAccountId });
  });

  it("rejects a token checked under the wrong purpose", async () => {
    const { db } = await seededShopContext();
    const userAccountId = await seededAccountId(db);
    const issued = await issueAccountToken(db, { userAccountId, purpose: "email_verification" });

    expect(
      await checkAccountToken(db, { token: issued.token, purpose: "password_reset" }),
    ).toBeNull();
    expect(
      await consumeAccountToken(db, { token: issued.token, purpose: "password_reset" }),
    ).toBeNull();
  });

  it("rejects an unknown/garbage token", async () => {
    const { db } = await seededShopContext();
    expect(
      await checkAccountToken(db, { token: "not-a-real-token", purpose: "email_verification" }),
    ).toBeNull();
  });

  it("one-time use: a consumed token never verifies or consumes again", async () => {
    const { db } = await seededShopContext();
    const userAccountId = await seededAccountId(db);
    const issued = await issueAccountToken(db, { userAccountId, purpose: "password_reset" });

    expect(
      await consumeAccountToken(db, { token: issued.token, purpose: "password_reset" }),
    ).not.toBeNull();

    // A replay of the same bearer token after consumption must fail every time, not just once.
    for (let i = 0; i < 3; i++) {
      expect(
        await consumeAccountToken(db, { token: issued.token, purpose: "password_reset" }),
      ).toBeNull();
    }
    expect(
      await checkAccountToken(db, { token: issued.token, purpose: "password_reset" }),
    ).toBeNull();
  });

  it("expires: a token past its expiresAt fails to check or consume", async () => {
    const { db } = await seededShopContext();
    const userAccountId = await seededAccountId(db);
    const now = nowDate();
    const issued = await issueAccountToken(db, { userAccountId, purpose: "password_reset", now });
    const past = new Date(now.getTime() + PASSWORD_RESET_TTL_MS + 1);

    expect(
      await checkAccountToken(db, { token: issued.token, purpose: "password_reset", now: past }),
    ).toBeNull();
    expect(
      await consumeAccountToken(db, {
        token: issued.token,
        purpose: "password_reset",
        now: past,
      }),
    ).toBeNull();
  });

  it("supersede: issuing a fresh token invalidates the prior outstanding one for the same purpose", async () => {
    const { db } = await seededShopContext();
    const userAccountId = await seededAccountId(db);
    const first = await issueAccountToken(db, { userAccountId, purpose: "password_reset" });
    const second = await issueAccountToken(db, { userAccountId, purpose: "password_reset" });

    expect(first.token).not.toBe(second.token);
    expect(
      await checkAccountToken(db, { token: first.token, purpose: "password_reset" }),
    ).toBeNull();
    expect(
      await checkAccountToken(db, { token: second.token, purpose: "password_reset" }),
    ).not.toBeNull();
  });

  it("supersede is purpose-scoped: a fresh reset token leaves an outstanding verify token untouched", async () => {
    const { db } = await seededShopContext();
    const userAccountId = await seededAccountId(db);
    const verify = await issueAccountToken(db, { userAccountId, purpose: "email_verification" });
    await issueAccountToken(db, { userAccountId, purpose: "password_reset" });

    expect(
      await checkAccountToken(db, { token: verify.token, purpose: "email_verification" }),
    ).not.toBeNull();
  });

  it("does not leak the account id in the token", async () => {
    const { db } = await seededShopContext();
    const userAccountId = await seededAccountId(db);
    const issued = await issueAccountToken(db, { userAccountId, purpose: "email_verification" });
    expect(issued.token).not.toContain(userAccountId);
  });

  it("a disabled account's outstanding token stops consuming immediately, even though it was valid when issued (security review finding)", async () => {
    const { db } = await seededShopContext();
    const userAccountId = await seededAccountId(db);
    const issued = await issueAccountToken(db, { userAccountId, purpose: "password_reset" });

    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.id, userAccountId));

    expect(
      await consumeAccountToken(db, { token: issued.token, purpose: "password_reset" }),
    ).toBeNull();
  });
});
