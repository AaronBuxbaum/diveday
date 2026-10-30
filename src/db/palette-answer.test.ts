import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { paletteAnswerFacts } from "./palette-answer";
import { searchShop } from "./search";
import { createTrip, listStaff, setTripCrew, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

/** ADR 20260906-before-you-ask, decision 3: the card's facts come from the home's own readers. */
describe("paletteAnswerFacts", () => {
  it("finds the departure a diver is next on, with the readiness the roster shows", async () => {
    const results = await searchShop(ctx.db, ctx.shop.id, "priya", ctx.shop.timezone, "en-US");
    const [priya] = results.divers;
    if (!priya) throw new Error("seed has no Priya");
    const facts = await paletteAnswerFacts(ctx.db, {
      shopId: ctx.shop.id,
      naming: { kind: "diver", personId: priya.id, fullName: priya.fullName },
      timeZone: ctx.shop.timezone,
    });
    expect(facts?.kind).toBe("diver");
    if (facts?.kind !== "diver") return;
    expect(facts.fullName).toBe(priya.fullName);
    if (facts.next) {
      expect(["ready", "blocked"]).toContain(facts.next.status);
      expect(facts.next.tripTitle.length).toBeGreaterThan(0);
    }
  });

  it("counts a day's board and names its crew once each", async () => {
    const [first] = await upcomingTripsWithCounts(ctx.db, ctx.shop.id);
    if (!first) throw new Error("seed has no upcoming trip");
    const date = calendarDateInTimezone(first.startsAt, ctx.shop.timezone);
    const facts = await paletteAnswerFacts(ctx.db, {
      shopId: ctx.shop.id,
      naming: { kind: "day", date },
      timeZone: ctx.shop.timezone,
    });
    expect(facts?.kind).toBe("day");
    if (facts?.kind !== "day") return;
    expect(facts.departures).toBeGreaterThanOrEqual(1);
    expect(facts.divers).toBeGreaterThanOrEqual(first.booked);
    expect(new Set(facts.crew).size).toBe(facts.crew.length);
    const empty = await paletteAnswerFacts(ctx.db, {
      shopId: ctx.shop.id,
      naming: { kind: "day", date: "2099-01-01" },
      timeZone: ctx.shop.timezone,
    });
    expect(empty).toEqual({ kind: "day", date: "2099-01-01", departures: 0, divers: 0, crew: [] });
  });

  it("counts a departure's seats and blocked divers, and knows no other shop's departure", async () => {
    const [first] = await upcomingTripsWithCounts(ctx.db, ctx.shop.id);
    if (!first) throw new Error("seed has no upcoming trip");
    const facts = await paletteAnswerFacts(ctx.db, {
      shopId: ctx.shop.id,
      naming: { kind: "departure", tripId: first.id },
      timeZone: ctx.shop.timezone,
    });
    expect(facts).toMatchObject({
      kind: "departure",
      tripId: first.id,
      title: first.title,
      capacity: first.sellableCapacity,
      booked: first.booked,
    });
    if (facts?.kind === "departure") expect(facts.blocked).toBeLessThanOrEqual(facts.booked);
    expect(
      await paletteAnswerFacts(ctx.db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        naming: { kind: "departure", tripId: first.id },
        timeZone: ctx.shop.timezone,
      }),
    ).toBeNull();
  });

  it("reports the boat's remaining passenger capacity after assigned crew", async () => {
    const boat = await createBoat(ctx.db, ctx.shop.id, "Eight total occupants", 8);
    const startsAt = new Date("2031-08-01T12:00:00Z");
    const trip = await createTrip(ctx.db, {
      shopId: ctx.shop.id,
      title: "Crew-reserved palette departure",
      startsAt,
      endsAt: new Date("2031-08-01T16:00:00Z"),
      capacity: 10,
      boatId: boat.id,
    });
    if (!trip) throw new Error("capacity trip not created");
    const staff = await listStaff(ctx.db, ctx.shop.id);
    if (staff.length < 2) throw new Error("two seeded staff members are required");
    expect(
      await setTripCrew(
        ctx.db,
        ctx.shop.id,
        trip.id,
        staff.slice(0, 2).map(({ person }) => person.id),
      ),
    ).toBe(true);

    const facts = await paletteAnswerFacts(ctx.db, {
      shopId: ctx.shop.id,
      naming: { kind: "departure", tripId: trip.id },
      timeZone: ctx.shop.timezone,
    });
    expect(facts).toMatchObject({ kind: "departure", tripId: trip.id, capacity: 6, booked: 0 });
  });
});
