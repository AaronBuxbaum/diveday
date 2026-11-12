import { describe, expect, it } from "vitest";
import { signDayWindows } from "@/lib/schedule-day-proof";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  createTrip,
  getTripCrewAssignments,
  getTripCrewIds,
  listStaff,
  moveTrip,
  setTripCrew,
  setTripStatus,
} from "./trips";
import { moveTripCrew } from "./trips-crew";

const ctx = fileScopedShopContext();

async function setup() {
  const { db, shop } = ctx;
  const person = (await listStaff(db, shop.id))[0]?.person;
  if (!person) throw new Error("expected staff");
  const makeTrip = (title: string, start: string, end: string) =>
    createTrip(db, {
      shopId: shop.id,
      title,
      startsAt: new Date(start),
      endsAt: new Date(end),
      capacity: 8,
    });
  const source = await makeTrip("Source", "2035-08-04T08:00:00Z", "2035-08-04T12:00:00Z");
  const target = await makeTrip("Target", "2035-08-04T09:00:00Z", "2035-08-04T13:00:00Z");
  if (!source || !target) throw new Error("expected departures");
  expect(
    await setTripCrew(db, shop.id, source.id, [{ personId: person.id, tripRole: "divemaster" }]),
  ).toBe(true);
  return { db, shop, person, source, target, makeTrip };
}

describe("moveTripCrew", () => {
  it("refuses a target overlapping the same person's diver booking", async () => {
    const { db, shop, person, source, target, makeTrip } = await setup();
    const other = await makeTrip("Other", "2035-08-04T12:00:00Z", "2035-08-04T14:00:00Z");
    if (!other) throw new Error("expected departure");
    const seat = await createBooking(db, {
      shopId: shop.id,
      tripId: other.id,
      actor: "staff",
      personId: person.id,
    });
    if (!seat.ok) throw new Error(seat.reason);
    expect(
      await moveTripCrew(db, {
        shopId: shop.id,
        fromTripId: source.id,
        toTripId: target.id,
        personId: person.id,
      }),
    ).toEqual({ ok: false, refusal: "crew_clash" });
    expect(await getTripCrewIds(db, shop.id, source.id)).toContain(person.id);
  });
  it("moves one crew member atomically between overlapping departures and refuses a repeated move", async () => {
    const { db, shop, person, source, target } = await setup();
    const input = {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      personId: person.id,
    };
    expect(await moveTripCrew(db, input)).toEqual({ ok: true });
    expect(await getTripCrewIds(db, shop.id, source.id)).not.toContain(person.id);
    expect(await getTripCrewIds(db, shop.id, target.id)).toContain(person.id);
    expect((await getTripCrewAssignments(db, shop.id, target.id))[0]?.tripRole).toBe("divemaster");
    expect((await moveTripCrew(db, input)).ok).toBe(false);
    expect(await getTripCrewIds(db, shop.id, target.id)).toEqual([person.id]);
  });

  it("leaves the source untouched when another departure conflicts", async () => {
    const { db, shop, person, source, target, makeTrip } = await setup();
    const other = await makeTrip("Other", "2035-08-04T12:00:00Z", "2035-08-04T14:00:00Z");
    if (!other) throw new Error("expected third departure");
    expect(await setTripCrew(db, shop.id, other.id, [person.id])).toBe(true);
    expect(
      await moveTripCrew(db, {
        shopId: shop.id,
        fromTripId: source.id,
        toTripId: target.id,
        personId: person.id,
      }),
    ).toEqual({ ok: false, refusal: "crew_clash" });
    expect(await getTripCrewIds(db, shop.id, source.id)).toContain(person.id);
    expect(await getTripCrewIds(db, shop.id, target.id)).not.toContain(person.id);
  });

  it("refuses a cancelled target and a foreign shop", async () => {
    const { db, shop, person, source, target } = await setup();
    await setTripStatus(db, shop.id, target.id, "cancelled");
    expect(
      (
        await moveTripCrew(db, {
          shopId: shop.id,
          fromTripId: source.id,
          toTripId: target.id,
          personId: person.id,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await moveTripCrew(db, {
          shopId: "00000000-0000-4000-8000-000000000099",
          fromTripId: source.id,
          toTripId: target.id,
          personId: person.id,
        })
      ).ok,
    ).toBe(false);
    expect(await getTripCrewIds(db, shop.id, source.id)).toContain(person.id);
  });

  it("refuses a destination rescheduled away from the day on screen", async () => {
    const { db, shop, person, source, target } = await setup();
    expect((await moveTrip(db, shop.id, target.id, new Date("2035-08-05T09:00:00Z"))).ok).toBe(
      true,
    );
    const moved = await moveTripCrew(db, {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      personId: person.id,
      expectedDay: { day: "2035-08-04", timeZone: "UTC" },
    });
    expect(moved.ok).toBe(false);
    expect(await getTripCrewIds(db, shop.id, source.id)).toContain(person.id);
  });

  it("refuses a same-day time change after the target was shown", async () => {
    const { db, shop, person, source, target } = await setup();
    const day = "2035-08-04";
    const fromProof = signDayWindows(shop.id, source.id, day, "UTC", [source]);
    const toProof = signDayWindows(shop.id, target.id, day, "UTC", [target]);
    expect((await moveTrip(db, shop.id, target.id, new Date("2035-08-04T15:00:00Z"))).ok).toBe(
      true,
    );
    const moved = await moveTripCrew(db, {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      personId: person.id,
      expectedDay: { day, timeZone: "UTC", fromProof, toProof },
    });
    expect(moved.ok).toBe(false);
    expect(await getTripCrewIds(db, shop.id, source.id)).toContain(person.id);
  });

  it("leaves crew on the source once the departures have sailed", async () => {
    const { db, shop, person, source, target } = await setup();
    const moved = await moveTripCrew(db, {
      shopId: shop.id,
      fromTripId: source.id,
      toTripId: target.id,
      personId: person.id,
      now: new Date("2035-08-05T00:00:00Z"),
    });
    expect(moved.ok).toBe(false);
    expect(await getTripCrewIds(db, shop.id, source.id)).toContain(person.id);
  });
});
