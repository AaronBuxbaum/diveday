import { eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { accountSessions, trips, userAccounts } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { listRetainedSafetyReviewEntries } from "./recovery";

vi.mock("./review-availability", () => ({ unresolvedReviewAvailable: () => true }));
describePostgres("retained review session ordering", () => {
  it("holds a live session through the page read and refuses a later read after revocation", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    const staffPersonId = await seededStaffPersonId(pg.db, shop.id, SEEDED_OWNER_EMAIL);
    const [account] = await pg.db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.personId, staffPersonId));
    if (!trip || !account) throw new Error("fixture missing");
    const [session] = await pg.db
      .insert(accountSessions)
      .values({
        userAccountId: account.id,
        personId: staffPersonId,
        shopId: shop.id,
        shopSlug: shop.slug,
        roles: ["owner"],
        name: "Staff",
        token: crypto.randomUUID(),
        expiresAt: new Date(nowDate().getTime() + 60_000),
      })
      .returning({ id: accountSessions.id });
    const input = { shopId: shop.id, staffPersonId, sessionId: session.id, tripId: trip.id };
    const gate = await holdRowLock(
      pg,
      sql`select id from ${trips} where id = ${trip.id} for update`,
    );
    const read = listRetainedSafetyReviewEntries(pg.connect(), input);
    let revoked = false;
    let revoke: Promise<unknown> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      revoke = pg
        .connect()
        .delete(accountSessions)
        .where(eq(accountSessions.id, session.id))
        .then(() => {
          revoked = true;
        });
      await waitForLockWaiters(pg.db, 2);
      expect(revoked).toBe(false);
    } finally {
      await gate.release();
    }
    expect(await read).toMatchObject({ ok: true });
    await revoke;
    expect(revoked).toBe(true);
    expect(await listRetainedSafetyReviewEntries(pg.db, input)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
