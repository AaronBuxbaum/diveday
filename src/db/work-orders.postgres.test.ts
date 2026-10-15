import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { insertInFlight, raceShop, shopCounterLock, withinOrParked } from "@/test/postgres-shop";
import type { AppDb } from "./client";
import { createGearItem } from "./gear-items";
import { createWorkOrder } from "./work-orders";

/**
 * Work-order numbers under real concurrency (fourth review, rows 16 and 33).
 *
 * `createWorkOrder` reads the shop's highest ticket number and inserts the next
 * under a lock on the shop row. PGlite is single-connection and cannot race
 * two; here two connections park on that lock and are released together. The
 * outcome that fails without the lock is the pair of numbers: both read the
 * same maximum, and `work_orders_shop_number_unique` refuses the second.
 *
 * The second test pins the lock's strength: an insert elsewhere in the shop
 * holds `KEY SHARE` on the row, and a ticket must not wait for it. With the
 * lock taken `for update`, as it was until 2026-10-13, it parks.
 */

async function benchUnit(db: AppDb, shopId: string, label: string) {
  const unit = await createGearItem(db, { shopId, kind: "regulator", label });
  if (!unit.ok) throw new Error(`gear item refused: ${unit.reason}`);
  return unit.item.id;
}

describePostgres("createWorkOrder under real concurrency", () => {
  it("gives two simultaneous tickets in one shop consecutive numbers", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const units = [
      await benchUnit(pg.db, shop.id, "Reg #1"),
      await benchUnit(pg.db, shop.id, "Reg #2"),
    ];

    const gate = await holdRowLock(pg, shopCounterLock(shop.id));
    const tickets = units.map((gearItemId) =>
      createWorkOrder(pg.connect(), { shopId: shop.id, gearItemId, reportedProblem: "Leaks" }),
    );
    await waitForLockWaiters(pg.db, tickets.length);
    await gate.release();

    const outcomes = await Promise.all(tickets);
    const numbers = outcomes.map((outcome) => (outcome.ok ? outcome.workOrder.number : null));
    expect(numbers.sort()).toEqual([1, 2]);
  });

  it("does not wait behind an insert elsewhere in the shop", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const unit = await benchUnit(pg.db, shop.id, "Reg #3");

    const gate = await holdRowLock(pg, insertInFlight(shop.id));
    const outcome = await withinOrParked(
      createWorkOrder(pg.connect(), {
        shopId: shop.id,
        gearItemId: unit,
        reportedProblem: "Leaks",
      }),
    );
    await gate.release();
    expect(outcome).toMatchObject({ ok: true });
  });
});
