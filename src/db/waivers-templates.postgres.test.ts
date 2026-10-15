import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { insertInFlight, raceShop, shopCounterLock, withinOrParked } from "@/test/postgres-shop";
import { saveWaiverTemplate } from "./waivers-templates";

/**
 * Waiver template versions under real concurrency (CR-015; fourth review, rows
 * 16 and 33). The legal ordering of a shop's releases is the version number,
 * so two saves at once must get two versions, gapless, never one twice. The
 * lock is the shop row, which also serializes a shop's very first template.
 * Without it both saves read the same highest version and
 * `waiver_templates_shop_version_unique` refuses one: a staffer's edit lost.
 */

const body = (name: string) =>
  `${name}: I understand diving carries risk and release the shop as the law allows.`;

describePostgres("saveWaiverTemplate under real concurrency", () => {
  it("gives two simultaneous first saves versions 1 and 2", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);

    const gate = await holdRowLock(pg, shopCounterLock(shop.id));
    const saves = ["A", "B"].map((name) =>
      saveWaiverTemplate(pg.connect(), { shopId: shop.id, title: "Release", body: body(name) }),
    );
    await waitForLockWaiters(pg.db, saves.length);
    await gate.release();

    const results = await Promise.all(saves);
    expect(results.map((result) => result.template.version).sort()).toEqual([1, 2]);
  });

  it("does not wait behind an insert elsewhere in the shop", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);

    const gate = await holdRowLock(pg, insertInFlight(shop.id));
    const result = await withinOrParked(
      saveWaiverTemplate(pg.connect(), { shopId: shop.id, title: "Release", body: body("C") }),
    );
    await gate.release();
    expect(result).toMatchObject({ versioned: true });
  });
});
