// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { crewMonth, crewTipShare, tipsByDeparture } from "./crew-tips";
import {
  boats,
  bookings,
  executedDives,
  people,
  shops,
  tips,
  tripAssignments,
  tripDives,
  tripScheduleDays,
  trips,
} from "./schema";

/** Built on a bare shop so every figure is exact. */
const WEEK = { from: new Date("2026-10-05T00:00:00Z"), to: new Date("2026-10-12T00:00:00Z") };

async function bareShop(db: AppDb) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Tip Reef", slug: `crew-tips-${randomUUID()}`, timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return shop;
}

async function person(db: AppDb, shopId: string, fullName: string) {
  const [row] = await db.insert(people).values({ shopId, fullName }).returning();
  if (!row) throw new Error("person insert failed");
  return row;
}

async function departure(
  db: AppDb,
  shopId: string,
  input: { title: string; startsAt: string; boatId?: string; deletedAt?: Date },
) {
  const startsAt = new Date(input.startsAt);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      title: input.title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      boatId: input.boatId ?? null,
      deletedAt: input.deletedAt ?? null,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  return trip;
}

async function tipOn(
  db: AppDb,
  shopId: string,
  tripId: string,
  amountCents: number,
  status: "paid" | "pending" | "expired" = "paid",
) {
  const diver = await person(db, shopId, "Tipping Diver");
  const [booking] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId, tripId, personId: diver.id })
    .returning();
  if (!booking) throw new Error("booking insert failed");
  await db.insert(tips).values({
    shopId,
    bookingId: booking.id,
    status,
    stripeAccountId: "acct_test",
    stripeSessionId: `cs_${randomUUID()}`,
    currency: "usd",
    amountCents,
  });
}

describe("crewTipShare", () => {
  it("sums the reader's share of the paid tips on this week's boats they crewed, and nobody else's", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await person(db, shop.id, "Ana Reyes");
    const ben = await person(db, shop.id, "Ben Okafor");
    const monday = await departure(db, shop.id, {
      title: "Reef",
      startsAt: "2026-10-06T13:00:00Z",
    });
    const friday = await departure(db, shop.id, {
      title: "Wreck",
      startsAt: "2026-10-09T13:00:00Z",
    });
    const lastWeek = await departure(db, shop.id, {
      title: "Reef",
      startsAt: "2026-10-01T13:00:00Z",
    });
    const deleted = await departure(db, shop.id, {
      title: "Reef",
      startsAt: "2026-10-07T13:00:00Z",
      deletedAt: new Date("2026-10-07T00:00:00Z"),
    });
    await db.insert(tripAssignments).values([
      { tripId: monday.id, personId: ana.id },
      { tripId: friday.id, personId: ana.id },
      { tripId: lastWeek.id, personId: ana.id },
      { tripId: deleted.id, personId: ana.id },
      { tripId: friday.id, personId: ben.id },
    ]);
    await tipOn(db, shop.id, monday.id, 8_000);
    await tipOn(db, shop.id, friday.id, 6_000);
    await tipOn(db, shop.id, friday.id, 2_500, "pending");
    await tipOn(db, shop.id, lastWeek.id, 9_900);
    await tipOn(db, shop.id, deleted.id, 1_000);

    // Ana crewed Monday alone and Friday with Ben: all of $80, and half of $60.
    expect(await crewTipShare(db, shop.id, ana.id, WEEK)).toBe(8_000 + 3_000);
    expect(await crewTipShare(db, shop.id, ben.id, WEEK)).toBe(3_000);
    // Another shop asking about Ana sees nothing.
    const other = await bareShop(db);
    expect(await crewTipShare(db, other.id, ana.id, WEEK)).toBe(0);
  });

  it("splits an odd amount the way the crew sheet does, and a captain sees only their own boats", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const ana = await person(db, shop.id, "Ana Reyes");
    const ben = await person(db, shop.id, "Ben Okafor");
    const cai = await person(db, shop.id, "Cai Lund");
    const shared = await departure(db, shop.id, {
      title: "Reef",
      startsAt: "2026-10-06T13:00:00Z",
    });
    const others = await departure(db, shop.id, {
      title: "Wreck",
      startsAt: "2026-10-07T13:00:00Z",
    });
    await db.insert(tripAssignments).values([
      { tripId: shared.id, personId: ana.id },
      { tripId: shared.id, personId: ben.id },
      { tripId: shared.id, personId: cai.id },
      { tripId: others.id, personId: ben.id },
    ]);
    await tipOn(db, shop.id, shared.id, 10_000);
    await tipOn(db, shop.id, others.id, 7_700);
    const shares = [
      await crewTipShare(db, shop.id, ana.id, WEEK),
      await crewTipShare(db, shop.id, ben.id, WEEK),
      await crewTipShare(db, shop.id, cai.id, WEEK),
    ];
    // Three ways: 3,334 / 3,333 / 3,333 by person id, so the pieces add back to the boat.
    expect(shares[0]).toBeGreaterThanOrEqual(3_333);
    expect(shares[0]).toBeLessThanOrEqual(3_334);
    expect((shares[1] ?? 0) - 7_700).toBeGreaterThanOrEqual(3_333);
    expect(shares[0] + (shares[1] ?? 0) - 7_700 + (shares[2] ?? 0)).toBe(10_000);
    // Ana never reads Ben's Wreck tips.
    expect(shares[0]).toBeLessThan(5_000);
  });
});

describe("tipsByDeparture", () => {
  it("lists each departure's paid tips in clock order, named by its boat when it has one", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const [hull] = await db
      .insert(boats)
      .values({ shopId: shop.id, name: "Manta", capacity: 12 })
      .returning();
    if (!hull) throw new Error("boat insert failed");
    const afternoon = await departure(db, shop.id, {
      title: "Wreck",
      startsAt: "2026-10-09T18:00:00Z",
    });
    const morning = await departure(db, shop.id, {
      title: "Reef",
      startsAt: "2026-10-09T13:00:00Z",
      boatId: hull.id,
    });
    const quiet = await departure(db, shop.id, {
      title: "Night",
      startsAt: "2026-10-09T23:00:00Z",
    });
    await tipOn(db, shop.id, afternoon.id, 6_000);
    await tipOn(db, shop.id, morning.id, 5_000);
    await tipOn(db, shop.id, morning.id, 3_000);
    await tipOn(db, shop.id, quiet.id, 4_000, "expired");

    const rows = await tipsByDeparture(db, shop.id, WEEK);
    expect(rows.map(({ label, cents }) => ({ label, cents }))).toEqual([
      { label: "Manta", cents: 8_000 },
      { label: "Wreck", cents: 6_000 },
    ]);
  });
});

describe("crewMonth (fifth-loop ideas, item 51)", () => {
  const MONTH = { from: new Date("2026-10-01T00:00:00Z"), now: new Date("2026-10-16T12:00:00Z") };

  it("counts the boats this person crewed that came back this month, their dives and hours", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const keiko = await person(db, shop.id, "Keiko Tanaka");
    const other = await person(db, shop.id, "Rafa Ortiz");
    // Logged two dives: the log wins over the plan's three.
    const logged = await departure(db, shop.id, {
      title: "Wall",
      startsAt: "2026-10-03T13:00:00Z",
    });
    // Nothing logged: the plan's two dives count.
    const planned = await departure(db, shop.id, {
      title: "Reef",
      startsAt: "2026-10-10T13:00:00Z",
    });
    // Not this month, still out, deleted, or not hers: none of these count.
    const september = await departure(db, shop.id, {
      title: "Old",
      startsAt: "2026-09-28T13:00:00Z",
    });
    const stillOut = await departure(db, shop.id, {
      title: "Out",
      startsAt: "2026-10-16T10:00:00Z",
    });
    const deleted = await departure(db, shop.id, {
      title: "Gone",
      startsAt: "2026-10-05T13:00:00Z",
      deletedAt: new Date("2026-10-04T00:00:00Z"),
    });
    const notHers = await departure(db, shop.id, {
      title: "Theirs",
      startsAt: "2026-10-06T13:00:00Z",
    });
    for (const trip of [logged, planned, september, stillOut, deleted]) {
      await db.insert(tripAssignments).values({ tripId: trip.id, personId: keiko.id });
    }
    await db.insert(tripAssignments).values({ tripId: notHers.id, personId: other.id });
    await db.insert(tripDives).values([
      { tripId: logged.id, diveNumber: 1 },
      { tripId: logged.id, diveNumber: 2 },
      { tripId: logged.id, diveNumber: 3 },
      { tripId: planned.id, diveNumber: 1 },
      { tripId: planned.id, diveNumber: 2 },
    ]);
    await db.insert(executedDives).values([
      { shopId: shop.id, tripId: logged.id, diveNumber: 1 },
      { shopId: shop.id, tripId: logged.id, diveNumber: 2 },
    ]);

    expect(await crewMonth(db, shop.id, keiko.id, MONTH)).toEqual({
      boats: 2,
      dives: 4,
      minutes: 8 * 60,
    });
  });

  /**
   * Dive-domain review of layer r5-4, fix 3 and note 10: the month line is a
   * working record pros copy from, so a departure that never ran is not a
   * boat, a deleted log is not a dive, and a liveaboard counts the hours its
   * days ran rather than the nights between them.
   */
  it("counts a called-off departure only when the crew logged a live dive on it", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const keiko = await person(db, shop.id, "Keiko Tanaka");
    const blownOut = await departure(db, shop.id, {
      title: "Blown out",
      startsAt: "2026-10-03T13:00:00Z",
    });
    const calledAfterOne = await departure(db, shop.id, {
      title: "Called after one",
      startsAt: "2026-10-04T13:00:00Z",
    });
    const deletedLogOnly = await departure(db, shop.id, {
      title: "Deleted log",
      startsAt: "2026-10-05T13:00:00Z",
    });
    for (const trip of [blownOut, calledAfterOne, deletedLogOnly]) {
      await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
      await db.insert(tripAssignments).values({ tripId: trip.id, personId: keiko.id });
      await db.insert(tripDives).values([
        { tripId: trip.id, diveNumber: 1 },
        { tripId: trip.id, diveNumber: 2 },
      ]);
    }
    await db.insert(executedDives).values([
      { shopId: shop.id, tripId: calledAfterOne.id, diveNumber: 1 },
      {
        shopId: shop.id,
        tripId: deletedLogOnly.id,
        diveNumber: 1,
        deletedAt: new Date("2026-10-06T00:00:00Z"),
      },
    ]);

    expect(await crewMonth(db, shop.id, keiko.id, MONTH)).toEqual({
      boats: 1,
      dives: 1,
      minutes: 4 * 60,
    });
  });

  it("counts no deleted log as a dive, falling back to the plan", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const keiko = await person(db, shop.id, "Keiko Tanaka");
    const reef = await departure(db, shop.id, { title: "Reef", startsAt: "2026-10-03T13:00:00Z" });
    await db.insert(tripAssignments).values({ tripId: reef.id, personId: keiko.id });
    await db.insert(tripDives).values([
      { tripId: reef.id, diveNumber: 1 },
      { tripId: reef.id, diveNumber: 2 },
    ]);
    await db.insert(executedDives).values({
      shopId: shop.id,
      tripId: reef.id,
      diveNumber: 1,
      deletedAt: new Date("2026-10-04T00:00:00Z"),
    });

    expect((await crewMonth(db, shop.id, keiko.id, MONTH)).dives).toBe(2);
  });

  it("counts a multi-day departure's scheduled days, not the nights between them", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const keiko = await person(db, shop.id, "Keiko Tanaka");
    const [trip] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Liveaboard",
        startsAt: new Date("2026-10-07T12:00:00Z"),
        endsAt: new Date("2026-10-09T20:00:00Z"),
        capacity: 8,
      })
      .returning();
    if (!trip) throw new Error("trip insert failed");
    await db.insert(tripAssignments).values({ tripId: trip.id, personId: keiko.id });
    await db.insert(tripScheduleDays).values(
      [7, 8, 9].map((day, index) => ({
        tripId: trip.id,
        dayNumber: index + 1,
        startsAt: new Date(`2026-10-0${day}T12:00:00Z`),
        endsAt: new Date(`2026-10-0${day}T20:00:00Z`),
      })),
    );

    expect((await crewMonth(db, shop.id, keiko.id, MONTH)).minutes).toBe(3 * 8 * 60);
  });

  it("is all zeros for someone who has not crewed this month", async () => {
    const db = await unseededTestDb();
    const shop = await bareShop(db);
    const keiko = await person(db, shop.id, "Keiko Tanaka");
    expect(await crewMonth(db, shop.id, keiko.id, MONTH)).toEqual({
      boats: 0,
      dives: 0,
      minutes: 0,
    });
  });
});
