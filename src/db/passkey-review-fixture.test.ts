import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { resolveFacts } from "@/test/shop-facts";
import { pinStaffSessionsSeenNow } from "@/test/shop-facts/settings-states";
import { accountSessions, people, userAccounts } from "./schema";

const ctx = fileScopedShopContext();
describe("passkey review's deterministic session display", () => {
  it("is a private-shop fixture", () => {
    const resolved = resolveFacts(["staffSessionsSeenNow"]);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.facts[0].privateOnly).toBe(true);
  });
  it("changes only display last-seen in the named shop, preserving validity and idle state", async () => {
    const { db, shop } = ctx;
    const [account] = await db
      .select({ id: userAccounts.id, personId: people.id })
      .from(userAccounts)
      .innerJoin(people, eq(people.id, userAccounts.personId))
      .where(eq(people.shopId, shop.id))
      .limit(1);
    const [before] = await db
      .insert(accountSessions)
      .values({
        userAccountId: account.id,
        personId: account.personId,
        shopId: shop.id,
        shopSlug: shop.slug,
        roles: ["owner"],
        name: "Staff",
        token: randomUUID(),
        expiresAt: new Date(nowMs() + 86400000),
        updatedAt: new Date(nowMs() + 60000),
      })
      .returning();
    await pinStaffSessionsSeenNow(db, { id: randomUUID() }, nowDate());
    expect(
      (await db.select().from(accountSessions).where(eq(accountSessions.id, before.id)))[0],
    ).toEqual(before);
    await pinStaffSessionsSeenNow(db, shop, nowDate());
    expect(
      (await db.select().from(accountSessions).where(eq(accountSessions.id, before.id)))[0],
    ).toEqual({ ...before, updatedAt: nowDate() });
  });
});
