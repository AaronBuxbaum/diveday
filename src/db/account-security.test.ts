import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { recoveryCodeHashes } from "@/lib/totp";
import { seededShopContext } from "@/test/db";
import { getAccountSecurity, verifyAccountSecondFactor } from "./account-security";
import { accountSecurity, userAccounts } from "./schema";

describe("account-security recovery codes", () => {
  it("allows a recovery code to be consumed only once", async () => {
    const { db } = await seededShopContext();
    const [account] = await db.select({ id: userAccounts.id }).from(userAccounts).limit(1);
    if (!account) throw new Error("seeded account missing");
    const code = "ABCD234567";
    await db.insert(accountSecurity).values({
      userAccountId: account.id,
      totpEnabledAt: nowDate(),
      recoveryCodeHashes: recoveryCodeHashes([code]),
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
});
