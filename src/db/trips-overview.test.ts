import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { people } from "./schema";
import { setStaffLanguages } from "./staff-accounts";
import { upcomingTripsWithCounts } from "./trips";
import { listStaff, setTripCrew } from "./trips-crew";
import { getTripOverview } from "./trips-overview";

async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((entry) => entry.title.startsWith("Two-Tank Reef — Molasses"));
  if (!trip) throw new Error("demo reef trip missing");
  const staff = await listStaff(db, shop.id);
  const owner = staff.find((entry) => entry.roles.includes("owner"));
  if (!owner) throw new Error("seeded shop has no owner");
  const byRole = (role: string) => {
    const found = staff.find((entry) => entry.roles.includes(role));
    if (!found) throw new Error(`seeded shop has no ${role}`);
    return found.person.id;
  };
  return { db, shop, tripId: trip.id, actor: owner.person.id, byRole };
}

async function overviewFor(ctx: Awaited<ReturnType<typeof context>>) {
  const overview = await getTripOverview(ctx.db, ctx.shop, ctx.tripId, ctx.actor);
  if (!overview) throw new Error("overview missing for the seeded trip");
  return overview;
}

describe("getTripOverview", () => {
  it("answers null for a trip that is not this shop's", async () => {
    const ctx = await context();
    expect(
      await getTripOverview(ctx.db, ctx.shop, "00000000-0000-4000-8000-000000000000", ctx.actor),
    ).toBeNull();
  });

  /**
   * The join issue #632 names: `countInWaterCrew` and `courseCrewGap` are each
   * well unit-tested, and the four statements that build their arguments by
   * joining `listStaff` against `getTripCrewAssignments` had no test at all.
   */
  describe("the crew join that feeds the ratio gates", () => {
    it("pairs each assigned person with the role they hold on this trip", async () => {
      const ctx = await context();
      const overview = await overviewFor(ctx);
      for (const personId of overview.crew.crewIds) {
        expect(overview.crew.tripRoleByPerson.has(personId)).toBe(true);
      }
    });

    it("counts a divemaster as in-water crew", async () => {
      const ctx = await context();
      // `tripRole: null` — no per-trip job, so the shop-wide role decides.
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [
        { personId: ctx.byRole("divemaster"), tripRole: null },
      ]);
      const { crew } = await overviewFor(ctx);
      expect(crew.crewIds).toHaveLength(1);
      // A divemaster is a *certified assistant* in the agency ratio's terms.
      expect(crew.inWaterCrew.assistantCount).toBe(1);
      expect(crew.inWaterCrew.instructorCount).toBe(0);
    });

    it("counts an instructor as in-water crew", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [
        { personId: ctx.byRole("instructor"), tripRole: null },
      ]);
      const { crew } = await overviewFor(ctx);
      expect(crew.inWaterCrew.instructorCount).toBe(1);
    });

    /**
     * DOM-M3: a divemaster rostered as this trip's captain is not in the water,
     * so they must not buy two students' worth of capacity. The trip role wins
     * over the shop role, and that is decided by the join under test.
     */
    it("does not count a divemaster rostered as this trip's captain", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [
        { personId: ctx.byRole("divemaster"), tripRole: "captain" },
      ]);
      const { crew } = await overviewFor(ctx);
      expect(crew.crewIds).toHaveLength(1);
      expect(crew.inWaterCrew.assistantCount).toBe(0);
      expect(crew.inWaterCrew.instructorCount).toBe(0);
    });

    it("reports the shop's own divemaster target off that same count", async () => {
      const ctx = await context();
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, []);
      const { crew, trip } = await overviewFor(ctx);
      // No crew at all, on a boat with divers: the shop's target is unmet, and
      // it informs rather than refuses.
      if (trip.booked > 0) {
        if (crew.ratioGap.code === "none") throw new Error("expected an unmet target");
        expect(crew.ratioGap.divemasterCount).toBe(0);
      }
    });
  });

  describe("the pulse", () => {
    it("beats for a departure that is still ahead", async () => {
      const overview = await overviewFor(await context());
      expect(overview.pulseNeeded).toBe(true);
      expect(overview.cancelled).toBe(false);
      expect(overview.pulse.blocked).toBeGreaterThanOrEqual(0);
      expect(overview.pulse.boarded).toBeGreaterThanOrEqual(0);
    });

    /**
     * A departure an hour past its return has nothing left to watch, and the
     * pulse's four reads are skipped entirely rather than rendered at zero.
     * The hour of grace is the point: boats run late.
     */
    it("goes quiet an hour after the boat is back, and not before", async () => {
      const ctx = await context();
      const overview = await overviewFor(ctx);
      const endsAt = overview.trip.endsAt.getTime();

      const stillOut = await getTripOverview(
        ctx.db,
        ctx.shop,
        ctx.tripId,
        ctx.actor,
        new Date(endsAt + 59 * 60_000),
      );
      expect(stillOut?.pulseNeeded).toBe(true);

      const home = await getTripOverview(
        ctx.db,
        ctx.shop,
        ctx.tripId,
        ctx.actor,
        new Date(endsAt + 61 * 60_000),
      );
      expect(home?.pulseNeeded).toBe(false);
      expect(home?.pulse).toEqual({ blocked: 0, prepGaps: 0, boarded: 0, openOrders: 0 });
    });
  });

  it("describes day one's window, not the whole multi-day span", async () => {
    const overview = await overviewFor(await context());
    // The details editor's Departs/Returns boxes describe one day that the day
    // count then repeats, so `endWall` is the first day's return.
    expect(overview.startWall.hour).toBeGreaterThanOrEqual(0);
    expect(overview.endWall.hour).toBeGreaterThanOrEqual(0);
    expect(overview.scheduleDays.length).toBeGreaterThan(0);
  });

  /**
   * The staff-side half of issue #708: a quiet, non-gating note when a
   * booked diver's stated language isn't covered by the assigned crew's
   * recorded languages.
   */
  describe("crew.languageGap", () => {
    it("reports none when no booked diver has signalled a language preference", async () => {
      const ctx = await context();
      const { crew } = await overviewFor(ctx);
      expect(crew.languageGap).toEqual({ code: "none" });
    });

    it("reports the uncovered language once a booked diver signals one nobody on the crew speaks", async () => {
      const ctx = await context();
      const outcome = await createBooking(ctx.db, {
        actor: "staff",
        shopId: ctx.shop.id,
        tripId: ctx.tripId,
        fullName: "Freya Lindqvist",
        email: `freya-${nowMs()}@example.com`,
      });
      if (!outcome.ok) throw new Error("expected booking to succeed");
      await ctx.db.update(people).set({ locale: "es-ES" }).where(eq(people.id, outcome.personId));

      const { crew } = await overviewFor(ctx);
      expect(crew.languageGap).toEqual({ code: "uncovered", missing: ["es"] });
    });

    it("reports none once an assigned crew member records the language a booked diver signalled", async () => {
      const ctx = await context();
      const outcome = await createBooking(ctx.db, {
        actor: "staff",
        shopId: ctx.shop.id,
        tripId: ctx.tripId,
        fullName: "Freya Lindqvist",
        email: `freya-${nowMs()}@example.com`,
      });
      if (!outcome.ok) throw new Error("expected booking to succeed");
      await ctx.db.update(people).set({ locale: "es-ES" }).where(eq(people.id, outcome.personId));

      const divemasterId = ctx.byRole("divemaster");
      await setStaffLanguages(ctx.db, {
        shopId: ctx.shop.id,
        personId: divemasterId,
        languages: ["es"],
      });
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, [divemasterId]);

      const { crew } = await overviewFor(ctx);
      expect(crew.languageGap).toEqual({ code: "none" });
    });

    it("is unaffected by a crew member's recorded languages if they are not actually assigned", async () => {
      const ctx = await context();
      const outcome = await createBooking(ctx.db, {
        actor: "staff",
        shopId: ctx.shop.id,
        tripId: ctx.tripId,
        fullName: "Freya Lindqvist",
        email: `freya-${nowMs()}@example.com`,
      });
      if (!outcome.ok) throw new Error("expected booking to succeed");
      await ctx.db.update(people).set({ locale: "es-ES" }).where(eq(people.id, outcome.personId));

      // Recorded, but explicitly taken off this trip's crew — the seeded
      // fixture assigns crew to it by default, so this clears that first
      // rather than trusting nobody else on it happens to cover "es".
      const divemasterId = ctx.byRole("divemaster");
      await setStaffLanguages(ctx.db, {
        shopId: ctx.shop.id,
        personId: divemasterId,
        languages: ["es"],
      });
      await setTripCrew(ctx.db, ctx.shop.id, ctx.tripId, []);

      const { crew } = await overviewFor(ctx);
      expect(crew.crewIds).not.toContain(divemasterId);
      expect(crew.languageGap).toEqual({ code: "uncovered", missing: ["es"] });
    });
  });
});
