import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { comparableDepartures, getTripOpenSeatsDebrief } from "./open-seats";
import { bookings, people, shops, trips } from "./schema";
import { createTrip } from "./trips";

/**
 * The db half of the open-seats debrief (issue #1207, D47); the rules are
 * `src/lib/open-seats.test.ts`'s. This file pins which departure counts as
 * the comparable one, and that every read stays inside one shop.
 */

const ctx = fileScopedShopContext();
const NOW = new Date("2031-06-20T18:00:00Z");
const TITLE = "Open seats charter";

async function departure(
  db: AppDb,
  shopId: string,
  input: { daysAgo: number; capacity: number; booked: number; title?: string; priceCents?: number },
) {
  const startsAt = new Date(NOW.getTime() - input.daysAgo * DAY_MS);
  const trip = await createTrip(db, {
    shopId,
    title: input.title ?? TITLE,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: input.capacity,
    priceCents: input.priceCents ?? 10_000,
  });
  if (!trip) throw new Error("trip not created");
  for (let seat = 0; seat < input.booked; seat += 1) {
    const [person] = await db
      .insert(people)
      .values({ shopId, fullName: `Open Seat Diver ${seat}` })
      .returning({ id: people.id });
    if (!person) throw new Error("person not created");
    await db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId, tripId: trip.id, personId: person.id });
  }
  return trip;
}

describe("comparableDepartures", () => {
  it("is the most recent same-title departure that filled, before this one", async () => {
    const { db, shop } = ctx;
    const short = await departure(db, shop.id, { daysAgo: 1, capacity: 4, booked: 2 });
    await departure(db, shop.id, { daysAgo: 30, capacity: 2, booked: 2, priceCents: 8_000 });
    const recent = await departure(db, shop.id, { daysAgo: 10, capacity: 2, booked: 2 });
    await departure(db, shop.id, { daysAgo: 5, capacity: 3, booked: 2 }); // did not fill
    await departure(db, shop.id, { daysAgo: 4, capacity: 1, booked: 1, title: "Another trip" });
    const answer = await comparableDepartures(db, shop.id, [short]);
    expect(answer.get(short.id)).toEqual({
      title: TITLE,
      startsAt: recent.startsAt,
      samePrice: true,
    });
  });

  it("says when the comparable one was priced differently", async () => {
    const { db, shop } = ctx;
    const short = await departure(db, shop.id, { daysAgo: 1, capacity: 4, booked: 1 });
    await departure(db, shop.id, { daysAgo: 7, capacity: 1, booked: 1, priceCents: 8_000 });
    expect((await comparableDepartures(db, shop.id, [short])).get(short.id)?.samePrice).toBe(false);
  });

  it("looks back a season and no further, and never at a deleted or cancelled run", async () => {
    const { db, shop } = ctx;
    const short = await departure(db, shop.id, { daysAgo: 1, capacity: 4, booked: 1 });
    await departure(db, shop.id, { daysAgo: 120, capacity: 1, booked: 1 });
    const deleted = await departure(db, shop.id, { daysAgo: 3, capacity: 1, booked: 1 });
    await db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, deleted.id));
    const cancelled = await departure(db, shop.id, { daysAgo: 2, capacity: 1, booked: 1 });
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, cancelled.id));
    expect((await comparableDepartures(db, shop.id, [short])).get(short.id)).toBeNull();
  });

  it("never reaches into another shop's runs of the same title", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-open-seats", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const short = await departure(db, shop.id, { daysAgo: 1, capacity: 4, booked: 1 });
    await departure(db, other.id, { daysAgo: 7, capacity: 1, booked: 1 });
    expect((await comparableDepartures(db, shop.id, [short])).get(short.id)).toBeNull();
    expect(await getTripOpenSeatsDebrief(db, other.id, short.id, "UTC", NOW)).toBeNull();
  });

  it("answers an empty question with an empty map", async () => {
    expect((await comparableDepartures(ctx.db, ctx.shop.id, [])).size).toBe(0);
  });
});

describe("getTripOpenSeatsDebrief", () => {
  it("states the unsold seats, the deal that never went out and the comparable run", async () => {
    const { db, shop } = ctx;
    const short = await departure(db, shop.id, { daysAgo: 1, capacity: 4, booked: 1 });
    const filled = await departure(db, shop.id, { daysAgo: 7, capacity: 1, booked: 1 });
    const debrief = await getTripOpenSeatsDebrief(db, shop.id, short.id, "UTC", NOW);
    expect(debrief).toMatchObject({
      openSeats: 3,
      dealSent: false,
      comparable: { title: TITLE, startsAt: filled.startsAt, samePrice: true },
    });
  });

  it("has nothing to say about a departure that filled or has not sailed", async () => {
    const { db, shop } = ctx;
    const full = await departure(db, shop.id, { daysAgo: 1, capacity: 1, booked: 1 });
    const ahead = await departure(db, shop.id, { daysAgo: -2, capacity: 4, booked: 1 });
    expect(await getTripOpenSeatsDebrief(db, shop.id, full.id, "UTC", NOW)).toBeNull();
    expect(await getTripOpenSeatsDebrief(db, shop.id, ahead.id, "UTC", NOW)).toBeNull();
  });
});
