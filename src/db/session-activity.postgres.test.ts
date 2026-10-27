import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { STAFF_IDLE_LIMIT_MS } from "@/lib/session-idle";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { accountSessions, people, shops, userAccounts } from "./schema";
import { touchStaffSession } from "./session-activity";

describePostgres("staff session activity under row contention", () => {
  it("cannot renew when the deadline passes while a request waits for the row", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Session race", slug: "session-race", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Owner" })
      .returning();
    if (!person) throw new Error("person missing");
    const [account] = await pg.db
      .insert(userAccounts)
      .values({ personId: person.id, email: "owner@example.test" })
      .returning();
    if (!account) throw new Error("account missing");
    const at = new Date("2026-10-27T10:00:00Z");
    const [session] = await pg.db
      .insert(accountSessions)
      .values({
        userAccountId: account.id,
        personId: person.id,
        shopId: shop.id,
        shopSlug: shop.slug,
        token: crypto.randomUUID(),
        roles: ["owner"],
        name: "Owner",
        expiresAt: new Date(at.getTime() + 2 * STAFF_IDLE_LIMIT_MS),
        lastHumanActivityAt: at,
      })
      .returning();
    if (!session) throw new Error("session missing");
    const gate = await holdRowLock(
      pg,
      sql`select id from account_sessions where id = ${session.id} for update`,
    );
    let clock = new Date(at.getTime() + STAFF_IDLE_LIMIT_MS - 1);
    const attempt = touchStaffSession(
      pg.connect(),
      {
        sessionId: session.id,
        userAccountId: account.id,
        personId: person.id,
        shopId: shop.id,
      },
      () => clock,
    );
    try {
      await waitForLockWaiters(pg.db, 1);
      clock = new Date(at.getTime() + STAFF_IDLE_LIMIT_MS);
    } finally {
      await gate.release();
    }
    expect(await attempt).toBe(false);
    const [after] = await pg.db
      .select()
      .from(accountSessions)
      .where(eq(accountSessions.id, session.id));
    expect(after?.lastHumanActivityAt).toEqual(at);
  });
});
