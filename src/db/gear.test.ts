// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import {
  assignGear,
  createGearItem,
  listCurrentGearAssignments,
  returnGear,
  setGearServiceHold,
} from "./gear";
import { getShopBySlug, getTripRoster, upcomingTripsWithCounts } from "./queries";
import { seedDemo } from "./seed";

async function gearContext() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const [trip] = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  if (!trip) throw new Error("demo trip missing");
  const [rosterEntry] = await getTripRoster(db, trip.id);
  if (!rosterEntry) throw new Error("demo booking missing");
  return { db, shop, booking: rosterEntry.booking };
}

describe("gear assignments (in-memory PGlite)", () => {
  it("claims an available item once, then returns it to the packing pool", async () => {
    const { db, shop, booking } = await gearContext();
    const item = await createGearItem(db, {
      shopId: shop.id,
      label: "BCD-12",
      type: "bcd",
      size: "M",
    });
    if (!item) throw new Error("expected item");
    const assigned = await assignGear(db, {
      shopId: shop.id,
      bookingId: booking.id,
      gearItemId: item.id,
    });
    if (!assigned.ok) throw new Error(`assignment failed: ${assigned.reason}`);
    expect(
      await assignGear(db, { shopId: shop.id, bookingId: booking.id, gearItemId: item.id }),
    ).toEqual({ ok: false, reason: "not_available" });
    expect(await listCurrentGearAssignments(db, shop.id)).toHaveLength(1);
    expect(await returnGear(db, shop.id, assigned.assignmentId)).toBe(true);
    expect(await listCurrentGearAssignments(db, shop.id)).toHaveLength(0);
  });

  it("never assigns service-held equipment and cannot place checked-out gear on hold", async () => {
    const { db, shop, booking } = await gearContext();
    const held = await createGearItem(db, { shopId: shop.id, label: "REG-4", type: "regulator" });
    const active = await createGearItem(db, { shopId: shop.id, label: "BCD-13", type: "bcd" });
    if (!held || !active) throw new Error("expected inventory");
    expect(await setGearServiceHold(db, shop.id, held.id, true)).toBe(true);
    expect(
      await assignGear(db, { shopId: shop.id, bookingId: booking.id, gearItemId: held.id }),
    ).toEqual({ ok: false, reason: "service_hold" });
    const assigned = await assignGear(db, {
      shopId: shop.id,
      bookingId: booking.id,
      gearItemId: active.id,
    });
    if (!assigned.ok) throw new Error("expected active item assignment");
    expect(await setGearServiceHold(db, shop.id, active.id, true)).toBe(false);
  });
});
