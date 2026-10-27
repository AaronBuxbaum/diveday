import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { STAFF_IDLE_LIMIT_MS } from "@/lib/session-idle";
import { fileScopedShopContext } from "@/test/db";
import { accountSessions, people, userAccounts } from "./schema";
import { touchStaffSession } from "./session-activity";

const ctx = fileScopedShopContext();

async function fixture() {
  const { db, shop } = ctx;
  const [account] = await db
    .select({ accountId: userAccounts.id, personId: people.id })
    .from(userAccounts)
    .innerJoin(people, eq(people.id, userAccounts.personId))
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!account) throw new Error("seeded account missing");
  const now = nowDate();
  const [session] = await db
    .insert(accountSessions)
    .values({
      userAccountId: account.accountId,
      token: crypto.randomUUID(),
      expiresAt: new Date(now.getTime() + STAFF_IDLE_LIMIT_MS),
      personId: account.personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      roles: ["owner"],
      name: "Staff",
      lastHumanActivityAt: new Date(now.getTime() - 1000),
    })
    .returning();
  if (!session) throw new Error("session missing");
  return { db, shop, account, session, now };
}

describe("server-recorded staff activity", () => {
  it("updates only the active matching session and never a different tenant or account", async () => {
    const { db, shop, account, session, now } = await fixture();
    const key = {
      sessionId: session.id,
      userAccountId: account.accountId,
      personId: account.personId,
      shopId: shop.id,
    };
    expect(await touchStaffSession(db, { ...key, shopId: crypto.randomUUID() }, () => now)).toBe(
      false,
    );
    expect(
      await touchStaffSession(db, { ...key, userAccountId: crypto.randomUUID() }, () => now),
    ).toBe(false);
    expect(await touchStaffSession(db, key, () => now)).toBe(true);
    const [row] = await db.select().from(accountSessions).where(eq(accountSessions.id, session.id));
    expect(row?.lastHumanActivityAt).toEqual(now);
  });

  it("cannot revive a session at the idle boundary or after revocation", async () => {
    const { db, shop, account, session, now } = await fixture();
    const key = {
      sessionId: session.id,
      userAccountId: account.accountId,
      personId: account.personId,
      shopId: shop.id,
    };
    await db
      .update(accountSessions)
      .set({ lastHumanActivityAt: new Date(now.getTime() - STAFF_IDLE_LIMIT_MS) })
      .where(eq(accountSessions.id, session.id));
    expect(await touchStaffSession(db, key, () => now)).toBe(false);
    await db.delete(accountSessions).where(eq(accountSessions.id, session.id));
    expect(await touchStaffSession(db, key, () => now)).toBe(false);
  });
});
