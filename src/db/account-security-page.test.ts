import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MINUTE_MS, nowMs } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { getAccountSecurityPage, grantStepUp } from "./account-security";
import { accountSessions, userAccounts } from "./schema";

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

  it("shows factor-management proof only for this session's unexpired security grant", async () => {
    const { db, shop } = ctx;
    const [account] = await db.select().from(userAccounts).limit(1);
    if (!account) throw new Error("setup: no seeded account");
    const sessions = await db
      .insert(accountSessions)
      .values(
        ["this browser", "another browser"].map((name) => ({
          userAccountId: account.id,
          personId: account.personId,
          shopId: shop.id,
          shopSlug: shop.slug,
          roles: ["owner"],
          name,
          token: randomUUID(),
          expiresAt: new Date(nowMs() + 60 * MINUTE_MS),
        })),
      )
      .returning({ id: accountSessions.id });
    const [current, other] = sessions;
    if (!current || !other) throw new Error("setup: missing browser sessions");
    const read = (sessionId?: string) =>
      getAccountSecurityPage(db, account.personId, shop.id, sessionId);
    const binding = { userAccountId: account.id, accountSessionId: current.id };

    await grantStepUp(db, { ...binding, purpose: "money" });
    expect((await read(current.id))?.factorManagementVerified).toBe(false);
    const grant = await grantStepUp(db, { ...binding, purpose: "security" });
    expect(grant).not.toBeNull();
    expect(grant && grant.expiresAt.getTime() - grant.verifiedAt.getTime()).toBe(5 * MINUTE_MS);
    expect((await read(current.id))?.factorManagementVerified).toBe(true);
    expect((await read(other.id))?.factorManagementVerified).toBe(false);
    expect((await read())?.factorManagementVerified).toBe(false);

    advanceClock(5 * MINUTE_MS);
    expect((await read(current.id))?.factorManagementVerified).toBe(false);
  });
});
