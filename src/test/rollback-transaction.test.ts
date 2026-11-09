import { expect, it, vi } from "vitest";
import { openRollbackTransaction } from "./rollback-transaction";

it("rejects readiness with the original BEGIN failure before the callback runs", async () => {
  const error = new Error("BEGIN failed");
  await expect(openRollbackTransaction(() => Promise.reject(error))).rejects.toBe(error);
  await expect(
    openRollbackTransaction(() => {
      throw error;
    }),
  ).rejects.toBe(error);
});

it("holds the transaction until teardown and rolls it back", async () => {
  const db = { rows: [1] };
  const rollback = vi.fn();
  const handle = await openRollbackTransaction(async (callback) => {
    try {
      await callback(db);
    } catch (error) {
      db.rows = [];
      rollback();
      throw error;
    }
  });
  expect(handle.db).toBe(db);
  expect(rollback).not.toHaveBeenCalled();
  await handle.finish();
  expect(rollback).toHaveBeenCalledOnce();
  expect(db.rows).toEqual([]);
});

it("preserves failures during rollback", async () => {
  const error = new Error("rollback failed");
  const handle = await openRollbackTransaction(async (callback) => {
    try {
      await callback({});
    } catch {
      throw error;
    }
  });
  await expect(handle.finish()).rejects.toBe(error);
});
