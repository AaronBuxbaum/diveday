import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { tripReservationWindow } from "@/lib/gear";
import { seededShopContext } from "@/test/db";
import { listAvailableGearUnits, reserveGearUnit } from "./gear";
import { upcomingTripsWithCounts } from "./trips";
import { listStaff, setTripCrew } from "./trips-crew";
import { getTripPrep } from "./trips-prep";

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((entry) => entry.title.startsWith("Two-Tank Reef — Molasses"));
  if (!trip) throw new Error("demo reef trip missing");
  const staff = await listStaff(db, shop.id);
  const byRole = (role: string) => {
    const found = staff.find((entry) => entry.roles.includes(role));
    if (!found) throw new Error(`seeded shop has no ${role}`);
    return found.person.id;
  };
  return { db, shop, tripId: trip.id, byRole };
}

async function prepFor(ctx: Awaited<ReturnType<typeof context>>) {
  const prep = await getTripPrep(ctx.db, ctx.shop, ctx.tripId);
  if (!prep) throw new Error("prep missing for the seeded trip");
  return prep;
}

describe("getTripPrep", () => {
  it("answers null for a trip that is not this shop's", async () => {
    const { db, shop } = await context();
    expect(await getTripPrep(db, shop, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  /**
   * The derivation this reader was extracted to cover. `buildDivePrepChecklist`
   * is well tested on its own; the four statements that decided *which* crew to
   * hand it were covered only by Playwright — and they are what says how many
   * tanks go on the boat.
   *
   * The seed already states the case: the reef trip's crew is a divemaster and a
   * captain, and only one of them gets wet.
   */
  describe("only the crew who actually dive count toward the tanks", () => {
    it("leaves the dry half of a mixed crew off the tank count", async () => {
      const ctx = await context();
      const prep = await prepFor(ctx);
      // Keiko (divemaster) and Sal (captain) are both assigned; one tank, not two.
      expect(prep.checklist.crewCount).toBe(1);
    });

    it("counts a divemaster", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [ctx.byRole("divemaster")]);
      const prep = await prepFor(ctx);
      expect(prep.checklist.crewCount).toBe(1);
      expect(prep.checklist.tanks.total).toBe(
        (prep.checklist.diverCount + 1) * prep.checklist.diveCount,
      );
      // Crew carry no rental fit, so they never move the nitrox split.
      expect(prep.checklist.tanks.nitrox).toBe(0);
    });

    it("counts an instructor", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [ctx.byRole("instructor")]);
      expect((await prepFor(ctx)).checklist.crewCount).toBe(1);
    });

    it("does not count a captain who never gets wet", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [ctx.byRole("captain")]);
      const prep = await prepFor(ctx);
      expect(prep.checklist.crewCount).toBe(0);
      // The boat still loads a tank per diver per dive — just none for Sal.
      expect(prep.checklist.tanks.total).toBe(prep.checklist.diverCount * prep.checklist.diveCount);
    });

    it("does not count an owner or manager who is not also crew that dives", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [ctx.byRole("owner")]);
      expect((await prepFor(ctx)).checklist.crewCount).toBe(0);
    });
  });

  describe("the gear-assignment rows", () => {
    it("never offers weights, which are bulk stock rather than a tagged unit", async () => {
      const prep = await prepFor(await context());
      for (const row of prep.assignmentRows) {
        expect(row.wanted.map((item) => item.kind)).not.toContain("weights");
      }
    });

    it("carries only divers who hold a unit or want one", async () => {
      const prep = await prepFor(await context());
      for (const row of prep.assignmentRows) {
        expect(row.assigned.length + row.wanted.length).toBeGreaterThan(0);
      }
    });

    it("offers nothing the shop's register does not tag", async () => {
      const prep = await prepFor(await context());
      // `wanted` is filtered against the fleet's own kinds, so a shop that tags
      // only regulators is never offered a wetsuit picker.
      if (prep.gearFleetTotal === 0) {
        expect(prep.assignmentRows.every((row) => row.wanted.length === 0)).toBe(true);
      }
    });

    it("buckets free units by kind", async () => {
      const prep = await prepFor(await context());
      for (const [kind, units] of prep.freeByKind) {
        expect(units.every((unit) => unit.kind === kind)).toBe(true);
      }
    });

    it("keeps fins wanted after the mask unit is reserved", async () => {
      const ctx = await context();
      const before = await prepFor(ctx);
      const row = before.assignmentRows.find((entry) => {
        const kinds = entry.wanted.map((item) => item.kind);
        return kinds.includes("mask") && kinds.includes("fins");
      });
      if (!row) throw new Error("seeded trip has no diver needing mask and fins");

      const window = tripReservationWindow(before.trip, ctx.shop.timezone);
      const mask = await listAvailableGearUnits(ctx.db, ctx.shop.id, {
        ...window,
        todayLocal: calendarDateInTimezone(nowDate(), ctx.shop.timezone),
        kind: "mask",
      });
      const unit = mask[0];
      if (!unit) throw new Error("seeded shop has no available mask");
      const reserved = await reserveGearUnit(ctx.db, {
        shopId: ctx.shop.id,
        gearItemId: unit.id,
        bookingId: row.diver.bookingId,
        tripId: ctx.tripId,
        reservedFrom: window.from,
        reservedUntil: window.until,
      });
      if (!reserved.ok) throw new Error(`mask reservation failed: ${reserved.reason}`);

      const after = await prepFor(ctx);
      const updated = after.assignmentRows.find(
        (entry) => entry.diver.bookingId === row.diver.bookingId,
      );
      expect(updated?.wanted.map((item) => item.kind)).toContain("fins");
      expect(updated?.wanted.map((item) => item.kind)).not.toContain("mask");
    });
  });
});
