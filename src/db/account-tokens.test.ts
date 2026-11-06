import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PASSWORD_RESET_TTL_MS } from "@/lib/account-tokens";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  checkAccountToken,
  consumeAccountToken,
  issueAccountToken,
  wasAccountTokenConsumed,
} from "./account-tokens";
import type { AppDb } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { capabilities, userAccounts } from "./schema";

async function seededAccountId(db: AppDb): Promise<string> {
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email))
    .limit(1);
  if (!account) throw new Error("seeded owner account missing");
  return account.id;
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("account tokens (in-memory PGlite)", () => {
  it("issues a token that checks and consumes back to the same account", async () => {
    const { db } = ctx;
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
    const { db } = ctx;
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
    const { db } = ctx;
    expect(
      await checkAccountToken(db, { token: "not-a-real-token", purpose: "email_verification" }),
    ).toBeNull();
  });

  it("one-time use: a consumed token never verifies or consumes again", async () => {
    const { db } = ctx;
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
    const { db } = ctx;
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
    const { db } = ctx;
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
    const { db } = ctx;
    const userAccountId = await seededAccountId(db);
    const verify = await issueAccountToken(db, { userAccountId, purpose: "email_verification" });
    await issueAccountToken(db, { userAccountId, purpose: "password_reset" });

    expect(
      await checkAccountToken(db, { token: verify.token, purpose: "email_verification" }),
    ).not.toBeNull();
  });

  it("does not leak the account id in the token", async () => {
    const { db } = ctx;
    const userAccountId = await seededAccountId(db);
    const issued = await issueAccountToken(db, { userAccountId, purpose: "email_verification" });
    expect(issued.token).not.toContain(userAccountId);
  });

  it("a disabled account's outstanding token stops consuming immediately, even though it was valid when issued (security review finding)", async () => {
    const { db } = ctx;
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

  it("an invited account (not yet active) can still consume its own invite token — only disabled blocks consumption (20260726-staff-invite-accounts)", async () => {
    const { db } = ctx;
    const userAccountId = await seededAccountId(db);
    await db
      .update(userAccounts)
      .set({ status: "invited" })
      .where(eq(userAccounts.id, userAccountId));
    const issued = await issueAccountToken(db, { userAccountId, purpose: "invite" });

    expect(await consumeAccountToken(db, { token: issued.token, purpose: "invite" })).toEqual({
      userAccountId,
    });
  });

  it.each(["active", "disabled"] as const)(
    "an invite token spent against a %s account sets nothing and stays unspent (issue #3997)",
    async (status) => {
      // The invite's whole point is turning an `invited` account into a signed-in one. Against an
      // account that is already something else it would be a password-setting link, so the claim
      // refuses it outright and burns nothing.
      const { db } = ctx;
      const userAccountId = await seededAccountId(db);
      await db
        .update(userAccounts)
        .set({ status: "invited" })
        .where(eq(userAccounts.id, userAccountId));
      const issued = await issueAccountToken(db, { userAccountId, purpose: "invite" });
      await db.update(userAccounts).set({ status }).where(eq(userAccounts.id, userAccountId));

      expect(await consumeAccountToken(db, { token: issued.token, purpose: "invite" })).toBeNull();
      expect(await wasAccountTokenConsumed(db, { token: issued.token, purpose: "invite" })).toBe(
        false,
      );
    },
  );

  it("a reset or verification token still works on an active account", async () => {
    const { db } = ctx;
    const userAccountId = await seededAccountId(db);
    const reset = await issueAccountToken(db, { userAccountId, purpose: "password_reset" });
    const verify = await issueAccountToken(db, { userAccountId, purpose: "email_verification" });
    expect(
      await consumeAccountToken(db, { token: reset.token, purpose: "password_reset" }),
    ).toEqual({ userAccountId });
    expect(
      await consumeAccountToken(db, { token: verify.token, purpose: "email_verification" }),
    ).toEqual({ userAccountId });
  });

  /**
   * Adversarial, since the tokens moved onto `capabilities` (ADR
   * 20261105-capabilities-shop-id-nullable): every purpose's token is refused
   * under every other, a superseded or revoked one consumes nothing, and the
   * row names the account and no shop.
   */
  it("never resolves a token under any purpose but its own", async () => {
    const { db } = ctx;
    const userAccountId = await seededAccountId(db);
    const purposes = ["email_verification", "password_reset", "invite"] as const;
    for (const purpose of purposes) {
      const issued = await issueAccountToken(db, { userAccountId, purpose });
      for (const other of purposes.filter((p) => p !== purpose)) {
        expect(await checkAccountToken(db, { token: issued.token, purpose: other })).toBeNull();
        expect(await consumeAccountToken(db, { token: issued.token, purpose: other })).toBeNull();
      }
      expect(await checkAccountToken(db, { token: issued.token, purpose })).toEqual({
        userAccountId,
      });
    }
  });

  it("a superseded token consumes nothing, and neither does a revoked one", async () => {
    const { db } = ctx;
    const userAccountId = await seededAccountId(db);
    const first = await issueAccountToken(db, { userAccountId, purpose: "invite" });
    const second = await issueAccountToken(db, { userAccountId, purpose: "invite" });
    expect(await consumeAccountToken(db, { token: first.token, purpose: "invite" })).toBeNull();

    await db
      .update(capabilities)
      .set({ revokedAt: nowDate() })
      .where(eq(capabilities.tokenHash, hashBearerToken(second.token)));
    expect(await checkAccountToken(db, { token: second.token, purpose: "invite" })).toBeNull();
    expect(await consumeAccountToken(db, { token: second.token, purpose: "invite" })).toBeNull();
  });

  it("a disabled account's refused consume leaves the token unspent, so re-enabling the account does not need a new link", async () => {
    const { db } = ctx;
    const userAccountId = await seededAccountId(db);
    const issued = await issueAccountToken(db, { userAccountId, purpose: "email_verification" });
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.id, userAccountId));
    expect(
      await consumeAccountToken(db, { token: issued.token, purpose: "email_verification" }),
    ).toBeNull();
    expect(
      await wasAccountTokenConsumed(db, { token: issued.token, purpose: "email_verification" }),
    ).toBe(false);

    await db
      .update(userAccounts)
      .set({ status: "active" })
      .where(eq(userAccounts.id, userAccountId));
    expect(
      await consumeAccountToken(db, { token: issued.token, purpose: "email_verification" }),
    ).toEqual({ userAccountId });
  });

  it("reports consumed only for the exact token that was spent, under its own purpose", async () => {
    const { db } = ctx;
    const userAccountId = await seededAccountId(db);
    const issued = await issueAccountToken(db, { userAccountId, purpose: "email_verification" });
    const input = { token: issued.token, purpose: "email_verification" } as const;
    expect(await wasAccountTokenConsumed(db, input)).toBe(false);
    await consumeAccountToken(db, input);
    expect(await wasAccountTokenConsumed(db, input)).toBe(true);
    expect(
      await wasAccountTokenConsumed(db, { token: issued.token, purpose: "password_reset" }),
    ).toBe(false);
    expect(
      await wasAccountTokenConsumed(db, { token: "garbage", purpose: "email_verification" }),
    ).toBe(false);
  });

  it("stores a platform row: the account, no shop, and only the digest", async () => {
    const { db } = ctx;
    const userAccountId = await seededAccountId(db);
    const issued = await issueAccountToken(db, { userAccountId, purpose: "password_reset" });
    const [row] = await db.select().from(capabilities).where(eq(capabilities.id, issued.tokenId));
    expect(row).toMatchObject({
      purpose: "password_reset",
      shopId: null,
      userAccountId,
      personId: null,
      tokenHash: hashBearerToken(issued.token),
      expiresAt: issued.expiresAt,
    });
  });
});
