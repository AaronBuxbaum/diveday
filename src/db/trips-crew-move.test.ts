import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { personClashesAfterMove, personClashesByTrip } from "./person-clashes";
import { activityEvents, tripAssignments } from "./schema";
import {
  changeTripCrewOutcome,
  createTrip,
  getTripCrewAssignments,
  listCrewMoveTargets,
  listStaff,
  moveTripCrewMember,
  setTripStatus,
} from "./trips";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

const DAY = "2030-09-14";
const at = (hour: number) => new Date(`${DAY}T${String(hour).padStart(2, "0")}:00:00Z`);

async function boat(title: string, startHour: number, hours = 3) {
  const trip = await createTrip(ctx.db, {
    shopId: ctx.shop.id,
    title,
    startsAt: at(startHour),
    endsAt: new Date(at(startHour).getTime() + hours * 3_600_000),
    capacity: 8,
  });
  if (!trip) throw new Error("trip not created");
  return trip;
}

async function divemaster() {
  const staff = await listStaff(ctx.db, ctx.shop.id);
  const person = staff.find((entry) => !entry.roles.includes("owner")) ?? staff[0];
  if (!person) throw new Error("seeded staff missing");
  return person.person.id;
}

/** Crew moves on the day board (issue #4474), one connection; the races are the postgres file's. */
describe("moveTripCrewMember", () => {
  it("moves a crew member and their job in one step", async () => {
    const personId = await divemaster();
    const morning = await boat("Morning reef", 8);
    const afternoon = await boat("Afternoon wreck", 13);
    await changeTripCrewOutcome(ctx.db, ctx.shop.id, morning.id, {
      operation: "assign",
      personId,
      tripRole: "divemaster",
    });
    expect(
      await moveTripCrewMember(ctx.db, ctx.shop.id, {
        personId,
        fromTripId: morning.id,
        toTripId: afternoon.id,
      }),
    ).toEqual({ ok: true });
    expect(await getTripCrewAssignments(ctx.db, ctx.shop.id, morning.id)).toEqual([]);
    expect(await getTripCrewAssignments(ctx.db, ctx.shop.id, afternoon.id)).toEqual([
      expect.objectContaining({ personId, tripRole: "divemaster" }),
    ]);
  });

  it("refuses a move onto a boat whose hours another of their crews overlaps, and moves nothing", async () => {
    const personId = await divemaster();
    const morning = await boat("Morning reef", 8);
    const afternoon = await boat("Afternoon wreck", 13);
    const overlapping = await boat("Afternoon drift", 14);
    await changeTripCrewOutcome(ctx.db, ctx.shop.id, morning.id, { operation: "assign", personId });
    await changeTripCrewOutcome(ctx.db, ctx.shop.id, overlapping.id, {
      operation: "assign",
      personId,
    });
    expect(
      await moveTripCrewMember(ctx.db, ctx.shop.id, {
        personId,
        fromTripId: morning.id,
        toTripId: afternoon.id,
      }),
    ).toEqual({ ok: false, refusal: "crew_clash" });
    const [still] = await ctx.db
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .where(and(eq(tripAssignments.tripId, morning.id), eq(tripAssignments.personId, personId)));
    expect(still?.personId).toBe(personId);
  });

  it("refuses once either boat has sailed: the crew is a record by then", async () => {
    const personId = await divemaster();
    const morning = await boat("Morning reef", 8);
    const afternoon = await boat("Afternoon wreck", 13);
    await changeTripCrewOutcome(ctx.db, ctx.shop.id, morning.id, { operation: "assign", personId });
    const move = { personId, fromTripId: morning.id, toTripId: afternoon.id };
    expect(await moveTripCrewMember(ctx.db, ctx.shop.id, move, { now: at(11) })).toEqual({
      ok: false,
      refusal: "departed",
    });
    expect(await getTripCrewAssignments(ctx.db, ctx.shop.id, morning.id)).toHaveLength(1);
  });

  it("refuses someone not on the first crew, the same boat, and another shop", async () => {
    const personId = await divemaster();
    const morning = await boat("Morning reef", 8);
    const afternoon = await boat("Afternoon wreck", 13);
    const move = { personId, fromTripId: morning.id, toTripId: afternoon.id };
    expect(await moveTripCrewMember(ctx.db, ctx.shop.id, move)).toEqual({
      ok: false,
      refusal: "not_on_crew",
    });
    expect(
      await moveTripCrewMember(ctx.db, ctx.shop.id, { ...move, toTripId: morning.id }),
    ).toEqual({ ok: false, refusal: "same_departure" });
    await changeTripCrewOutcome(ctx.db, ctx.shop.id, morning.id, { operation: "assign", personId });
    expect(
      await moveTripCrewMember(ctx.db, "00000000-0000-4000-8000-000000000099", move),
    ).toMatchObject({ ok: false });
  });

  it("warns, after the move, that the crew member holds a seat on an overlapping boat", async () => {
    const personId = await divemaster();
    const morning = await boat("Morning reef", 8);
    const afternoon = await boat("Afternoon wreck", 13);
    const diving = await boat("Afternoon drift", 14);
    await changeTripCrewOutcome(ctx.db, ctx.shop.id, morning.id, { operation: "assign", personId });
    const seat = await createBooking(ctx.db, {
      actor: "staff",
      shopId: ctx.shop.id,
      tripId: diving.id,
      personId,
    });
    expect(seat).toMatchObject({ ok: true });
    expect(
      await personClashesAfterMove(ctx.db, ctx.shop.id, afternoon.id, personId, at(0)),
    ).toEqual([]);
    await moveTripCrewMember(ctx.db, ctx.shop.id, {
      personId,
      fromTripId: morning.id,
      toTripId: afternoon.id,
    });
    expect(
      await personClashesAfterMove(ctx.db, ctx.shop.id, afternoon.id, personId, at(0)),
    ).toEqual([expect.objectContaining({ here: "crew", there: "diver", otherTripId: diving.id })]);
    // A called-off boat holds nobody's afternoon.
    await setTripStatus(ctx.db, ctx.shop.id, diving.id, "cancelled");
    expect(
      (await personClashesByTrip(ctx.db, ctx.shop.id, [afternoon.id], at(0))).get(afternoon.id),
    ).toBeUndefined();
    // The move wrote no activity line of its own: the action records it.
    const lines = await ctx.db
      .select({ code: activityEvents.code })
      .from(activityEvents)
      .where(eq(activityEvents.tripId, afternoon.id));
    expect(lines.filter((line) => line.code === "crew_assigned")).toEqual([]);
  });
});

describe("listCrewMoveTargets", () => {
  it("lists the shop's other running boats in the window, earliest first", async () => {
    const morning = await boat("Morning reef", 8);
    const afternoon = await boat("Afternoon wreck", 13);
    const night = await boat("Night dive", 19);
    const nextDay = await createTrip(ctx.db, {
      shopId: ctx.shop.id,
      title: "Tomorrow",
      startsAt: new Date("2030-09-15T08:00:00Z"),
      endsAt: new Date("2030-09-15T11:00:00Z"),
      capacity: 8,
    });
    await setTripStatus(ctx.db, ctx.shop.id, night.id, "cancelled");
    const targets = await listCrewMoveTargets(
      ctx.db,
      ctx.shop.id,
      morning.id,
      { from: at(0), to: new Date("2030-09-15T00:00:00Z") },
      at(0),
    );
    const ids = targets.map((target) => target.id);
    expect(ids).toContain(afternoon.id);
    expect(ids).not.toContain(morning.id);
    expect(ids).not.toContain(night.id);
    expect(ids).not.toContain(nextDay?.id);
    // Once a boat has left it is no longer somewhere to move to.
    expect(
      (
        await listCrewMoveTargets(
          ctx.db,
          ctx.shop.id,
          morning.id,
          { from: at(0), to: new Date("2030-09-15T00:00:00Z") },
          at(15),
        )
      ).map((target) => target.id),
    ).not.toContain(afternoon.id);
  });
});
