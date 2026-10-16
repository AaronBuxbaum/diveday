// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { crewMonth, crewTipsOnBoats, tipsByDeparture } from "./crew-tips";
import {
  boats,
  bookings,
  executedDives,
  people,
  shops,
  tips,
  tripAssignments,
  tripDives,
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

describe("crewTipsOnBoats", () => {
  it("sums the paid tips on this week's boats this person crewed, and nobody else's", async () => {
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

    expect(await crewTipsOnBoats(db, shop.id, ana.id, WEEK)).toBe(14_000);
    expect(await crewTipsOnBoats(db, shop.id, ben.id, WEEK)).toBe(6_000);
    // Another shop asking about Ana sees nothing.
    const other = await bareShop(db);
    expect(await crewTipsOnBoats(db, other.id, ana.id, WEEK)).toBe(0);
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
