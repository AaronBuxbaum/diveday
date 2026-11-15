import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { computerDives, people, personRoles, userAccounts } from "@/db/schema";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { commitComputerFiles, exportComputerDives } from "./store";
import { computerFixture, selectedInput } from "./test-support";

describePostgres("computer import commit ordering", () => {
  it("concurrent retries produce one receipt and one personal recording", async () => {
    const pg = await postgresTestDb();
    const scope = await computerFixture(pg.db);
    const input = await selectedInput(pg.db, scope);
    const results = await Promise.all([
      commitComputerFiles(pg.connect(), scope, input),
      commitComputerFiles(pg.connect(), scope, input),
    ]);
    expect(results).toEqual([
      { imported: 1, skipped: 0 },
      { imported: 1, skipped: 0 },
    ]);
    expect(await pg.db.select().from(computerDives)).toHaveLength(1);
  });
  it("rechecks revoked roles while a commit waits on its subject", async () => {
    const pg = await postgresTestDb();
    const scope = await computerFixture(pg.db);
    const input = await selectedInput(pg.db, scope);
    const gate = await holdRowLock(
      pg,
      sql`select id from people where id=${scope.personId} for update`,
    );
    const pending = commitComputerFiles(pg.connect(), scope, input);
    const result = pending.then(
      () => null,
      (e) => e,
    );
    await waitForLockWaiters(pg.db, 1);
    await pg.db.delete(personRoles).where(eq(personRoles.personId, scope.actorPersonId));
    await gate.release();
    expect((await result)?.message).toBe("not_authorized");
    expect(await pg.db.select().from(computerDives)).toHaveLength(0);
  });
  it("a deleted subject while waiting cannot receive imported evidence", async () => {
    const pg = await postgresTestDb();
    const scope = await computerFixture(pg.db);
    const input = await selectedInput(pg.db, scope);
    let locked!: () => void;
    const ready = new Promise<void>((r) => {
      locked = r;
    });
    let release!: () => void;
    const proceed = new Promise<void>((r) => {
      release = r;
    });
    const removal = pg.db.transaction(async (tx) => {
      await tx
        .update(people)
        .set({
          deletedAt: new Date("2026-01-02T00:00:00Z"),
          anonymizedAt: new Date("2026-01-02T00:00:00Z"),
        })
        .where(eq(people.id, scope.personId));
      locked();
      await proceed;
    });
    await ready;
    const pending = commitComputerFiles(pg.connect(), scope, input);
    const result = pending.then(
      () => null,
      (e) => e,
    );
    await waitForLockWaiters(pg.db, 1);
    release();
    await removal;
    expect((await result)?.message).toBe("not_found");
    expect(await pg.db.select().from(computerDives)).toHaveLength(0);
  });
  it("an export waits for a held role revocation and refuses the demoted staff member", async () => {
    const pg = await postgresTestDb();
    const scope = await computerFixture(pg.db);
    let locked!: () => void;
    const ready = new Promise<void>((r) => {
      locked = r;
    });
    let release!: () => void;
    const proceed = new Promise<void>((r) => {
      release = r;
    });
    const revoke = pg.db.transaction(async (tx) => {
      await tx
        .update(personRoles)
        .set({ role: "instructor" })
        .where(eq(personRoles.personId, scope.actorPersonId));
      locked();
      await proceed;
    });
    await ready;
    const pending = exportComputerDives(pg.connect(), scope).then(
      () => null,
      (e) => e,
    );
    try {
      await waitForLockWaiters(pg.db, 1, 1000);
    } finally {
      release();
    }
    await revoke;
    expect((await pending)?.message).toBe("not_authorized");
  });
  it("uses the account then person lock order of staff removal without deadlock", async () => {
    const pg = await postgresTestDb();
    const scope = await computerFixture(pg.db);
    const input = await selectedInput(pg.db, scope);
    let locked!: () => void;
    const ready = new Promise<void>((r) => {
      locked = r;
    });
    let release!: () => void;
    const proceed = new Promise<void>((r) => {
      release = r;
    });
    const removal = pg.db.transaction(async (tx) => {
      await tx
        .select()
        .from(userAccounts)
        .where(eq(userAccounts.personId, scope.actorPersonId))
        .for("update");
      locked();
      await proceed;
      await tx
        .update(people)
        .set({ deletedAt: new Date("2026-01-02T00:00:00Z") })
        .where(eq(people.id, scope.actorPersonId));
    });
    await ready;
    const pending = commitComputerFiles(pg.connect(), scope, input).then(
      () => null,
      (e) => e,
    );
    await waitForLockWaiters(pg.db, 1);
    release();
    await expect(removal).resolves.toBeUndefined();
    expect((await pending)?.message).toBe("not_authorized");
    expect(await pg.db.select().from(computerDives)).toHaveLength(0);
  });
});
