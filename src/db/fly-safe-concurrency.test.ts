import { describe, expect, it } from "vitest";
import { fileScopedShopContext, seededTestDb } from "@/test/db";
import { mapFlySafeConcurrent } from "./fly-safe-correction";

const ctx = fileScopedShopContext();

describe("mapFlySafeConcurrent", () => {
  it("bounds active work, returns every result in input order, and propagates failures", async () => {
    const poolDb = await seededTestDb();
    let active = 0;
    let peak = 0;
    const values = await mapFlySafeConcurrent(poolDb, [0, 1, 2, 3, 4, 5, 6], 3, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });

    expect(peak).toBe(3);
    expect(values).toEqual([0, 2, 4, 6, 8, 10, 12]);
    await expect(
      mapFlySafeConcurrent(poolDb, [0, 1, 2], 2, async (value) => {
        if (value === 1) throw new Error("query failed");
        return value;
      }),
    ).rejects.toThrow("query failed");

    await ctx.db.transaction(async (tx) => {
      let transactionActive = 0;
      let transactionPeak = 0;
      const transactionValues = await mapFlySafeConcurrent(tx, [0, 1, 2, 3], 4, async (value) => {
        transactionActive += 1;
        transactionPeak = Math.max(transactionPeak, transactionActive);
        await Promise.resolve();
        transactionActive -= 1;
        return value;
      });
      expect(transactionPeak).toBe(1);
      expect(transactionValues).toEqual([0, 1, 2, 3]);
    });
  });
});
