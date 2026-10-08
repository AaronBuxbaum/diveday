import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { tripReservationWindow } from "@/lib/gear";
import { proposalKey } from "@/lib/gear-proposals";
import { fileScopedShopContext } from "@/test/db";
import {
  checkOutTripGearSet,
  listAvailableGearUnits,
  recordGearService,
  reserveGearUnit,
  setGearItemStatus,
} from "./gear";
import { gearItems, gearReservations, gearServiceEvents } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import { listStaff, setTripCrew } from "./trips-crew";
import { getTripPrep, screenGearPicks } from "./trips-prep";

async function context() {
  const { db, shop } = fileCtx;
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

/** Put one tagged unit against the first diver who wants one, and hand the row back. */
async function reserveOneUnit(ctx: Awaited<ReturnType<typeof context>>) {
  const before = await prepFor(ctx);
  const wanting = before.assignmentRows.find((entry) => entry.wanted.length > 0);
  const need = wanting?.wanted[0];
  if (!wanting || !need) throw new Error("seeded trip has no diver wanting a unit");
  const window = tripReservationWindow(before.trip, ctx.shop.timezone);
  const [unit] = await listAvailableGearUnits(ctx.db, ctx.shop.id, {
    ...window,
    todayLocal: calendarDateInTimezone(nowDate(), ctx.shop.timezone),
    kind: need.kind,
  });
  if (!unit) throw new Error(`seeded shop has no available ${need.kind}`);
  const reserved = await reserveGearUnit(ctx.db, {
    shopId: ctx.shop.id,
    gearItemId: unit.id,
    bookingId: wanting.diver.bookingId,
    tripId: ctx.tripId,
    reservedFrom: window.from,
    reservedUntil: window.until,
  });
  if (!reserved.ok) throw new Error(`reservation failed: ${reserved.reason}`);
  const after = await prepFor(ctx);
  const row = after.assignmentRows.find(
    (entry) => entry.diver.bookingId === wanting.diver.bookingId,
  );
  if (!row) throw new Error("the reserved diver left the assignment rows");
  return row;
}

/**
 * The unit came home from an earlier, closed reservation flagged as a service
 * concern, and nothing has answered it since. Written at the frozen "now", so
 * it is the newest return the unit has, whatever the seed gave it before.
 */
async function flagServiceConcern(
  ctx: Awaited<ReturnType<typeof context>>,
  gearItemId: string,
  bookingId: string,
) {
  await ctx.db.insert(gearReservations).values({
    shopId: ctx.shop.id,
    gearItemId,
    bookingId,
    reservedFrom: "2026-01-10",
    reservedUntil: "2026-01-10",
    checkedOutAt: new Date("2026-01-10T12:00:00.000Z"),
    returnedAt: nowDate(),
    returnOutcome: "service_concern",
    returnNote: "Second stage free-flows",
  });
}

/**
 * The unit's service clock ran out long before this departure. Written on a
 * clock the seed gave this unit no record of, so no newer seeded event of the
 * same kind can stand in front of it (`latestServiceClocks` keeps the newest
 * per kind, and the worst kind wins).
 */
async function lapseServiceClock(ctx: Awaited<ReturnType<typeof context>>, gearItemId: string) {
  const recorded = new Set(
    (
      await ctx.db
        .select({ kind: gearServiceEvents.kind })
        .from(gearServiceEvents)
        .where(eq(gearServiceEvents.gearItemId, gearItemId))
    ).map((row) => row.kind),
  );
  const kind = (["o2_clean", "hydro_test", "visual_inspection", "service"] as const).find(
    (candidate) => !recorded.has(candidate),
  );
  if (!kind) throw new Error("the unit already has every clock");
  const outcome = await recordGearService(ctx.db, {
    shopId: ctx.shop.id,
    gearItemId,
    kind,
    servicedOn: "2025-01-10",
    nextDueOn: "2025-06-10",
  });
  if (!outcome.ok) throw new Error(`service record refused: ${outcome.reason}`);
}

/** A piece a diver on the reef boat wants, and a free unit that answers it. */
async function aWantedPick(ctx: Awaited<ReturnType<typeof context>>) {
  const prep = await prepFor(ctx);
  for (const row of prep.assignmentRows) {
    for (const need of row.wanted) {
      const unit = prep.freeByKind.get(need.kind)?.[0];
      if (unit) return { bookingId: row.diver.bookingId, gearItemId: unit.id };
    }
  }
  throw new Error("seeded trip has no wanted piece with a free unit");
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const fileCtx = fileScopedShopContext();

describe("getTripPrep", () => {
  it("answers null for a trip that is not this shop's", async () => {
    const { db, shop } = await context();
    expect(await getTripPrep(db, shop, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  /**
   * The proposals the Gear tab offers (UX audit 2026-10-07, item 9), read off
   * the real demo shop: each one is a unit free for this window, in this kind,
   * never the same unit twice, and only ever for a piece somebody wants.
   */
  it("proposes free, distinct units, each for a piece a diver on this boat wants", async () => {
    const ctx = await context();
    const prep = await prepFor(ctx);
    expect(prep.proposals.size).toBeGreaterThan(0);
    const seen = new Set<string>();
    const wantedKeys = new Set(
      prep.assignmentRows.flatMap((row) =>
        row.wanted.map((need) => proposalKey(row.diver.bookingId, need.kind)),
      ),
    );
    for (const [key, unit] of prep.proposals) {
      expect(wantedKeys.has(key), key).toBe(true);
      expect(seen.has(unit.id), `${unit.label} proposed twice`).toBe(false);
      seen.add(unit.id);
      const free = prep.freeByKind.get(unit.kind) ?? [];
      expect(free.some((candidate) => candidate.id === unit.id)).toBe(true);
      expect(unit.serviceState.state).not.toBe("overdue");
    }
  });

  /**
   * The derivation this reader was extracted to cover. `buildDivePrepChecklist`
   * is well tested on its own; the four statements that decided *which* crew to
   * hand it were covered only by Playwright — and they are what says how many
   * tanks go on the boat.
   *
   * The roster is set here rather than read off the seed: the reef boat now
   * carries the ordinary roster plus the assistant instructor in the water (UX
   * audit 2026-10-07, item 4), and these tests are about who stays dry
   * (issue #1851).
   */
  describe("only the crew who actually dive count toward the tanks", () => {
    it("reads the roster's jobs, not its standing roles", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [
        { personId: ctx.byRole("divemaster"), tripRole: "captain" },
        { personId: ctx.byRole("captain"), tripRole: "crew" },
      ]);
      const prep = await prepFor(ctx);
      // Keiko (a divemaster) is driving and Sal (a captain) is on deck: no tank
      // for either, though Keiko's standing role would have bought one.
      expect(prep.checklist.crewCount).toBe(0);
    });

    it("leaves the dry half of a mixed crew off the tank count", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [
        { personId: ctx.byRole("divemaster"), tripRole: null },
        { personId: ctx.byRole("captain"), tripRole: null },
      ]);
      // Nobody has said who does what, so the standing roles decide: one tank.
      expect((await prepFor(ctx)).checklist.crewCount).toBe(1);
    });

    it("counts a divemaster", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [
        { personId: ctx.byRole("divemaster"), tripRole: null },
      ]);
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

    /**
     * **The job on this boat, not the card in the drawer** (issue #1851). A
     * divemaster rostered as the captain or the deckhand drives the boat or
     * handles lines and stays dry; one rostered in the water needs a tank
     * whatever their standing roles say.
     */
    it.each(["captain", "crew"] as const)(
      "does not count a divemaster rostered as this trip's %s",
      async (tripRole) => {
        const ctx = await context();
        await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [
          { personId: ctx.byRole("divemaster"), tripRole },
        ]);
        expect((await prepFor(ctx)).checklist.crewCount).toBe(0);
      },
    );

    it("does not count an instructor rostered as the captain", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [
        { personId: ctx.byRole("instructor"), tripRole: "captain" },
      ]);
      expect((await prepFor(ctx)).checklist.crewCount).toBe(0);
    });

    it("counts anyone rostered in the water, whatever their standing roles", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [
        { personId: ctx.byRole("captain"), tripRole: "divemaster" },
      ]);
      expect((await prepFor(ctx)).checklist.crewCount).toBe(1);
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

    /**
     * **The cart** (issue #1185, delight report D25). The counts the load-out
     * line states, derived from the rows themselves so the line and the rows
     * cannot disagree — and absent entirely for a shop that hands nothing over.
     */
    describe("the load-out cart", () => {
      it("is nothing at all for a shop with no gear register", async () => {
        const ctx = await context();
        // Opt-in by presence works in both directions (ADR
        // 20260815-minimal-gear-register): take the register away and the cart
        // goes with it, rather than rendering "0 units for 0 divers".
        await ctx.db
          .update(gearItems)
          .set({ deletedAt: nowDate() })
          .where(eq(gearItems.shopId, ctx.shop.id));
        const prep = await prepFor(ctx);
        expect(prep.gearFleetTotal).toBe(0);
        expect(prep.loadOut).toBeNull();
      });

      it("counts the units and divers its own rows carry", async () => {
        const prep = await prepFor(await context());
        if (!prep.loadOut) throw new Error("seeded shop has a register, so it has a cart");
        expect(prep.loadOut.units).toBe(
          prep.assignmentRows.reduce((sum, row) => sum + row.assigned.length, 0),
        );
        expect(prep.loadOut.divers).toBe(prep.assignmentRows.length);
        expect(prep.loadOut.stillToPick).toBe(
          prep.assignmentRows.reduce((sum, row) => sum + row.wanted.length, 0),
        );
      });

      it("states a zero rather than dropping the exception counts", async () => {
        // The page decides what to say about an exception; the reader always
        // answers with a number, so "nothing flagged" is never a missing field.
        const prep = await prepFor(await context());
        if (!prep.loadOut) throw new Error("seeded shop has a register, so it has a cart");
        expect(typeof prep.loadOut.serviceFlagged).toBe("number");
        expect(prep.loadOut.serviceFlagged).toBeGreaterThanOrEqual(0);
        expect(prep.loadOut.stillToPick).toBeGreaterThanOrEqual(0);
      });

      /**
       * **An assigned unit keeps its care labels** (second dive-domain review
       * of the proposals). The picker said "service concern" and "service
       * overdue" in the option; the assigned line and the cart's count must
       * not go quiet the moment the pick is made.
       */
      it("carries an open service concern onto the assigned unit and counts it", async () => {
        const ctx = await context();
        const row = await reserveOneUnit(ctx);
        const [held] = row.assigned;
        if (!held) throw new Error("the reserved diver holds nothing");
        expect(held.serviceConcern).toBe(false);
        const before = await prepFor(ctx);

        await flagServiceConcern(ctx, held.gearItemId, row.diver.bookingId);

        const after = await prepFor(ctx);
        const unit = after.assignmentRows
          .flatMap((entry) => entry.assigned)
          .find((assignment) => assignment.gearItemId === held.gearItemId);
        expect(unit?.serviceConcern).toBe(true);
        expect(after.loadOut?.serviceFlagged).toBe((before.loadOut?.serviceFlagged ?? 0) + 1);
      });

      it("carries a lapsed service clock onto the assigned unit and counts it", async () => {
        const ctx = await context();
        const row = await reserveOneUnit(ctx);
        const [held] = row.assigned;
        if (!held) throw new Error("the reserved diver holds nothing");
        expect(held.serviceState.state).not.toBe("overdue");
        const before = await prepFor(ctx);

        await lapseServiceClock(ctx, held.gearItemId);

        const after = await prepFor(ctx);
        const unit = after.assignmentRows
          .flatMap((entry) => entry.assigned)
          .find((assignment) => assignment.gearItemId === held.gearItemId);
        expect(unit?.serviceState.state).toBe("overdue");
        expect(after.loadOut?.serviceFlagged).toBe((before.loadOut?.serviceFlagged ?? 0) + 1);
      });

      /**
       * BCD #7 is assigned for Saturday; on Wednesday a technician pulls it
       * off the wall. Saturday's Gear tab must say so on the row that holds
       * it, and count it (second dive-domain re-review).
       */
      it("carries a unit pulled out of service after it was assigned, and counts it", async () => {
        const ctx = await context();
        const row = await reserveOneUnit(ctx);
        const [held] = row.assigned;
        if (!held) throw new Error("the reserved diver holds nothing");
        expect(held.status).toBe("in_service");
        const before = await prepFor(ctx);

        const pulled = await setGearItemStatus(ctx.db, {
          shopId: ctx.shop.id,
          gearItemId: held.gearItemId,
          status: "needs_service",
          serviceNote: "Inflator sticks",
        });
        if (!pulled.ok) throw new Error("status change refused");

        const after = await prepFor(ctx);
        const unit = after.assignmentRows
          .flatMap((entry) => entry.assigned)
          .find((assignment) => assignment.gearItemId === held.gearItemId);
        expect(unit?.status).toBe("needs_service");
        expect(unit?.serviceNote).toBe("Inflator sticks");
        expect(after.loadOut?.serviceFlagged).toBe((before.loadOut?.serviceFlagged ?? 0) + 1);
      });

      it("counts a unit with every label once", async () => {
        const ctx = await context();
        const row = await reserveOneUnit(ctx);
        const [held] = row.assigned;
        if (!held) throw new Error("the reserved diver holds nothing");
        const before = await prepFor(ctx);

        await flagServiceConcern(ctx, held.gearItemId, row.diver.bookingId);
        await lapseServiceClock(ctx, held.gearItemId);
        await setGearItemStatus(ctx.db, {
          shopId: ctx.shop.id,
          gearItemId: held.gearItemId,
          status: "needs_service",
        });

        const after = await prepFor(ctx);
        expect(after.loadOut?.serviceFlagged).toBe((before.loadOut?.serviceFlagged ?? 0) + 1);
      });

      it("calls a set handed over only once every unit on it has left", async () => {
        const ctx = await context();
        const row = await reserveOneUnit(ctx);
        expect(row.handedOver).toBe(false);

        expect(
          await checkOutTripGearSet(ctx.db, {
            shopId: ctx.shop.id,
            bookingId: row.diver.bookingId,
          }),
        ).toEqual({ ok: true });

        const after = await prepFor(ctx);
        const updated = after.assignmentRows.find(
          (entry) => entry.diver.bookingId === row.diver.bookingId,
        );
        expect(updated?.handedOver).toBe(true);
      });
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

/**
 * **A proposal is re-read for care when it is confirmed** (second dive-domain
 * review of the proposals). A proposal was offered because its unit had no
 * lapsed clock and no open concern; one that gained either since the tab
 * loaded is refused rather than reserved unseen. A hand pick saw the label in
 * the picker and may still choose the unit.
 */
describe("screenGearPicks", () => {
  it("keeps a proposed pick whose unit needs nothing", async () => {
    const ctx = await context();
    const pick = await aWantedPick(ctx);
    expect(await screenGearPicks(ctx.db, ctx.shop, ctx.tripId, [pick], { proposed: true })).toEqual(
      { kept: [pick], refused: 0, needsCare: 0 },
    );
  });

  it("refuses a proposed pick whose unit gained an open service concern", async () => {
    const ctx = await context();
    const pick = await aWantedPick(ctx);
    await flagServiceConcern(ctx, pick.gearItemId, pick.bookingId);
    expect(await screenGearPicks(ctx.db, ctx.shop, ctx.tripId, [pick], { proposed: true })).toEqual(
      { kept: [], refused: 1, needsCare: 1 },
    );
  });

  it("refuses a proposed pick whose unit's service clock lapsed", async () => {
    const ctx = await context();
    const pick = await aWantedPick(ctx);
    await lapseServiceClock(ctx, pick.gearItemId);
    expect(await screenGearPicks(ctx.db, ctx.shop, ctx.tripId, [pick], { proposed: true })).toEqual(
      { kept: [], refused: 1, needsCare: 1 },
    );
  });

  it("keeps a hand pick of a labeled unit, which the picker said out loud", async () => {
    const ctx = await context();
    const pick = await aWantedPick(ctx);
    await flagServiceConcern(ctx, pick.gearItemId, pick.bookingId);
    await lapseServiceClock(ctx, pick.gearItemId);
    expect(
      await screenGearPicks(ctx.db, ctx.shop, ctx.tripId, [pick], { proposed: false }),
    ).toEqual({ kept: [pick], refused: 0, needsCare: 0 });
  });
});
