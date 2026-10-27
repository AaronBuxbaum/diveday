import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { withRetiredSavedAnswers } from "./retired-saved-answers";
import { inboxSavedAnswers, people, shops } from "./schema";

describePostgres("retired saved answers during the staged drop", () => {
  it("holds the table through erasure and continues once it has been dropped", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Staged cleanup", slug: "staged-cleanup", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Diver" })
      .returning();
    if (!person) throw new Error("person missing");
    await pg.db.insert(inboxSavedAnswers).values({
      shopId: shop.id,
      sourcePersonId: person.id,
      title: "Answer",
      body: "Private reply",
    });

    let release!: () => void;
    let entered!: () => void;
    const locked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clearing = withRetiredSavedAnswers(pg.connect(), async (tx) => {
      entered();
      await gate;
      const deleted = await tx
        .delete(inboxSavedAnswers)
        .where(eq(inboxSavedAnswers.sourcePersonId, person.id))
        .returning({ id: inboxSavedAnswers.id });
      expect(deleted).toHaveLength(1);
    });
    await Promise.race([
      locked,
      clearing.then(() => {
        throw new Error("clear completed without taking the lock");
      }),
    ]);
    // Drizzle's query is a lazy thenable; start it before checking for a waiter.
    const drop = Promise.resolve(pg.connect().execute(sql`drop table inbox_saved_answers`));
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
    }
    await clearing;
    await drop;

    let called = false;
    await withRetiredSavedAnswers(pg.db, async () => {
      called = true;
    });
    expect(called).toBe(false);
    await pg.db.execute(sql`select 1`);
  });
});
