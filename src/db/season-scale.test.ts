// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seasonStartInstant } from "@/lib/season";
import { seededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { bookings, people, shops, trips } from "./schema";
import { seasonScale } from "./season-scale";
import { createTrip } from "./trips";

/**
 * **The season's scale** — ADR 20260904-reef-all-the-way-down, Budget rule 3.
 *
 * Every case here is about what the count must *not* include, because a fact
 * of scale that is wrong is worse than one that never renders: the shop reads
 * "your 400th diver" and knows it is not.
 */
const ZONE = "America/New_York";
// 09:30 in New York, so the shop day runs 04:00Z to 04:00Z the next day.
const NOW = new Date("2026-07-21T13:30:00.000Z");
const SEASON = seasonStartInstant(NOW, ZONE, { month: 1, day: 1 });

async function freshShop(slug: string) {
  const db = await seededTestDb();
  const [shop] = await db
    .insert(shops)
    .values({ name: `Shop ${slug}`, slug, timezone: ZONE })
    .returning();
  if (!shop) throw new Error("test shop insert failed");
  return { db, shopId: shop.id };
}

async function aDeparture(db: AppDb, shopId: string, startsAt: Date) {
  const trip = await createTrip(db, {
    shopId,
    title: "Two-Tank Reef",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
    capacity: 12,
    plannedDives: 2,
  });
  if (!trip) throw new Error("test trip insert failed");
  return trip;
}

async function aSeat(
  db: AppDb,
  shopId: string,
  tripId: string,
  fullName: string,
  status: "booked" | "checked_in" | "cancelled" | "no_show" = "booked",
) {
  const [person] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!person) throw new Error("test person insert failed");
  await db.insert(bookings).values({ shopId, tripId, personId: person.id, status });
}

const scale = (db: AppDb, shopId: string) => seasonScale(db, shopId, ZONE, SEASON, NOW);

describe("seasonScale", () => {
  it("counts nothing for a shop with no departures", async () => {
    const { db, shopId } = await freshShop("season-empty");
    expect(await scale(db, shopId)).toEqual({
      seatsBefore: 0,
      todaySeats: [],
      firstBoatOfSeason: false,
    });
  });

  it("counts this season's earlier seats and leaves today's out of them", async () => {
    const { db, shopId } = await freshShop("season-before");
    const earlier = await aDeparture(db, shopId, new Date("2026-06-10T14:00:00.000Z"));
    await aSeat(db, shopId, earlier.id, "Ada Lindqvist");
    await aSeat(db, shopId, earlier.id, "Hugo Marsh", "checked_in");
    const today = await aDeparture(db, shopId, new Date("2026-07-21T15:00:00.000Z"));
    await aSeat(db, shopId, today.id, "Ben Okafor");

    const result = await scale(db, shopId);
    expect(result.seatsBefore).toBe(2);
    expect(result.todaySeats).toEqual([
      { diverName: "Ben Okafor", departureAt: new Date("2026-07-21T15:00:00.000Z") },
    ]);
  });

  it("leaves out a seat that was cancelled or never showed", async () => {
    const { db, shopId } = await freshShop("season-cancelled");
    const earlier = await aDeparture(db, shopId, new Date("2026-06-10T14:00:00.000Z"));
    await aSeat(db, shopId, earlier.id, "Ada Lindqvist", "cancelled");
    await aSeat(db, shopId, earlier.id, "Hugo Marsh", "no_show");
    await aSeat(db, shopId, earlier.id, "Lina Costa");

    expect((await scale(db, shopId)).seatsBefore).toBe(1);
  });

  it("leaves out a departure the shop deleted", async () => {
    const { db, shopId } = await freshShop("season-deleted");
    const earlier = await aDeparture(db, shopId, new Date("2026-06-10T14:00:00.000Z"));
    await aSeat(db, shopId, earlier.id, "Ada Lindqvist");
    await db.update(trips).set({ deletedAt: NOW });

    const result = await scale(db, shopId);
    expect(result.seatsBefore).toBe(0);
    expect(result.firstBoatOfSeason).toBe(false);
  });

  it("leaves out a season that has not started yet", async () => {
    const { db, shopId } = await freshShop("season-before-start");
    const lastYear = await aDeparture(db, shopId, new Date("2025-11-02T14:00:00.000Z"));
    await aSeat(db, shopId, lastYear.id, "Ada Lindqvist");

    expect((await scale(db, shopId)).seatsBefore).toBe(0);
  });

  it("reads today's seats in boarding order", async () => {
    const { db, shopId } = await freshShop("season-order");
    const afternoon = await aDeparture(db, shopId, new Date("2026-07-21T18:00:00.000Z"));
    const morning = await aDeparture(db, shopId, new Date("2026-07-21T11:00:00.000Z"));
    await aSeat(db, shopId, afternoon.id, "Hugo Marsh");
    await aSeat(db, shopId, morning.id, "Ben Okafor");

    expect((await scale(db, shopId)).todaySeats.map((seat) => seat.diverName)).toEqual([
      "Ben Okafor",
      "Hugo Marsh",
    ]);
  });

  it("calls today's boat the season's first when nothing sailed before it", async () => {
    const { db, shopId } = await freshShop("season-first-boat");
    await aDeparture(db, shopId, new Date("2026-07-21T15:00:00.000Z"));
    expect((await scale(db, shopId)).firstBoatOfSeason).toBe(true);
  });

  it("does not, once anything sailed earlier this season", async () => {
    const { db, shopId } = await freshShop("season-not-first-boat");
    await aDeparture(db, shopId, new Date("2026-06-10T14:00:00.000Z"));
    await aDeparture(db, shopId, new Date("2026-07-21T15:00:00.000Z"));
    expect((await scale(db, shopId)).firstBoatOfSeason).toBe(false);
  });

  it("does, when the only earlier departures fall before the season started", async () => {
    const { db, shopId } = await freshShop("season-first-after-break");
    await aDeparture(db, shopId, new Date("2025-11-02T14:00:00.000Z"));
    await aDeparture(db, shopId, new Date("2026-07-21T15:00:00.000Z"));
    expect((await scale(db, shopId)).firstBoatOfSeason).toBe(true);
  });

  it("says no first boat on a day with no departure at all", async () => {
    const { db, shopId } = await freshShop("season-no-boat-today");
    await aDeparture(db, shopId, new Date("2026-07-25T15:00:00.000Z"));
    expect((await scale(db, shopId)).firstBoatOfSeason).toBe(false);
  });

  it("refuses a season start the calendar does not have", async () => {
    const { db, shopId } = await freshShop("season-check-constraint");
    await expect(
      db.update(shops).set({ seasonStartMonth: 2, seasonStartDay: 30 }),
    ).rejects.toThrow();
    expect(shopId).toBeTruthy();
  });
});
