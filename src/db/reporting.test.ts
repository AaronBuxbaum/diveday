// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/authz";
import { summarizeMonth } from "@/lib/reporting";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { canPersonViewShopReports, getMonthlyReport } from "./reporting";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  type PaymentStatus,
  people,
  personRoles,
  trips,
  userAccounts,
  waiverRecords,
} from "./schema";
import { getCurrentWaiverTemplate } from "./waivers";

type BookingStatus = "booked" | "checked_in" | "cancelled" | "no_show";
type TripStatus = "scheduled" | "cancelled";

let seq = 0;

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
  status: TripStatus = "scheduled",
): Promise<string> {
  const [row] = await db
    .insert(trips)
    .values({
      shopId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
      capacity,
      status,
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

/** The booking's current payment row — one per booking (paid / deposit_paid / …). */
async function pay(
  db: AppDb,
  shopId: string,
  bookingId: string,
  status: PaymentStatus,
  amountCents: number,
): Promise<void> {
  await db.insert(bookingPayments).values({ shopId, bookingId, status, amountCents });
}

/** A completed deposit checkout covering one booking — the deposit a later balance overwrites. */
async function makeDepositCheckout(
  db: AppDb,
  shopId: string,
  tripId: string,
  bookingId: string,
  perDiverCents: number,
): Promise<void> {
  seq += 1;
  const [checkout] = await db
    .insert(bookingCheckouts)
    .values({
      shopId,
      tripId,
      status: "completed",
      isDeposit: true,
      stripeAccountId: "acct_test",
      stripeSessionId: `cs_${seq}`,
      amountPerDiverCents: perDiverCents,
      totalCents: perDiverCents,
    })
    .returning();
  if (!checkout) throw new Error("failed to insert checkout");
  await db.insert(bookingCheckoutBookings).values({ shopId, checkoutId: checkout.id, bookingId });
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
  it("buckets by departure, excludes cancellations, and sums cumulative collected money", async () => {
    const { db, shop } = await seededShopContext();

    const divers: string[] = [];
    for (let i = 0; i < 8; i++) divers.push(await makePerson(db, shop.id, `Diver ${i}`));

    // Trip A (June, 10 seats): 3 active bookings, 1 cancelled booking (not counted).
    const a = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
    const a0 = await makeBooking(db, shop.id, a, divers[0]);
    const a1 = await makeBooking(db, shop.id, a, divers[1]);
    const a2 = await makeBooking(db, shop.id, a, divers[2]);
    await makeBooking(db, shop.id, a, divers[3], "cancelled");

    // Trip B (June, 6 seats): 6 active bookings — a sold-out boat.
    const b = await makeTrip(db, shop.id, new Date("2026-06-20T12:00:00Z"), 6, "Wreck");
    const bBookings: string[] = [];
    for (let i = 0; i < 6; i++) bBookings.push(await makeBooking(db, shop.id, b, divers[i]));

    // Trip C (May, out of window) and Trip D (June but CANCELLED): neither counts.
    const c = await makeTrip(db, shop.id, new Date("2026-05-15T12:00:00Z"), 8, "May trip");
    const c0 = await makeBooking(db, shop.id, c, divers[0]);
    const d = await makeTrip(
      db,
      shop.id,
      new Date("2026-06-14T12:00:00Z"),
      8,
      "Scrubbed",
      "cancelled",
    );
    const d0 = await makeBooking(db, shop.id, d, divers[4]);

    // Money. a0: paid 18000. a1: a 6000 deposit checkout topped up by a 12000
    // balance, so the current row reads paid/12000 and the deposit must be
    // recovered → 18000. a2: a staff manual mark of 5000 (no order/checkout).
    // B's seat: paid 20000. C (May) and D (cancelled) each carry a payment that
    // must be excluded.
    await pay(db, shop.id, a0, "paid", 18_000);
    await makeDepositCheckout(db, shop.id, a, a1, 6_000);
    await pay(db, shop.id, a1, "paid", 12_000);
    await pay(db, shop.id, a2, "paid", 5_000);
    await pay(db, shop.id, bBookings[0], "paid", 20_000);
    await pay(db, shop.id, c0, "paid", 99_999);
    await pay(db, shop.id, d0, "paid", 55_555);

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);

    // Only the two live June trips — never the May one, never the cancelled one.
    expect(report.trips.map((t) => t.title).sort()).toEqual(["Reef", "Wreck"]);
    expect(report.trips.find((t) => t.title === "Reef")).toMatchObject({
      capacity: 10,
      activeBookings: 3,
    });
    expect(report.trips.find((t) => t.title === "Wreck")).toMatchObject({
      capacity: 6,
      activeBookings: 6,
    });

    // base 18000 + 12000 + 5000 + 20000 = 55000, plus the recovered 6000 deposit;
    // May and cancelled excluded.
    expect(report.revenueCents).toBe(61_000);

    const summary = summarizeMonth(report);
    expect(summary.tripCount).toBe(2);
    expect(summary.seatsOffered).toBe(16);
    expect(summary.seatsBooked).toBe(9);
    expect(summary.atCapacityTrips).toBe(1);
  });

  it("counts a waiver signed once as covering that diver's every booking (sign-once)", async () => {
    const { db, shop } = await seededShopContext();

    const divers: string[] = [];
    for (let i = 0; i < 8; i++) divers.push(await makePerson(db, shop.id, `Diver ${i}`));

    // Trip A: divers 0, 1, 2. Trip B: divers 0, 1, 3, 4, 5, 6 (note: not diver 2).
    const a = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
    const a0 = await makeBooking(db, shop.id, a, divers[0]);
    const a1 = await makeBooking(db, shop.id, a, divers[1]);
    await makeBooking(db, shop.id, a, divers[2]);

    const b = await makeTrip(db, shop.id, new Date("2026-06-20T12:00:00Z"), 6, "Wreck");
    const bDivers = [0, 1, 3, 4, 5, 6];
    const bBookings: Record<number, string> = {};
    for (const i of bDivers) bBookings[i] = await makeBooking(db, shop.id, b, divers[i]);

    // Diver 0 signed only on their B booking — it must still cover a0 on trip A.
    await completeWaiverFor(db, shop.id, bBookings[0], divers[0], { token: "d0-onB" });
    // Diver 1 signed on their A booking — must cover their B booking too.
    await completeWaiverFor(db, shop.id, a1, divers[1], { token: "d1-onA" });
    // Divers 3–6 signed on their own B bookings.
    for (const i of [3, 4, 5, 6]) {
      await completeWaiverFor(db, shop.id, bBookings[i], divers[i], { token: `d${i}` });
    }
    // Diver 2's only release is superseded — it must not count on trip A.
    await completeWaiverFor(db, shop.id, a0, divers[2], { token: "d2-old", superseded: true });

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
    const reef = report.trips.find((t) => t.title === "Reef");
    const wreck = report.trips.find((t) => t.title === "Wreck");
    // A: divers 0 (via B) and 1 (via A) covered; diver 2 only superseded → 2 of 3.
    expect(reef).toMatchObject({ activeBookings: 3, waiverComplete: 2 });
    // B: all six carry a current release, five of them signed on a different booking.
    expect(wreck).toMatchObject({ activeBookings: 6, waiverComplete: 6 });

    const summary = summarizeMonth(report);
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

describe("canPersonViewShopReports", () => {
  async function makeStaff(
    db: AppDb,
    shopId: string,
    role: Role,
    opts: { status?: "active" | "disabled"; deleted?: boolean } = {},
  ): Promise<string> {
    seq += 1;
    const [person] = await db
      .insert(people)
      .values({
        shopId,
        fullName: `Staff ${seq}`,
        deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
      })
      .returning();
    if (!person) throw new Error("failed to insert staff");
    await db.insert(personRoles).values({ personId: person.id, role });
    await db.insert(userAccounts).values({
      personId: person.id,
      email: `staff.${seq}@example.com`,
      hashedPassword: "x",
      status: opts.status ?? "active",
    });
    return person.id;
  }

  it("admits an active owner or manager and refuses the daily crew", async () => {
    const { db, shop } = await seededShopContext();
    const owner = await makeStaff(db, shop.id, "owner");
    const manager = await makeStaff(db, shop.id, "manager");
    const captain = await makeStaff(db, shop.id, "captain");

    expect(await canPersonViewShopReports(db, shop.id, owner)).toBe(true);
    expect(await canPersonViewShopReports(db, shop.id, manager)).toBe(true);
    expect(await canPersonViewShopReports(db, shop.id, captain)).toBe(false);
  });

  it("refuses a demoted, disabled, deleted, or wrong-shop owner (closes the JWT window)", async () => {
    const { db, shop } = await seededShopContext();
    const disabled = await makeStaff(db, shop.id, "owner", { status: "disabled" });
    const deleted = await makeStaff(db, shop.id, "owner", { deleted: true });
    const owner = await makeStaff(db, shop.id, "owner");

    expect(await canPersonViewShopReports(db, shop.id, disabled)).toBe(false);
    expect(await canPersonViewShopReports(db, shop.id, deleted)).toBe(false);
    // Right person, wrong shop id — scoping holds.
    expect(await canPersonViewShopReports(db, "00000000-0000-0000-0000-000000000000", owner)).toBe(
      false,
    );
  });
});
