import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { computerDives, people, personRoles, userAccounts } from "@/db/schema";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  commitComputerFiles,
  exportComputerDiveSummaryCsv,
  exportComputerDives,
  previewComputerFiles,
} from "./store";
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
  it("serializes mapped archive retries and deduplicates extracted calendar-only rows", async () => {
    const pg = await postgresTestDb();
    const scope = await computerFixture(pg.db);
    const raw = strToU8("Date,Minutes,Feet\n01/11/2026,45,60\n01/11/2026,45,60\n");
    const files = [{ name: "logbook.zip", bytes: zipSync({ "logbook.csv": raw }) }];
    const options = {
      provider: "padi" as const,
      csvMapping: {
        columns: { date: "Date", duration: "Minutes", maxDepth: "Feet" },
        dateFormat: "dmy" as const,
        durationUnit: "minutes" as const,
        depthUnit: "ft" as const,
      },
    };
    const preview = await previewComputerFiles(pg.db, scope, files, options);
    const input = {
      files,
      options,
      selectedKeys: preview.dives.map((d) => d.key),
      requestKey: randomUUID(),
      confirmedPersonId: scope.personId,
      timeOffsets: Object.fromEntries(preview.dives.map((d) => [d.key, null])),
    };
    const gate = await holdRowLock(
      pg,
      sql`select id from people where id=${scope.personId} for update`,
    );
    const first = commitComputerFiles(pg.connect(), scope, input);
    const second = commitComputerFiles(pg.connect(), scope, input);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    expect(await Promise.all([first, second])).toEqual([
      { imported: 2, skipped: 0 },
      { imported: 2, skipped: 0 },
    ]);
    expect(await pg.db.select().from(computerDives)).toHaveLength(2);
    const extracted = await previewComputerFiles(
      pg.db,
      scope,
      [{ name: "logbook.csv", bytes: raw }],
      options,
    );
    expect(extracted.dives.map((d) => d.duplicate)).toEqual(["exact", "exact"]);
    expect(
      extracted.dives.every((d) => d.record.startInstant === null && d.record.localStart === null),
    ).toBe(true);
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
  it.each([exportComputerDives, exportComputerDiveSummaryCsv])(
    "export %s waits for a held role revocation and refuses the demoted staff member",
    async (exportRecording) => {
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
      const pending = exportRecording(pg.connect(), scope).then(
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
    },
  );
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
