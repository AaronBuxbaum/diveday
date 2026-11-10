import { describe, expect, it, vi } from "vitest";
import * as queryHelpers from "../../db/query-helpers";
import { fileScopedShopContext } from "../../test/db";
import { getMonthlyReport } from "./store";

const ctx = fileScopedShopContext();

describe("monthly report scheduling", () => {
  it("schedules independent reads in waves of at most four", async () => {
    const read = vi.spyOn(queryHelpers, "queryAll");
    try {
      await getMonthlyReport(ctx.db, ctx.shop.id, new Date("2026-06-01Z"), new Date("2026-07-01Z"));
      expect(read.mock.calls.length).toBeGreaterThan(0);
      expect(read.mock.calls.every(([, queries]) => queries.length <= 4)).toBe(true);
    } finally {
      read.mockRestore();
    }
  });
});
