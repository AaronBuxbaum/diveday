import { expect, it } from "vitest";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { changeTripCrewOutcome } from "./trips-crew";

describePostgres("crew changes serialize with training plan writes", () => {
  it("waits for a planning transaction before changing the crew", async () => {
    const pg = await postgresTestDb();
    const shopId = "11111111-1111-4111-8111-111111111111";
    let acquired!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const planning = pg.connect().transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, shopId, "boarding");
      acquired();
      await hold;
    });
    let change: ReturnType<typeof changeTripCrewOutcome> | undefined;
    try {
      await Promise.race([locked, planning]);
      change = changeTripCrewOutcome(pg.connect(), shopId, "22222222-2222-4222-8222-222222222222", {
        operation: "unassign",
        personId: "33333333-3333-4333-8333-333333333333",
      });
      try {
        await waitForLockWaiters(pg.db, 1);
      } finally {
        release();
      }
      expect((await change).ok).toBe(false);
    } finally {
      release();
      await Promise.allSettled(change ? [planning, change] : [planning]);
    }
  });
});
