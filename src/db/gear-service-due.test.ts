import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createGearItem, deleteGearItem, setGearItemStatus } from "./gear-items";
import { reserveGearUnit } from "./gear-reservations";
import { recordGearService } from "./gear-service";
import { listGearServiceDue, listGearServiceDueRows } from "./gear-service-due";
import { gearShopContext, mustCreate, SETUP_PICK, shopBooking, TODAY } from "./gear-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

describe("gear service history: what the bench owes", () => {
  it("surfaces due and overdue clocks, most urgent first, and lets deleted units rest", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const overdueTank = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-02" }),
    );
    const dueSoonReg = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #3" }),
    );
    const healthyBcd = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #3" }),
    );
    const deletedUnit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-99" }),
    );

    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: overdueTank.id,
      kind: "visual_inspection",
      servicedOn: "2025-08-01",
      nextDueOn: "2026-08-01",
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: dueSoonReg.id,
      kind: "service",
      servicedOn: "2025-08-25",
      nextDueOn: "2026-08-25",
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: healthyBcd.id,
      kind: "service",
      servicedOn: "2026-08-01",
      nextDueOn: "2027-08-01",
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: deletedUnit.id,
      kind: "visual_inspection",
      servicedOn: "2024-01-01",
      nextDueOn: "2025-01-01",
    });
    await deleteGearItem(db, { shopId: shop.id, gearItemId: deletedUnit.id, todayLocal: TODAY });

    const due = await listGearServiceDue(db, shop.id, TODAY, 7);
    expect(due.map((row) => row.label)).toEqual(["AL80-02", "Reg #3"]);
    expect(due[0]?.state).toMatchObject({ state: "overdue", kind: "visual_inspection" });
    expect(due[1]?.state).toMatchObject({ state: "due_soon" });

    // A wider window pulls nothing extra in — the healthy BCD is a year out.
    const wide = await listGearServiceDue(db, shop.id, TODAY, 30);
    expect(wide.map((row) => row.label)).toEqual(["AL80-02", "Reg #3"]);
  });

  /**
   * **The register's one fleet-wide reading** (ADR 20260827-the-shops-shelves,
   * slice 9d as amended). The three groups say where a unit *is*; nothing in
   * them says what the bench owes, which is why the service-due tile the slice
   * deleted with the other two had to come back as a view rather than fold
   * into a group. Two properties are the whole point of it, and both are here:
   * it reads the fleet rather than the wall page in front of you, and it keeps
   * the month Today deliberately does not (`listGearServiceDue(…, 6)`).
   */
  it("lists everything the bench owes, across the fleet and past Today's six days", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const benched = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "regulator", label: "Reg #9" }),
    );
    const lapsedTank = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-07" }),
    );
    const monthOutTank = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-08" }),
    );
    const healthy = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "bcd", label: "BCD #9" }),
    );
    const deletedUnit = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-98" }),
    );

    // Pulled off the wall with no clock behind it: stopped now, so it leads.
    await setGearItemStatus(db, {
      shopId: shop.id,
      gearItemId: benched.id,
      status: "needs_service",
      serviceNote: "Free-flow after the morning boat.",
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: lapsedTank.id,
      kind: "visual_inspection",
      servicedOn: "2025-08-01",
      nextDueOn: "2026-08-01",
    });
    // Three weeks out: inside the register's month, outside Today's six days —
    // and a tank's inspection is what a fill station turns a boat away over.
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: monthOutTank.id,
      kind: "visual_inspection",
      servicedOn: "2025-09-10",
      nextDueOn: "2026-09-10",
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: healthy.id,
      kind: "service",
      servicedOn: "2026-08-01",
      nextDueOn: "2027-08-01",
    });
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: deletedUnit.id,
      kind: "visual_inspection",
      servicedOn: "2024-01-01",
      nextDueOn: "2025-01-01",
    });
    await deleteGearItem(db, { shopId: shop.id, gearItemId: deletedUnit.id, todayLocal: TODAY });

    const rows = await listGearServiceDueRows(db, shop.id, { todayLocal: TODAY });
    expect(rows.map((row) => row.item.label)).toEqual(["Reg #9", "AL80-07", "AL80-08"]);
    expect(rows[1]?.serviceState).toMatchObject({ state: "overdue", kind: "visual_inspection" });
    expect(rows[2]?.serviceState).toMatchObject({ state: "due_soon", kind: "visual_inspection" });

    // The reading Today cannot give: its six-day horizon leaves the tank a
    // shop would actually plan next month's service run around behind.
    const todaysHalf = await listGearServiceDue(db, shop.id, TODAY, 6);
    expect(todaysHalf.map((row) => row.label)).toEqual(["AL80-07"]);
  });

  /** A unit can want the bench while it is still with a diver — and the row
   * that says so is the one carrying the act that starts getting it back. */
  it("keeps the open reservation on a due unit that is out with somebody", async () => {
    const { db, shop } = await gearShopContext(ctx);
    const tank = mustCreate(
      await createGearItem(db, { shopId: shop.id, kind: "tank", label: "AL80-09" }),
    );
    const maya = await shopBooking(db, shop.id, "Maya Service");
    await recordGearService(db, {
      shopId: shop.id,
      gearItemId: tank.id,
      kind: "visual_inspection",
      servicedOn: "2025-08-01",
      nextDueOn: "2026-08-01",
    });
    const reserved = await reserveGearUnit(db, {
      shopId: shop.id,
      gearItemId: tank.id,
      bookingId: maya.bookingId,
      reservedFrom: "2026-08-19",
      reservedUntil: "2026-08-22",
      screen: SETUP_PICK,
    });
    expect(reserved.ok).toBe(true);

    const [row] = await listGearServiceDueRows(db, shop.id, { todayLocal: TODAY });
    expect(row?.item.label).toBe("AL80-09");
    expect(row?.reservation).toMatchObject({ personName: "Maya Service" });
  });
});
