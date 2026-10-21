import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { secretKeyFromEnvironment } from "@/lib/secret-box";
import { recoveryCodeHashes, TOTP_STEP_SECONDS, totpCode } from "@/lib/totp";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  beginTotpEnrollment,
  enableTotp,
  getAccountSecurity,
  verifyAccountSecondFactor,
} from "./account-security";
import { accountSecurity, people, shops, userAccounts } from "./schema";

async function fixture() {
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Security contention", slug: "security-contention", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop missing");
  const [person] = await pg.db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Security owner" })
    .returning();
  if (!person) throw new Error("person missing");
  const [account] = await pg.db
    .insert(userAccounts)
    .values({ personId: person.id, email: "security@example.com" })
    .returning();
  if (!account) throw new Error("account missing");
  return { pg, id: account.id };
}

// The gate forces every independent backend to reach its UPDATE before any commits.
// Waiting proves contention; accepted results and stored state prove the CAS guards.
describePostgres("second-factor consumption across independent sessions", () => {
  it.each([2, 5])("accepts one recovery code once among %i sign-ins", async (count) => {
    const { pg, id } = await fixture();
    const key = secretKeyFromEnvironment();
    if (key.status !== "ok") throw new Error("test sealing key missing");
    const code = "ABCD234567";
    await pg.db.insert(accountSecurity).values({
      userAccountId: id,
      totpEnabledAt: nowDate(),
      recoveryCodeHashes: recoveryCodeHashes([code], key.key.current, id),
    });
    const gate = await holdRowLock(
      pg,
      sql`select user_account_id from account_security where user_account_id = ${id} for update`,
    );
    const attempts = Array.from({ length: count }, () =>
      verifyAccountSecondFactor(pg.connect(), id, code),
    );
    try {
      await waitForLockWaiters(pg.db, count);
    } finally {
      await gate.release();
    }
    expect((await Promise.all(attempts)).filter(Boolean)).toHaveLength(1);
    expect((await getAccountSecurity(pg.db, id))?.recoveryCodeHashes).toEqual([]);
    expect(await verifyAccountSecondFactor(pg.connect(), id, code)).toBe(false);
  });

  it("consumes different recovery codes without resurrecting either", async () => {
    const { pg, id } = await fixture();
    const key = secretKeyFromEnvironment();
    if (key.status !== "ok") throw new Error("test sealing key missing");
    const codes = ["ABCD234567", "WXYZ234567"];
    await pg.db.insert(accountSecurity).values({
      userAccountId: id,
      totpEnabledAt: nowDate(),
      recoveryCodeHashes: recoveryCodeHashes(codes, key.key.current, id),
    });
    const gate = await holdRowLock(
      pg,
      sql`select user_account_id from account_security where user_account_id = ${id} for update`,
    );
    const attempts = codes.map((code) => verifyAccountSecondFactor(pg.connect(), id, code));
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await Promise.all(attempts)).toEqual([true, true]);
    expect((await getAccountSecurity(pg.db, id))?.recoveryCodeHashes).toEqual([]);
    for (const code of codes)
      expect(await verifyAccountSecondFactor(pg.connect(), id, code)).toBe(false);
  });

  it("accepts a TOTP step once across simultaneous sign-ins", async () => {
    const { pg, id } = await fixture();
    const enrolled = await beginTotpEnrollment(pg.db, id);
    if (!enrolled) throw new Error("test sealing key missing");
    const code = totpCode(enrolled.secret);
    expect(await enableTotp(pg.db, id, code)).toBe(true);
    await pg.db
      .update(accountSecurity)
      .set({ lastTotpStep: null })
      .where(eq(accountSecurity.userAccountId, id));
    const gate = await holdRowLock(
      pg,
      sql`select user_account_id from account_security where user_account_id = ${id} for update`,
    );
    const attempts = Array.from({ length: 2 }, () =>
      verifyAccountSecondFactor(pg.connect(), id, code),
    );
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect((await Promise.all(attempts)).filter(Boolean)).toHaveLength(1);
    expect((await getAccountSecurity(pg.db, id))?.lastTotpStep).toBe(
      Math.floor(nowMs() / (TOTP_STEP_SECONDS * 1000)),
    );
    expect(await verifyAccountSecondFactor(pg.connect(), id, code)).toBe(false);
  });
});
