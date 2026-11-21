import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import type { DbExecutor } from "@/db/client";
import { commitComputerFiles } from "@/features/after-the-dive/computer-dives";
import {
  computerFixture,
  selectedInput,
} from "@/features/after-the-dive/computer-dives/test-support";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { computerDiveProfiles, computerDives, computerImportBatches, people } from "./schema";
import { clearDemoSchedule, deleteDemoShopCascade } from "./seed";

const operations = ["reset", "reap"] as const;
type Operation = (typeof operations)[number];

async function clear(tx: DbExecutor, operation: Operation, shopId: string) {
  if (operation === "reset") await clearDemoSchedule(tx, shopId);
  else await deleteDemoShopCascade(tx, shopId);
}

const profileFile = () => [
  {
    name: "sanitized-si.uddf",
    bytes: new Uint8Array(readFileSync("src/lib/computer-import/fixtures/si.uddf")),
  },
];

async function expectNoGraph(db: DbExecutor, shopId: string) {
  expect(
    await db.select().from(computerDiveProfiles).where(eq(computerDiveProfiles.shopId, shopId)),
  ).toEqual([]);
  expect(await db.select().from(computerDives).where(eq(computerDives.shopId, shopId))).toEqual([]);
  expect(
    await db.select().from(computerImportBatches).where(eq(computerImportBatches.shopId, shopId)),
  ).toEqual([]);
}

describePostgres("computer imports and shop lifecycle ordering", () => {
  it.each(operations)(
    "%s removes an import that reaches its final write first",
    async (operation) => {
      const pg = await postgresTestDb();
      const scope = await computerFixture(pg.db);
      const input = await selectedInput(pg.db, scope, profileFile());
      // The real import transaction pauses after all evidence and result counts
      // have been written. The trigger only controls timing, never row contents.
      await pg.db.execute(sql`create function computer_import_commit_barrier() returns trigger language plpgsql as $$
      begin perform pg_advisory_xact_lock(61931); return new; end
    $$`);
      await pg.db.execute(sql`create trigger computer_import_commit_barrier after update on computer_import_batches
      for each row execute function computer_import_commit_barrier()`);
      const gate = await holdRowLock(pg, sql`select pg_advisory_xact_lock(61931)`);
      const importing = commitComputerFiles(pg.connect(), scope, input).then(
        (result) => ({ result, error: null }),
        (error: unknown) => ({ result: null, error }),
      );
      let clearing: Promise<unknown> | undefined;
      try {
        await waitForLockWaiters(pg.db, 1);
        clearing = pg
          .connect()
          .transaction(async (tx) => clear(tx, operation, scope.shopId))
          .then(
            () => null,
            (error: unknown) => error,
          );
        await waitForLockWaiters(pg.db, 2);
      } finally {
        await gate.release();
      }
      expect(await importing).toEqual({ result: { imported: 1, skipped: 0 }, error: null });
      expect(await clearing).toBeNull();
      await expectNoGraph(pg.db, scope.shopId);
    },
  );

  it.each(operations)(
    "an import waiting behind completed %s refuses the deleted subject",
    async (operation) => {
      const pg = await postgresTestDb();
      const scope = await computerFixture(pg.db);
      const input = await selectedInput(pg.db, scope, profileFile());
      let signalReady!: () => void;
      const ready = new Promise<void>((resolve) => {
        signalReady = resolve;
      });
      let release!: () => void;
      const proceed = new Promise<void>((resolve) => {
        release = resolve;
      });
      const clearing = pg.connect().transaction(async (tx) => {
        await clear(tx, operation, scope.shopId);
        signalReady();
        await proceed;
      });
      let released: Promise<void> | undefined;
      const releaseOnce = () =>
        (released ??= (async () => {
          release();
          await clearing;
        })());
      onTestFinished(releaseOnce);
      // A failed lifecycle operation must surface instead of hanging on ready.
      await Promise.race([ready, clearing]);
      const importing = commitComputerFiles(pg.connect(), scope, input).then(
        () => null,
        (error: unknown) => error,
      );
      try {
        await waitForLockWaiters(pg.db, 1);
      } finally {
        await releaseOnce();
      }
      expect(await importing).toMatchObject({ message: "not_found" });
      expect(await pg.db.select().from(people).where(eq(people.id, scope.personId))).toEqual([]);
      await expectNoGraph(pg.db, scope.shopId);
    },
  );
});
