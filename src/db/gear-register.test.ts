import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createGearItem } from "./gear-items";
import { gearRegisterGroups } from "./gear-register";
import { checkOutGearReservation, reserveGearUnit } from "./gear-reservations";
import { gearShopContext, mustCreate, SETUP_PICK, shopBooking, TODAY } from "./gear-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **The pin for slice 9d** (ADR 20260827-the-shops-shelves): the register is
 * one story in three groups, a unit sits in exactly one of them, and the two
 * groups that mean somebody has to do something are never paged away.
 */
describe("the register's three groups", () => {
  /** Out, overdue, never-collected, upcoming and free — one shop, five units. */
  async function registerShop() {
    const { db, shop } = await gearShopContext(ctx);
    const unit = async (
      label: string,
      window?: { from: string; until: string; collected?: boolean },
    ) => {
      const item = mustCreate(await createGearItem(db, { shopId: shop.id, kind: "bcd", label }));
      if (!window) return item;
      // A seat of Maya's per unit: one diver holds one BCD at a time.
      const maya = await shopBooking(db, shop.id, "Maya Reyes");
      const reserved = await reserveGearUnit(db, {
        shopId: shop.id,
        gearItemId: item.id,
        bookingId: maya.bookingId,
        reservedFrom: window.from,
        reservedUntil: window.until,
        screen: SETUP_PICK,
      });
      if (!reserved.ok) throw new Error(`reserve refused: ${reserved.reason}`);
      if (window.collected) {
        await checkOutGearReservation(db, {
          shopId: shop.id,
          reservationId: reserved.reservation.id,
        });
      }
      return item;
    };
    return {
      db,
      shop,
      out: await unit("BCD #1", { from: "2026-08-19", until: "2026-08-25", collected: true }),
      overdue: await unit("BCD #2", { from: "2026-08-10", until: "2026-08-15", collected: true }),
      // Never collected and already lapsed: a release, not a phone call — and
      // still the overdue group, because the group is where the work is.
      stale: await unit("BCD #3", { from: "2026-08-11", until: "2026-08-16" }),
      upcoming: await unit("BCD #4", { from: "2026-08-29", until: "2026-08-30" }),
      free: await unit("BCD #5"),
    };
  }

  it("files each unit in exactly one group, the wall holding what nobody has claimed today", async () => {
    const { db, shop, out, overdue, stale, upcoming, free } = await registerShop();
    const groups = await gearRegisterGroups(db, shop.id, { todayLocal: TODAY });

    expect(groups.out.map((row) => row.item.id)).toEqual([out.id]);
    expect(groups.overdue.map((row) => row.item.id)).toEqual([overdue.id, stale.id]);
    expect(groups.onWall.rows.map((row) => row.item.id)).toEqual([upcoming.id, free.id]);

    const filed = [...groups.out, ...groups.overdue, ...groups.onWall.rows].map(
      (row) => row.item.id,
    );
    expect(new Set(filed).size).toBe(filed.length);
    expect(filed).toHaveLength(5);
    // The count keeps the row query's exact scope: the wall's own units, not
    // the fleet (ADR 20260803-one-pagination-model).
    expect(groups.onWall.total).toBe(2);
  });

  it("never pages an overdue unit away, however deep the wall goes", async () => {
    const { db, shop, out, overdue, stale } = await registerShop();
    const groups = await gearRegisterGroups(db, shop.id, {
      todayLocal: TODAY,
      page: 2,
      pageSize: 1,
    });
    expect(groups.out.map((row) => row.item.id)).toEqual([out.id]);
    expect(groups.overdue.map((row) => row.item.id)).toEqual([overdue.id, stale.id]);
    expect(groups.onWall.rows).toHaveLength(1);
    expect(groups.onWall.page).toBe(2);
    expect(groups.onWall.pageCount).toBe(2);
  });

  it("narrows every group by the kind chips, not only the wall", async () => {
    const { db, shop, out } = await registerShop();
    const tank = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-70" }),
    );
    const bcds = await gearRegisterGroups(db, shop.id, { todayLocal: TODAY, kind: "bcd" });
    expect(bcds.out.map((row) => row.item.id)).toEqual([out.id]);
    expect(bcds.onWall.rows.map((row) => row.item.id)).not.toContain(tank.id);

    const tanks = await gearRegisterGroups(db, shop.id, { todayLocal: TODAY, kind: "tank" });
    expect(tanks.out).toEqual([]);
    expect(tanks.overdue).toEqual([]);
    expect(tanks.onWall.rows.map((row) => row.item.id)).toEqual([tank.id]);
  });

  it("carries the departure's own clock, for the row that has to name a time", async () => {
    const { db, shop, out } = await registerShop();
    const groups = await gearRegisterGroups(db, shop.id, { todayLocal: TODAY });
    expect(groups.out[0]?.item.id).toBe(out.id);
    expect(groups.out[0]?.reservation?.tripEndsAt).toBeInstanceOf(Date);
  });
});
