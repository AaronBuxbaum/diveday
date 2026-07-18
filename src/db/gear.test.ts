// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import {
  assignGear,
  createGearItem,
  listCurrentGearAssignments,
  listGearServiceEvents,
  recordGearService,
  retireGear,
  returnGear,
  setGearServiceHold,
} from "./gear";
import { getShopBySlug, getTripRoster, listStaff, upcomingTripsWithCounts } from "./queries";
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
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("demo staff missing");
  return { db, shop, booking: rosterEntry.booking, staff: staff.person };
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

  it("writes a tenant-scoped service event before returning held equipment to the packing pool", async () => {
    const { db, shop, staff } = await gearContext();
    const item = await createGearItem(db, { shopId: shop.id, label: "REG-7", type: "regulator" });
    if (!item) throw new Error("expected inventory");
    expect(await setGearServiceHold(db, shop.id, item.id, true)).toBe(true);

    const completedAt = new Date("2026-07-20T12:00:00.000Z");
    const nextDueAt = new Date("2027-07-20T12:00:00.000Z");
    const outcome = await recordGearService(db, {
      shopId: shop.id,
      gearItemId: item.id,
      recordedByPersonId: staff.id,
      note: "Bench-tested and replaced the mouthpiece.",
      serviceCompletedAt: completedAt,
      nextServiceDueAt: nextDueAt,
    });
    expect(outcome.ok).toBe(true);
    const events = await listGearServiceEvents(db, shop.id, item.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      service: { gearItemId: item.id, note: "Bench-tested and replaced the mouthpiece." },
      item: { state: "available", serviceDueAt: nextDueAt },
      staff: { id: staff.id },
    });
  });

  it("refuses to record completed service for gear that is still checked out", async () => {
    const { db, shop, booking, staff } = await gearContext();
    const item = await createGearItem(db, { shopId: shop.id, label: "BCD-22", type: "bcd" });
    if (!item) throw new Error("expected inventory");
    const assigned = await assignGear(db, {
      shopId: shop.id,
      bookingId: booking.id,
      gearItemId: item.id,
    });
    if (!assigned.ok) throw new Error("expected assignment");

    await expect(
      recordGearService(db, {
        shopId: shop.id,
        gearItemId: item.id,
        recordedByPersonId: staff.id,
        note: "Attempted service while still on the boat.",
      }),
    ).resolves.toEqual({ ok: false, reason: "checked_out" });
    expect(await listGearServiceEvents(db, shop.id, item.id)).toHaveLength(0);
  });

  it("retires only equipment that is back in the gear room", async () => {
    const { db, shop, booking } = await gearContext();
    const available = await createGearItem(db, {
      shopId: shop.id,
      label: "MASK-8",
      type: "mask_fins",
    });
    const checkedOut = await createGearItem(db, { shopId: shop.id, label: "TANK-4", type: "tank" });
    if (!available || !checkedOut) throw new Error("expected inventory");
    expect(await retireGear(db, shop.id, available.id)).toBe(true);
    expect(
      await assignGear(db, { shopId: shop.id, bookingId: booking.id, gearItemId: available.id }),
    ).toEqual({ ok: false, reason: "retired" });

    const assigned = await assignGear(db, {
      shopId: shop.id,
      bookingId: booking.id,
      gearItemId: checkedOut.id,
    });
    if (!assigned.ok) throw new Error("expected assignment");
    expect(await retireGear(db, shop.id, checkedOut.id)).toBe(false);
  });
});
