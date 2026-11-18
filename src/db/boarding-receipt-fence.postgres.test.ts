import { sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  lockBoardingCertificationEvidence,
  tryLockBoardingEvidenceForReceipt,
} from "./boarding-certification-snapshot";

// This tests one lock primitive only; no receipt, reset, authorization, or
// device-retention contract is implemented or enabled by it.
describePostgres("nonblocking receipt evidence fence", () => {
  const shop = "shop-for-receipt-fence";

  it("refuses without waiting while the existing rewrite fence is held", async () => {
    const pg = await postgresTestDb();
    const held = await holdRowLock(
      pg,
      sql`select pg_advisory_xact_lock(
      hashtext('boarding_certification_evidence'), hashtext(${shop}))`,
    );
    const acquired = await pg.connect().transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '1s'`);
      return tryLockBoardingEvidenceForReceipt(tx, shop);
    });
    expect(acquired).toBe(false);
    await held.release();
    expect(
      await pg.connect().transaction((tx) => tryLockBoardingEvidenceForReceipt(tx, shop)),
    ).toBe(true);
  });

  it("holds a participating rewrite until the receipt transaction finishes", async () => {
    const pg = await postgresTestDb();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const intake = pg.connect().transaction(async (tx) => {
      expect(await tryLockBoardingEvidenceForReceipt(tx, shop)).toBe(true);
      ready();
      await gate;
    });
    void intake.catch(() => undefined);
    let rewrite: Promise<unknown> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([intake, ...(rewrite ? [rewrite] : [])]);
    });
    try {
      await Promise.race([
        locked,
        intake.then(() => {
          throw new Error("receipt transaction ended before barrier");
        }),
      ]);
      rewrite = pg
        .connect()
        .transaction((tx) => lockBoardingCertificationEvidence(tx, shop, "rewrite"));
      void rewrite.catch(() => undefined);
      const waiting = waitForLockWaiters(pg.db, 1);
      try {
        await Promise.race([
          waiting,
          rewrite.then(() => {
            throw new Error("rewrite did not wait");
          }),
        ]);
      } catch (error) {
        release();
        await waiting.catch(() => undefined);
        throw error;
      }
    } finally {
      release();
    }
    await intake;
    if (!rewrite) throw new Error("rewrite did not start");
    await rewrite;
  });

  it("requires a transaction with READ COMMITTED isolation", async () => {
    const pg = await postgresTestDb();
    await expect(tryLockBoardingEvidenceForReceipt(pg.db, shop)).rejects.toThrow(
      "requires a transaction",
    );
    await expect(
      pg.connect().transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read`);
        return tryLockBoardingEvidenceForReceipt(tx, shop);
      }),
    ).rejects.toThrow("READ COMMITTED");
  });
});
