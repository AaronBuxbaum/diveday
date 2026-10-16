// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { crewTipShare, tipsByDeparture } from "./crew-tips";
import { boats, bookings, people, shops, tips, tripAssignments, trips } from "./schema";

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
