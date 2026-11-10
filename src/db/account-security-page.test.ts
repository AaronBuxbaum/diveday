import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getAccountSecurityPage } from "./account-security";
import { userAccounts } from "./schema";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("getAccountSecurityPage", () => {
  it("reads the account's security, sessions and secret for a person with an account", async () => {
    const { db } = ctx;
    const [account] = await db
      .select({ id: userAccounts.id, personId: userAccounts.personId })
      .from(userAccounts)
      .limit(1);
    if (!account?.personId) throw new Error("setup: no seeded account");
    const page = await getAccountSecurityPage(db, account.personId, ctx.shop.id);
    expect(page?.accountId).toBe(account.id);
    expect(Array.isArray(page?.sessions)).toBe(true);
  });

  it("is null for a person with no account", async () => {
    expect(await getAccountSecurityPage(ctx.db, randomUUID(), ctx.shop.id)).toBeNull();
  });
});
