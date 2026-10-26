import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAuth } from "@/lib/auth";
import type { VerifiedUser } from "@/lib/credentials";
import { hashPassword } from "@/lib/password-hashing";
import { hashPendingHandle } from "@/lib/pending-sign-in";
import { totpCode } from "@/lib/totp";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  beginTotpEnrollment,
  disableTotp,
  enableTotp,
  revokeAllAccountSessions,
} from "./account-security";
import { anonymizeDiver } from "./anonymize";
import type { AppTransaction } from "./client";
import { DEV_STAFF_LOGINS } from "./dev-credentials";
import {
  accountSecurity,
  accountSessions,
  accountSignInChallenges,
  people,
  personRoles,
  userAccounts,
} from "./schema";
import {
  cancelPendingSignIn,
  completePendingSignIn,
  hasPendingSignIn,
  startCredentialSignIn,
} from "./sign-in-challenges";
import { removeStaffMember, setStaffAccountStatus } from "./staff-accounts";
import { setAccountPassword } from "./user-accounts";

const ctx = fileScopedShopContext();
async function persist(tx: AppTransaction, user: VerifiedUser) {
  const provider = await createAuth(tx).$context;
  const session = await provider.internalAdapter.createSession(user.id, false, {
    ...user,
    personId: user.personId,
  });
  if (!session || !(await provider.internalAdapter.findUserById(user.id)))
    throw new Error("session failed");
  return session;
}
async function fixture(login = DEV_STAFF_LOGINS.owner) {
  const db = ctx.db;
  const [account] = await db.select().from(userAccounts).where(eq(userAccounts.email, login.email));
  const enrollment = await beginTotpEnrollment(db, account.id);
  if (!enrollment) throw new Error("enrollment unavailable");
  expect(await enableTotp(db, account.id, totpCode(enrollment.secret))).toBe(true);
  await db
    .update(accountSecurity)
    .set({ lastTotpStep: null })
    .where(eq(accountSecurity.userAccountId, account.id));
  const start = (previousHandle: string | null = null) =>
    startCredentialSignIn(db, { ...login, previousHandle }, persist);
  const pending = await start();
  if (pending.status !== "pending") throw new Error("no pending sign-in");
  const finish = (code = totpCode(enrollment.secret), handle: string | null = pending.handle) =>
    completePendingSignIn(db, handle, code, async () => true, persist);
  const rows = () =>
    db
      .select()
      .from(accountSignInChallenges)
      .where(eq(accountSignInChallenges.userAccountId, account.id));
  const sessions = async () =>
    (
      await db
        .select({ n: count() })
        .from(accountSessions)
        .where(eq(accountSessions.userAccountId, account.id))
    )[0].n;
  return { db, account, enrollment, start, pending, finish, rows, sessions };
}

describe("pending second-factor sign-in", () => {
  it("stores a digest-only bounded proof without issuing a session", async () => {
    const h = await fixture();
    const [row] = await h.rows();
    expect(row.tokenHash).toBe(hashPendingHandle(h.pending.handle));
    expect(row.attemptsRemaining).toBe(5);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(300_000);
    expect(Object.keys(row).sort()).toEqual([
      "attemptsRemaining",
      "createdAt",
      "expiresAt",
      "id",
      "shopId",
      "tokenHash",
      "userAccountId",
    ]);
    expect(await h.sessions()).toBe(0);
    expect(await hasPendingSignIn(h.db, h.pending.handle)).toBe(true);
  });
  it("opens one provider session and consumes both the proof and TOTP step", async () => {
    const h = await fixture();
    expect((await h.finish()).status).toBe("signed_in");
    expect(await h.rows()).toEqual([]);
    expect((await h.finish()).status).toBe("restart");
    const next = await h.start();
    if (next.status !== "pending") throw new Error("pending missing");
    expect((await h.finish(totpCode(h.enrollment.secret), next.handle)).status).toBe(
      "invalid_code",
    );
    expect(await h.sessions()).toBe(1);
  });
  it("accepts a recovery code once", async () => {
    const h = await fixture();
    const code = h.enrollment.recoveryCodes[0];
    expect((await h.finish(code)).status).toBe("signed_in");
    const next = await h.start();
    if (next.status !== "pending") throw new Error("pending missing");
    expect((await h.finish(code, next.handle)).status).toBe("invalid_code");
    expect(await h.sessions()).toBe(1);
  });

  it("never swaps the cookie's account for another account's recovery code", async () => {
    const h = await fixture();
    const [other] = await h.db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.email, DEV_STAFF_LOGINS.captain.email));
    const second = await beginTotpEnrollment(h.db, other.id);
    if (!second) throw new Error("enrollment unavailable");
    await enableTotp(h.db, other.id, totpCode(second.secret));
    expect((await h.finish(second.recoveryCodes[0])).status).toBe("invalid_code");
    expect(await h.sessions()).toBe(0);
    expect((await h.finish(h.enrollment.recoveryCodes[0])).status).toBe("signed_in");
  });
  it("spends five malformed or wrong attempts without extending expiry", async () => {
    const h = await fixture();
    const expiry = (await h.rows())[0].expiresAt;
    for (let i = 1; i < 5; i++) {
      expect((await h.finish(i === 1 ? "" : "malformed!")).status).toBe("invalid_code");
      expect((await h.rows())[0]).toMatchObject({ attemptsRemaining: 5 - i, expiresAt: expiry });
    }
    expect((await h.finish("000000")).status).toBe("restart");
    expect(await h.rows()).toEqual([]);
    expect(await h.sessions()).toBe(0);
  });
  it("refuses missing, tampered and expired handles", async () => {
    const h = await fixture();
    expect((await h.finish("123456", null)).status).toBe("restart");
    expect((await h.finish("123456", "A".repeat(43))).status).toBe("restart");
    advanceClock(300_000);
    expect(await hasPendingSignIn(h.db, h.pending.handle)).toBe(false);
    expect((await h.finish()).status).toBe("restart");
    expect(await h.rows()).toEqual([]);
  });
  it("Back and restart revoke the previous browser proof", async () => {
    const h = await fixture();
    const next = await h.start(h.pending.handle);
    expect((await h.finish()).status).toBe("restart");
    if (next.status !== "pending") throw new Error("pending missing");
    await cancelPendingSignIn(h.db, next.handle);
    expect((await h.finish("123456", next.handle)).status).toBe("restart");
    expect(await h.sessions()).toBe(0);
  });
  it.each(["password", "factor", "sign-out-everywhere", "disabled", "deleted", "erased"])(
    "refuses a proof after %s invalidation",
    async (change) => {
      const h = await fixture();
      if (change === "password")
        await setAccountPassword(h.db, h.account.id, await hashPassword("new-password"));
      if (change === "factor") await disableTotp(h.db, h.account.id);
      if (change === "sign-out-everywhere") await revokeAllAccountSessions(h.db, h.account.id);
      if (change === "disabled")
        await h.db
          .update(userAccounts)
          .set({ status: "disabled" })
          .where(eq(userAccounts.id, h.account.id));
      if (change === "deleted")
        await h.db
          .update(people)
          .set({ deletedAt: (await h.rows())[0].createdAt })
          .where(eq(people.id, h.account.personId));
      if (change === "erased")
        await h.db
          .update(people)
          .set({
            anonymizedAt: (await h.rows())[0].createdAt,
            deletedAt: (await h.rows())[0].createdAt,
          })
          .where(eq(people.id, h.account.personId));
      expect((await h.finish()).status).toBe("restart");
      expect(await h.sessions()).toBe(0);
    },
  );
  it.each(["disable", "remove"])(
    "the staff %s writer deletes pending proof in its transaction",
    async (kind) => {
      const h = await fixture(DEV_STAFF_LOGINS.captain);
      const input = {
        shopId: ctx.shop.id,
        personId: h.account.personId,
        userAccountId: h.account.id,
      };
      const result =
        kind === "disable"
          ? await setStaffAccountStatus(h.db, { ...input, status: "disabled" })
          : await removeStaffMember(h.db, input);
      expect(result.ok).toBe(true);
      expect(await h.rows()).toEqual([]);
      expect((await h.finish()).status).toBe("restart");
    },
  );

  it("person erasure destroys the account's pending credential machinery", async () => {
    const h = await fixture(DEV_STAFF_LOGINS.captain);
    const [owner] = await h.db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.email, DEV_STAFF_LOGINS.owner.email));
    await h.db.delete(personRoles).where(eq(personRoles.personId, h.account.personId));
    await h.db
      .update(people)
      .set({ deletedAt: (await h.rows())[0].createdAt })
      .where(eq(people.id, h.account.personId));
    expect(
      (
        await anonymizeDiver(h.db, {
          shopId: ctx.shop.id,
          personId: h.account.personId,
          actorPersonId: owner.personId,
        })
      ).ok,
    ).toBe(true);
    expect(await h.rows()).toEqual([]);
    expect((await h.finish()).status).toBe("restart");
  });

  it("rolls back challenge consumption, recovery consumption and provider session on failure", async () => {
    const h = await fixture();
    const fail = new Error("session user lookup failed");
    await expect(
      completePendingSignIn(
        h.db,
        h.pending.handle,
        h.enrollment.recoveryCodes[0],
        async () => true,
        async (tx, user) => {
          await persist(tx, user);
          throw fail;
        },
      ),
    ).rejects.toBe(fail);
    expect((await h.rows())[0].attemptsRemaining).toBe(5);
    expect(await h.sessions()).toBe(0);
    expect((await h.finish(h.enrollment.recoveryCodes[0])).status).toBe("signed_in");
  });
  it("does not spend a challenge attempt when the account budget refuses", async () => {
    const h = await fixture();
    expect(
      (await completePendingSignIn(h.db, h.pending.handle, "123456", async () => false, persist))
        .status,
    ).toBe("rate_limited");
    expect((await h.rows())[0].attemptsRemaining).toBe(5);
    expect(await h.sessions()).toBe(0);
  });
});
