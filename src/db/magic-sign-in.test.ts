import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { totpCode } from "@/lib/totp";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { beginTotpEnrollment, enableTotp } from "./account-security";
import { checkAccountToken, issueAccountToken, withdrawAccountTokens } from "./account-tokens";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import { issueMagicSignIn, startMagicSignIn } from "./magic-sign-in";
import { capabilities, people, personRoles, shops, userAccounts } from "./schema";

const ctx = fileScopedShopContext();
async function fixture() {
  const db = ctx.db;
  const [account] = await db
    .select()
    .from(userAccounts)
    .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
  const [person] = await db.select().from(people).where(eq(people.id, account.personId));
  const email = "verified-owner@example.com";
  await db.update(shops).set({ isDemo: false }).where(eq(shops.id, person.shopId));
  await db
    .update(userAccounts)
    .set({ email, emailVerified: true, emailVerifiedAt: nowDate() })
    .where(eq(userAccounts.id, account.id));
  const persist = vi.fn(async () => "session");
  const issue = async () => {
    const issued = await issueMagicSignIn(db, email);
    if (!issued) throw new Error("expected eligible account");
    return issued;
  };
  const redeem = (token: string) => startMagicSignIn(db, { token, previousHandle: null }, persist);
  return { db, account, person, email, issue, redeem, persist };
}

describe("magic email sign-in", () => {
  it("issues only to the verified account address, stores a digest and consumes once", async () => {
    const h = await fixture();
    const issued = await h.issue();
    expect(issued).not.toBeNull();
    expect(issued?.contact.email).toBe(h.email);
    const [row] = await h.db.select().from(capabilities).where(eq(capabilities.id, issued.tokenId));
    expect(row.tokenHash).toBe(hashBearerToken(issued.token.split(".")[0]));
    expect(await h.redeem(issued.token)).toEqual({ status: "signed_in", value: "session" });
    expect((await h.redeem(issued.token)).status).toBe("invalid");
    expect(h.persist).toHaveBeenCalledTimes(1);
  });
  it("does not accept reset tokens and does not consume on GET-style checks", async () => {
    const h = await fixture();
    const issued = await h.issue();
    const raw = issued.token.split(".")[0];
    expect(await checkAccountToken(h.db, { token: raw, purpose: "magic_sign_in" })).not.toBeNull();
    expect(await checkAccountToken(h.db, { token: raw, purpose: "password_reset" })).toBeNull();
    const reset = await issueAccountToken(h.db, {
      userAccountId: h.account.id,
      purpose: "password_reset",
    });
    expect((await h.redeem(reset.token)).status).toBe("invalid");
    expect((await h.redeem(issued.token)).status).toBe("signed_in");
  });
  it("supersedes, expires and participates in account token withdrawal", async () => {
    const h = await fixture();
    const first = await h.issue();
    const second = await h.issue();
    expect((await h.redeem(first.token)).status).toBe("invalid");
    advanceClock(16 * 60 * 1000);
    expect((await h.redeem(second.token)).status).toBe("invalid");
    const third = await h.issue();
    await withdrawAccountTokens(h.db, { userAccountId: h.account.id });
    expect((await h.redeem(third.token)).status).toBe("invalid");
  });
  it.each(["unknown", "unverified", "disabled", "deleted", "demo", "namespace", "no-role"])(
    "refuses %s issuance",
    async (reason) => {
      const h = await fixture();
      if (reason === "unverified")
        await h.db
          .update(userAccounts)
          .set({ emailVerified: false, emailVerifiedAt: null })
          .where(eq(userAccounts.id, h.account.id));
      if (reason === "disabled")
        await h.db
          .update(userAccounts)
          .set({ status: "disabled" })
          .where(eq(userAccounts.id, h.account.id));
      if (reason === "deleted")
        await h.db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, h.person.id));
      if (reason === "demo")
        await h.db.update(shops).set({ isDemo: true }).where(eq(shops.id, h.person.shopId));
      if (reason === "namespace")
        await h.db
          .update(userAccounts)
          .set({ email: "owner@demo.invalid" })
          .where(eq(userAccounts.id, h.account.id));
      if (reason === "no-role")
        await h.db.delete(personRoles).where(eq(personRoles.personId, h.person.id));
      expect(
        await issueMagicSignIn(
          h.db,
          reason === "unknown"
            ? "missing@example.com"
            : reason === "namespace"
              ? "owner@demo.invalid"
              : h.email,
        ),
      ).toBeNull();
    },
  );
  it("refuses an address change or disabled account after issuance", async () => {
    const h = await fixture();
    const issued = await h.issue();
    await h.db
      .update(userAccounts)
      .set({ email: "new@example.com" })
      .where(eq(userAccounts.id, h.account.id));
    expect((await h.redeem(issued.token)).status).toBe("invalid");
    await h.db
      .update(userAccounts)
      .set({ email: h.email, status: "disabled" })
      .where(eq(userAccounts.id, h.account.id));
    expect((await h.redeem(issued.token)).status).toBe("invalid");
    expect(h.persist).not.toHaveBeenCalled();
  });
  it("requires the existing second factor without creating a session", async () => {
    const h = await fixture();
    const enrollment = await beginTotpEnrollment(h.db, h.account.id);
    if (!enrollment) throw new Error("enrollment unavailable");
    expect(await enableTotp(h.db, h.account.id, totpCode(enrollment.secret))).toBe(true);
    const issued = await h.issue();
    expect((await h.redeem(issued.token)).status).toBe("pending");
    expect(h.persist).not.toHaveBeenCalled();
    expect((await h.redeem(issued.token)).status).toBe("invalid");
  });
  it("rolls back token spending if session persistence fails", async () => {
    const h = await fixture();
    const issued = await h.issue();
    await expect(
      startMagicSignIn(h.db, { token: issued.token, previousHandle: null }, async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect((await h.redeem(issued.token)).status).toBe("signed_in");
  });
});

describe("operator demo handoffs", () => {
  it("accepts a demo link after fifteen minutes, consumes once, and expires at 24 hours", async () => {
    const h = await fixture();
    await h.db.update(shops).set({ isDemo: true }).where(eq(shops.id, h.person.shopId));
    await h.db
      .update(userAccounts)
      .set({ email: "owner@demo.invalid", emailVerified: false, emailVerifiedAt: null })
      .where(eq(userAccounts.id, h.account.id));
    const first = await issueAccountToken(h.db, {
      userAccountId: h.account.id,
      purpose: "demo_sign_in",
    });
    advanceClock(60 * 60 * 1000);
    expect((await h.redeem(first.token)).status).toBe("signed_in");
    expect((await h.redeem(first.token)).status).toBe("invalid");
    const second = await issueAccountToken(h.db, {
      userAccountId: h.account.id,
      purpose: "demo_sign_in",
    });
    advanceClock(24 * 60 * 60 * 1000);
    expect((await h.redeem(second.token)).status).toBe("invalid");
  });
  it("cannot turn a real owner into a demo sign-in, even with a minted demo token", async () => {
    const h = await fixture();
    const token = await issueAccountToken(h.db, {
      userAccountId: h.account.id,
      purpose: "demo_sign_in",
    });
    expect((await h.redeem(token.token)).status).toBe("invalid");
    await h.db.update(shops).set({ isDemo: true }).where(eq(shops.id, h.person.shopId));
    expect((await h.redeem(token.token)).status).toBe("invalid");
    expect(h.persist).not.toHaveBeenCalled();
  });
});
