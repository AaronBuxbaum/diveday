import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { consumeAccountToken, issueAccountToken } from "./account-tokens";
import type { AppDb } from "./client";
import { accountTokens, people, shops, userAccounts } from "./schema";

/**
 * One-time account tokens under genuine contention (A§4 item 8).
 *
 * A reset or invite link spent twice is two sessions' worth of trust from one
 * email. `consumeAccountToken` is a single conditional `UPDATE … WHERE
 * used_at IS NULL`: under READ COMMITTED a second updater blocked on the row
 * re-reads it once the first commits, finds `used_at` set, and matches
 * nothing. PGlite never blocks, so this is the one place that is exercised.
 *
 * `issueAccountToken` locks the account row so two simultaneous requests
 * cannot both find nothing outstanding and both insert, leaving two live
 * links where the rule is one.
 *
 * Each test asserts the outcome (one consumer, one live token), never who won;
 * the gate only makes the contenders simultaneous (docs/engineering/testing.md,
 * "Reading a race test correctly"). Removing `isNull(accountTokens.usedAt)`
 * from the consume makes both taps succeed; removing the account-row lock
 * from the issue leaves more than one live token.
 */

async function account(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({ name: `Tokens ${suffix}`, slug: `tokens-${suffix}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const email = `tokens-${suffix}@example.com`;
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Token Holder", email })
    .returning();
  if (!person) throw new Error("person insert returned no row");
  const [row] = await db
    .insert(userAccounts)
    .values({ personId: person.id, email, hashedPassword: "x", status: "active" })
    .returning();
  if (!row) throw new Error("account insert returned no row");
  return row.id;
}

describePostgres("account tokens under real concurrency", () => {
  it.each(["password_reset", "invite"] as const)(
    "lets exactly one of two simultaneous taps spend one %s token",
    async (purpose) => {
      const pg = await postgresTestDb();
      const userAccountId = await account(pg.db);
      const issued = await issueAccountToken(pg.db, { userAccountId, purpose });

      const gate = await holdRowLock(
        pg,
        sql`select id from account_tokens where id = ${issued.tokenId} for update`,
      );
      const taps = [0, 1].map(() =>
        consumeAccountToken(pg.connect(), { token: issued.token, purpose }),
      );
      await waitForLockWaiters(pg.db, 2);
      await gate.release();
      const outcomes = await Promise.all(taps);

      expect(outcomes.filter((outcome) => outcome !== null)).toEqual([{ userAccountId }]);
    },
  );

  it("leaves one live reset link when two are requested at once", async () => {
    const pg = await postgresTestDb();
    const userAccountId = await account(pg.db);

    const gate = await holdRowLock(
      pg,
      sql`select id from user_accounts where id = ${userAccountId} for update`,
    );
    const requests = [0, 1].map(() =>
      issueAccountToken(pg.connect(), { userAccountId, purpose: "password_reset" }),
    );
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    await Promise.all(requests);

    const live = await pg.db
      .select({ id: accountTokens.id })
      .from(accountTokens)
      .where(
        and(
          eq(accountTokens.userAccountId, userAccountId),
          isNull(accountTokens.usedAt),
          isNull(accountTokens.supersededAt),
        ),
      );
    expect(live).toHaveLength(1);
  });
});
