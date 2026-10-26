import { count, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createAuth } from "@/lib/auth";
import { nowDate, nowMs } from "@/lib/clock";
import type { VerifiedUser } from "@/lib/credentials";
import { hashPassword } from "@/lib/password-hashing";
import { createPendingHandle, hashPendingHandle } from "@/lib/pending-sign-in";
import { totpCode } from "@/lib/totp";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { beginTotpEnrollment, disableTotp, enableTotp } from "./account-security";
import type { AppDb, AppTransaction } from "./client";
import {
  accountSecurity,
  accountSessions,
  accountSignInChallenges,
  people,
  personRoles,
  shops,
  userAccounts,
} from "./schema";
import { completePendingSignIn, startCredentialSignIn } from "./sign-in-challenges";
import { setStaffAccountStatus } from "./staff-accounts";
import { setAccountPassword } from "./user-accounts";

async function persist(tx: AppTransaction, verified: VerifiedUser) {
  const context = await createAuth(tx).$context;
  const session = await context.internalAdapter.createSession(verified.id, false, verified);
  if (!session || !(await context.internalAdapter.findUserById(verified.id)))
    throw new Error("provider failed");
  return session;
}

async function fixture() {
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Challenge contention", slug: "challenge-contention", timezone: "UTC" })
    .returning();
  const [person] = await pg.db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Challenge staff" })
    .returning();
  const [account] = await pg.db
    .insert(userAccounts)
    .values({
      personId: person.id,
      email: "challenge@example.com",
      hashedPassword: await hashPassword("correct-password"),
    })
    .returning();
  await pg.db.insert(personRoles).values({ personId: person.id, role: "owner" });
  const enrollment = await beginTotpEnrollment(pg.db, account.id);
  if (!enrollment) throw new Error("enrollment unavailable");
  await enableTotp(pg.db, account.id, totpCode(enrollment.secret));
  await pg.db
    .update(accountSecurity)
    .set({ lastTotpStep: null })
    .where(eq(accountSecurity.userAccountId, account.id));
  const issue = async () => {
    const handle = createPendingHandle();
    await pg.db.insert(accountSignInChallenges).values({
      shopId: shop.id,
      userAccountId: account.id,
      tokenHash: hashPendingHandle(handle),
      expiresAt: new Date(nowMs() + 300_000),
    });
    return handle;
  };
  const finish = (handle: string, code = totpCode(enrollment.secret)) =>
    completePendingSignIn(pg.connect(), handle, code, async () => true, persist);
  const sessions = async () => (await pg.db.select({ n: count() }).from(accountSessions))[0].n;
  const gate = () =>
    holdRowLock(pg, sql`select id from user_accounts where id = ${account.id} for update`);
  return { pg, person, account, enrollment, issue, finish, sessions, gate };
}

describePostgres("pending sign-in across independent Postgres backends", () => {
  it("rejects a wrong password without acquiring a known account lock", async () => {
    const h = await fixture();
    const gate = await h.gate();
    try {
      expect(
        (
          await startCredentialSignIn(
            h.pg.connect(),
            { email: h.account.email, password: "wrong-password", previousHandle: null },
            persist,
          )
        ).status,
      ).toBe("invalid");
    } finally {
      await gate.release();
    }
    expect(await h.sessions()).toBe(0);
  });

  it("rejects a cross-tenant account id without trying to lock that account", async () => {
    const h = await fixture();
    const [otherShop] = await h.pg.db
      .insert(shops)
      .values({ name: "Other shop", slug: "other-shop", timezone: "UTC" })
      .returning();
    const [otherPerson] = await h.pg.db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Other staff" })
      .returning();
    const gate = await h.gate();
    try {
      const answer = await h.pg.connect().transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '25ms'`);
        return setStaffAccountStatus(tx as unknown as AppDb, {
          shopId: otherShop.id,
          personId: otherPerson.id,
          userAccountId: h.account.id,
          status: "disabled",
        });
      });
      expect(answer).toEqual({ ok: false, reason: "not_found" });
    } finally {
      await gate.release();
    }
  });

  it("rejects a password changed after its successful comparison but before the issuance lock", async () => {
    const h = await fixture();
    const gate = await h.gate();
    const passwordChange = setAccountPassword(
      h.pg.connect(),
      h.account.id,
      await hashPassword("new-password"),
    );
    try {
      await waitForLockWaiters(h.pg.db, 1);
      const issuance = startCredentialSignIn(
        h.pg.connect(),
        { email: h.account.email, password: "correct-password", previousHandle: null },
        persist,
      );
      await waitForLockWaiters(h.pg.db, 2);
      await gate.release();
      await passwordChange;
      expect((await issuance).status).toBe("invalid");
    } finally {
      await gate.release();
    }
    expect(await h.pg.db.select().from(accountSignInChallenges)).toEqual([]);
    expect(await h.sessions()).toBe(0);
  });

  it("rechecks current demo eligibility after the issuance lock", async () => {
    const h = await fixture();
    const email = "staff@challenge.demo.invalid";
    await h.pg.db.update(userAccounts).set({ email }).where(eq(userAccounts.id, h.account.id));
    await h.pg.db.update(shops).set({ isDemo: true }).where(eq(shops.id, h.person.shopId));
    const gate = await h.gate();
    const issuance = startCredentialSignIn(
      h.pg.connect(),
      { email, password: "password", previousHandle: null },
      persist,
    );
    try {
      await waitForLockWaiters(h.pg.db, 1);
      await h.pg.db.update(shops).set({ isDemo: false }).where(eq(shops.id, h.person.shopId));
      await gate.release();
      expect((await issuance).status).toBe("invalid");
    } finally {
      await gate.release();
    }
    expect(await h.pg.db.select().from(accountSignInChallenges)).toEqual([]);
    expect(await h.sessions()).toBe(0);
  });

  it.each(["totp", "recovery"])(
    "creates exactly one session from five parallel %s submissions",
    async (factor) => {
      const h = await fixture();
      const handle = await h.issue();
      const code =
        factor === "recovery" ? h.enrollment.recoveryCodes[0] : totpCode(h.enrollment.secret);
      const gate = await h.gate();
      const attempts = Array.from({ length: 5 }, () => h.finish(handle, code));
      try {
        await waitForLockWaiters(h.pg.db, 5);
      } finally {
        await gate.release();
      }
      expect((await Promise.all(attempts)).filter((r) => r.status === "signed_in")).toHaveLength(1);
      expect(await h.sessions()).toBe(1);
      expect(await h.pg.db.select().from(accountSignInChallenges)).toEqual([]);
    },
  );

  it("does not reuse a TOTP step across two independently issued challenges", async () => {
    const h = await fixture();
    const handles = await Promise.all([h.issue(), h.issue()]);
    const gate = await h.gate();
    const attempts = handles.map((handle) => h.finish(handle));
    try {
      await waitForLockWaiters(h.pg.db, 2);
    } finally {
      await gate.release();
    }
    expect((await Promise.all(attempts)).filter((r) => r.status === "signed_in")).toHaveLength(1);
    expect(await h.sessions()).toBe(1);
  });

  it("consumes different recovery codes without resurrecting either", async () => {
    const h = await fixture();
    const handles = await Promise.all([h.issue(), h.issue()]);
    const gate = await h.gate();
    const attempts = handles.map((handle, i) => h.finish(handle, h.enrollment.recoveryCodes[i]));
    try {
      await waitForLockWaiters(h.pg.db, 2);
    } finally {
      await gate.release();
    }
    expect((await Promise.all(attempts)).every((r) => r.status === "signed_in")).toBe(true);
    expect(await h.sessions()).toBe(2);
    const [security] = await h.pg.db
      .select()
      .from(accountSecurity)
      .where(eq(accountSecurity.userAccountId, h.account.id));
    expect(security.recoveryCodeHashes).toHaveLength(8);
  });

  it.each(["password", "factor", "disabled", "deleted"])(
    "refuses completion serialized after %s invalidation",
    async (kind) => {
      const h = await fixture();
      const handle = await h.issue();
      const gate = await h.gate();
      const mutation =
        kind === "password"
          ? setAccountPassword(h.pg.connect(), h.account.id, "changed")
          : kind === "factor"
            ? disableTotp(h.pg.connect(), h.account.id)
            : h.pg.connect().transaction(async (tx) => {
                await tx
                  .select()
                  .from(userAccounts)
                  .where(eq(userAccounts.id, h.account.id))
                  .for("update");
                if (kind === "disabled")
                  await tx
                    .update(userAccounts)
                    .set({ status: "disabled" })
                    .where(eq(userAccounts.id, h.account.id));
                else
                  await tx
                    .update(people)
                    .set({ deletedAt: nowDate() })
                    .where(eq(people.id, h.person.id));
              });
      try {
        await waitForLockWaiters(h.pg.db, 1);
        const completion = h.finish(handle);
        await waitForLockWaiters(h.pg.db, 2);
        await gate.release();
        await mutation;
        expect((await completion).status).toBe("restart");
      } finally {
        await gate.release();
      }
      expect(await h.sessions()).toBe(0);
    },
  );

  it("rolls back provider persistence and factor/challenge consumption together", async () => {
    const h = await fixture();
    const handle = await h.issue();
    const failure = new Error("post-session failure");
    await expect(
      completePendingSignIn(
        h.pg.connect(),
        handle,
        h.enrollment.recoveryCodes[0],
        async () => true,
        async (tx, verified) => {
          await persist(tx, verified);
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    expect(await h.sessions()).toBe(0);
    expect((await h.finish(handle, h.enrollment.recoveryCodes[0])).status).toBe("signed_in");
  });
});
