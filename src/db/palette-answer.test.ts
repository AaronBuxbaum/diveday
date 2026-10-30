import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { HOUR_MS } from "@/lib/clock";
import { shopDaysBounds } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { createBoat } from "./boats";
import { paletteAnswerFacts } from "./palette-answer";
import { bookings, people, shops, trips } from "./schema";
import { searchShop } from "./search";
import {
  createTrip,
  listStaff,
  setTripCrew,
  setTripStatus,
  upcomingTripsWithCounts,
} from "./trips";

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

  it("bounds the named day and preserves the inclusive grace, held seats, and staff-only rows", async () => {
    const { db } = ctx;
    const timeZone = "America/New_York";
    const date = "2031-11-02";
    const now = new Date("2031-11-02T13:00:00.000Z");
    const lowerBound = new Date(now.getTime() - HOUR_MS);
    const [shop] = await db
      .insert(shops)
      .values({ name: "Palette answer", slug: "palette-answer-day", timezone: timeZone })
      .returning();
    if (!shop) throw new Error("palette fixture shop not created");

    const makeTrip = async (
      title: string,
      startsAt: Date,
      options: { isPrivate?: boolean; isRehearsal?: boolean } = {},
    ) => {
      const trip = await createTrip(db, {
        shopId: shop.id,
        title,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR_MS),
        capacity: 8,
        ...options,
      });
      if (!trip) throw new Error(`trip not created: ${title}`);
      return trip;
    };

    const atCutoff = await makeTrip("Palette at cutoff", lowerBound);
    await makeTrip("Palette just before cutoff", new Date(lowerBound.getTime() - 1));
    await makeTrip("Palette later", new Date("2031-11-02T12:30:00.000Z"));
    await makeTrip("Palette private", new Date("2031-11-02T13:00:00.000Z"), {
      isPrivate: true,
    });
    await makeTrip("Palette rehearsal", new Date("2031-11-02T14:00:00.000Z"), {
      isRehearsal: true,
    });
    const cancelled = await makeTrip("Palette cancelled", new Date("2031-11-02T15:00:00.000Z"));
    const deleted = await makeTrip("Palette deleted", new Date("2031-11-02T16:00:00.000Z"));
    const { to } = shopDaysBounds(date, date, timeZone);
    await makeTrip("Palette next day boundary", to);
    await setTripStatus(db, shop.id, cancelled.id, "cancelled");
    await db.update(trips).set({ deletedAt: now }).where(eq(trips.id, deleted.id));

    const peopleRows = await db
      .insert(people)
      .values(
        Array.from({ length: 5 }, (_, index) => ({
          shopId: shop.id,
          fullName: `Palette diver ${index}`,
          email: `palette-diver-${index}@example.test`,
        })),
      )
      .returning({ id: people.id });
    if (peopleRows.length !== 5) throw new Error("five palette fixture people not created");
    const [diver, snorkeler, rider, cancelledDiver, noShowDiver] = peopleRows;
    if (!diver || !snorkeler || !rider || !cancelledDiver || !noShowDiver) {
      throw new Error("five palette fixture people not created");
    }
    await db.insert(bookings).values([
      {
        shopId: shop.id,
        tripId: atCutoff.id,
        personId: diver.id,
        bookedAs: "diver",
        participantType: "diver",
        status: "booked",
      },
      {
        shopId: shop.id,
        tripId: atCutoff.id,
        personId: snorkeler.id,
        bookedAs: "snorkeler",
        participantType: "snorkeler",
        status: "checked_in",
      },
      {
        shopId: shop.id,
        tripId: atCutoff.id,
        personId: rider.id,
        bookedAs: "rider",
        participantType: "rider",
        status: "booked",
      },
      {
        shopId: shop.id,
        tripId: atCutoff.id,
        personId: cancelledDiver.id,
        bookedAs: "diver",
        participantType: "diver",
        status: "cancelled",
      },
      {
        shopId: shop.id,
        tripId: atCutoff.id,
        personId: noShowDiver.id,
        bookedAs: "diver",
        participantType: "diver",
        status: "no_show",
      },
    ]);

    const otherShops = await db
      .insert(shops)
      .values({ name: "Palette other shop", slug: "palette-answer-other", timezone: timeZone })
      .returning();
    const [otherShop] = otherShops;
    if (!otherShop) throw new Error("other palette fixture shop not created");
    await createTrip(db, {
      shopId: otherShop.id,
      title: "Other tenant same day",
      startsAt: new Date("2031-11-02T12:30:00.000Z"),
      endsAt: new Date("2031-11-02T13:30:00.000Z"),
      capacity: 8,
    });

    const facts = await paletteAnswerFacts(db, {
      shopId: shop.id,
      naming: { kind: "day", date },
      timeZone,
      now,
    });
    const legacyRows = (await upcomingTripsWithCounts(db, shop.id, now)).filter(
      (trip) => calendarDateInTimezone(trip.startsAt, timeZone) === date,
    );
    expect(facts).toEqual({
      kind: "day",
      date,
      departures: legacyRows.length,
      divers: legacyRows.reduce((sum, trip) => sum + trip.booked, 0),
      crew: [],
    });
    expect(facts).toMatchObject({ kind: "day", departures: 4, divers: 3 });
  });

  it.each([
    {
      date: "2026-03-08",
      timeZone: "America/New_York",
      from: "2026-03-08T05:00:00.000Z",
      to: "2026-03-09T04:00:00.000Z",
    },
    {
      date: "2026-11-01",
      timeZone: "America/New_York",
      from: "2026-11-01T04:00:00.000Z",
      to: "2026-11-02T05:00:00.000Z",
    },
    {
      date: "2026-09-06",
      timeZone: "America/Santiago",
      from: "2026-09-06T04:00:00.000Z",
      to: "2026-09-07T03:00:00.000Z",
    },
    {
      date: "2026-10-25",
      timeZone: "Atlantic/Azores",
      from: "2026-10-25T00:00:00.000Z",
      to: "2026-10-26T01:00:00.000Z",
    },
  ])(
    "uses independently pinned local-midnight edges for $timeZone on $date",
    async ({ date, timeZone, from: expectedFrom, to: expectedTo }) => {
      const { db } = ctx;
      const [shop] = await db
        .insert(shops)
        .values({ name: "Palette DST", slug: `palette-dst-${date}`, timezone: timeZone })
        .returning();
      if (!shop) throw new Error("palette DST fixture shop not created");
      const { from, to } = shopDaysBounds(date, date, timeZone);
      expect(from.toISOString()).toBe(expectedFrom);
      expect(to.toISOString()).toBe(expectedTo);

      const makeTrip = async (title: string, startsAt: Date) => {
        const trip = await createTrip(db, {
          shopId: shop.id,
          title,
          startsAt,
          endsAt: new Date(startsAt.getTime() + HOUR_MS),
          capacity: 4,
        });
        if (!trip) throw new Error(`trip not created: ${title}`);
        return trip;
      };
      await makeTrip("Before local midnight", new Date(from.getTime() - 1));
      await makeTrip("At local midnight", from);
      await makeTrip("Last millisecond of local day", new Date(to.getTime() - 1));
      await makeTrip("Next local midnight", to);

      const now = new Date(from.getTime() - 2 * HOUR_MS);
      const facts = await paletteAnswerFacts(db, {
        shopId: shop.id,
        naming: { kind: "day", date },
        timeZone,
        now,
      });
      const legacyRows = (await upcomingTripsWithCounts(db, shop.id, now)).filter(
        (trip) => calendarDateInTimezone(trip.startsAt, timeZone) === date,
      );
      expect(facts).toEqual({
        kind: "day",
        date,
        departures: legacyRows.length,
        divers: legacyRows.reduce((sum, trip) => sum + trip.booked, 0),
        crew: [],
      });
      expect(facts).toEqual({ kind: "day", date, departures: 2, divers: 0, crew: [] });
    },
  );

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
