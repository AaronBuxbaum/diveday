import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createGearItem, deleteGearItem } from "./gear-items";
import { returnGearReservation } from "./gear-reservations";
import { liveGearItem, openGearReservation, optional } from "./gear-shared";
import { aSetOut, gearShopContext, mustCreate, TODAY } from "./gear-test-fixtures";
import { gearItems, gearReservations } from "./schema";

/**
 * What every `gear-*` module filters by: the live units, the holds still
 * standing, and a typed field's blank. Each reader's own test pins the filter in
 * use; these pin the filters themselves.
 */

const ctx = fileScopedShopContext();

describe("optional", () => {
  it("trims a typed value and reads a blank one as nothing", () => {
    expect(optional("  BCD #4 ")).toBe("BCD #4");
    expect(optional("   ")).toBeNull();
    expect(optional(undefined)).toBeNull();
  });
});

describe("liveGearItem", () => {
  it("passes a unit until it is deleted, and the row stays", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const unit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #9" }),
    );
    const live = () =>
      db
        .select({ id: gearItems.id })
        .from(gearItems)
        .where(and(eq(gearItems.shopId, shop.id), liveGearItem()));

    expect((await live()).map((row) => row.id)).toEqual([unit.id]);
    await deleteGearItem(db, { shopId: shop.id, gearItemId: unit.id, todayLocal: TODAY });
    expect(await live()).toEqual([]);
    const [stored] = await db.select().from(gearItems).where(eq(gearItems.id, unit.id));
    expect(stored?.deletedAt).toBeInstanceOf(Date);
  });
});

describe("openGearReservation", () => {
  it("passes a hold that is out, and drops it once it comes home", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const { reservationIds } = await aSetOut(db, shop.id);
    const open = async () =>
      (
        await db
          .select({ id: gearReservations.id })
          .from(gearReservations)
          .where(and(eq(gearReservations.shopId, shop.id), openGearReservation()))
      ).map((row) => row.id);

    expect((await open()).sort()).toEqual([...reservationIds].sort());
    const [first, second] = reservationIds;
    if (!first) throw new Error("expected a reservation");
    await returnGearReservation(db, { shopId: shop.id, reservationId: first });
    expect(await open()).toEqual([second]);
  });
});
