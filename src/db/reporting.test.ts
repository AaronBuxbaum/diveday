// @vitest-environment node
import { describe, expect, it } from "vitest";
import { summarizeMonth } from "@/lib/reporting";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { getMonthlyReport } from "./reporting";
import {
  bookingPayments,
  bookings,
  type PaymentStatus,
  people,
  trips,
  waiverRecords,
} from "./schema";
import { getCurrentWaiverTemplate } from "./waivers";

type BookingStatus = "booked" | "checked_in" | "cancelled" | "no_show";

async function makePerson(db: AppDb, shopId: string, name: string): Promise<string> {
  const [row] = await db.insert(people).values({ shopId, fullName: name }).returning();
  if (!row) throw new Error("failed to insert person");
  return row.id;
}

async function makeTrip(
  db: AppDb,
  shopId: string,
  startsAt: Date,
  capacity: number,
  title = "Trip",
): Promise<string> {
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
      capacity,
    })
    .returning();
  if (!row) throw new Error("failed to insert trip");
  return row.id;
}

async function makeBooking(
  db: AppDb,
  shopId: string,
  tripId: string,
  personId: string,
  status: BookingStatus = "booked",
): Promise<string> {
  const [row] = await db.insert(bookings).values({ shopId, tripId, personId, status }).returning();
  if (!row) throw new Error("failed to insert booking");
  return row.id;
}

async function pay(
  db: AppDb,
  shopId: string,
  bookingId: string,
  status: PaymentStatus,
  amountCents: number,
): Promise<void> {
  await db.insert(bookingPayments).values({ shopId, bookingId, status, amountCents });
}

async function completeWaiverFor(
  db: AppDb,
  shopId: string,
  bookingId: string,
  personId: string,
  opts: { superseded?: boolean; token: string } = { token: "t" },
): Promise<void> {
  const template = await getCurrentWaiverTemplate(db, shopId);
  if (!template) throw new Error("seeded shop is missing a waiver template");
  await db.insert(waiverRecords).values({
    shopId,
    bookingId,
    personId,
    templateId: template.id,
    templateTitle: template.title,
    templateVersion: template.version,
    templateBody: template.body,
    status: "completed",
    tokenHash: `hash-${opts.token}`,
    expiresAt: new Date("2027-01-01T00:00:00Z"),
    signedAt: new Date("2026-06-05T00:00:00Z"),
    completedAt: new Date("2026-06-05T00:00:00Z"),
    supersededAt: opts.superseded ? new Date("2026-06-06T00:00:00Z") : null,
  });
}

// June 2026, expressed as its UTC-anchored window (the route converts the
// shop-local month; the query itself only sees the two instants).
const JUNE_START = new Date("2026-06-01T00:00:00Z");
const JULY_START = new Date("2026-07-01T00:00:00Z");

describe("getMonthlyReport", () => {
  it("buckets by trip departure, excludes cancellations, counts waivers, and sums collected money", async () => {
    const { db, shop } = await seededShopContext();

    // Eight fresh divers, so every booking is a distinct (trip, person) pair.
    const divers: string[] = [];
    for (let i = 0; i < 8; i++) divers.push(await makePerson(db, shop.id, `Diver ${i}`));

    // Trip A (June, 10 seats): 3 active bookings, 1 cancelled (not counted).
    const a = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
    const a0 = await makeBooking(db, shop.id, a, divers[0]);
    const a1 = await makeBooking(db, shop.id, a, divers[1]);
    await makeBooking(db, shop.id, a, divers[2]);
    await makeBooking(db, shop.id, a, divers[3], "cancelled");

    // Trip B (June, 6 seats): 6 active bookings — a sold-out boat.
    const b = await makeTrip(db, shop.id, new Date("2026-06-20T12:00:00Z"), 6, "Wreck");
    const bBookings: string[] = [];
    for (let i = 0; i < 6; i++) bBookings.push(await makeBooking(db, shop.id, b, divers[i]));

    // Trip C (May, out of window): must not appear at all.
    const c = await makeTrip(db, shop.id, new Date("2026-05-15T12:00:00Z"), 8, "May trip");
    const c0 = await makeBooking(db, shop.id, c, divers[0]);

    // Money: A has a paid + a deposit, B has one paid; C's paid is out of window.
    await pay(db, shop.id, a0, "paid", 18_000);
    await pay(db, shop.id, a1, "deposit_paid", 6_000);
    await pay(db, shop.id, bBookings[0], "paid", 20_000);
    await pay(db, shop.id, c0, "paid", 99_999);

    // Waivers: A has 2 of 3 complete (plus a superseded one that must not inflate);
    // B is fully signed.
    await completeWaiverFor(db, shop.id, a0, divers[0], { token: "a0" });
    await completeWaiverFor(db, shop.id, a1, divers[1], { token: "a1" });
    await completeWaiverFor(db, shop.id, a0, divers[0], { token: "a0-old", superseded: true });
    for (let i = 0; i < 6; i++) {
      await completeWaiverFor(db, shop.id, bBookings[i], divers[i], { token: `b${i}` });
    }

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);

    // Only the two June trips, never the May one.
    expect(report.trips.map((t) => t.title).sort()).toEqual(["Reef", "Wreck"]);

    const reef = report.trips.find((t) => t.title === "Reef");
    const wreck = report.trips.find((t) => t.title === "Wreck");
    expect(reef).toMatchObject({ capacity: 10, activeBookings: 3, waiverComplete: 2 });
    expect(wreck).toMatchObject({ capacity: 6, activeBookings: 6, waiverComplete: 6 });

    // 18000 + 6000 + 20000; the May paid booking is excluded.
    expect(report.revenueCents).toBe(44_000);

    // And the derived rollup the page renders.
    const summary = summarizeMonth(report);
    expect(summary.tripCount).toBe(2);
    expect(summary.seatsOffered).toBe(16);
    expect(summary.seatsBooked).toBe(9);
    expect(summary.atCapacityTrips).toBe(1);
    expect(summary.waiverComplete).toBe(8);
    expect(summary.waiverCompletion).toBeCloseTo(8 / 9);
  });

  it("keeps an empty trip in the denominator with a zero booking count", async () => {
    const { db, shop } = await seededShopContext();
    await makeTrip(db, shop.id, new Date("2026-06-12T12:00:00Z"), 12, "Empty June boat");

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
    const empty = report.trips.find((t) => t.title === "Empty June boat");
    expect(empty).toMatchObject({ capacity: 12, activeBookings: 0, waiverComplete: 0 });
  });

  it("is scoped to the shop and reports zeroes for a month with no trips", async () => {
    const { db, shop } = await seededShopContext();
    const report = await getMonthlyReport(
      db,
      shop.id,
      new Date("2020-01-01T00:00:00Z"),
      new Date("2020-02-01T00:00:00Z"),
    );
    expect(report.trips).toEqual([]);
    expect(report.revenueCents).toBe(0);
  });
});
