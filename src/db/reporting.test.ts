import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/authz";
import { summarizeMonth } from "@/lib/reporting";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  canPersonViewShopReports,
  crewCountsByTrip,
  earliestImportedFinancialHistoryDate,
  earliestReportedTripStart,
  getMonthlyReport,
  pagedMonthlyReportTrips,
} from "./reporting";
import {
  bookingCheckoutBookings,
  bookingCheckouts,
  bookingPayments,
  bookings,
  importedPaymentHistory,
  type PaymentStatus,
  people,
  personRoles,
  shops,
  tips,
  trips,
  userAccounts,
  waiverRecords,
} from "./schema";
import { listStaff, setTripCrew } from "./trips";
import { getCurrentWaiverTemplate } from "./waivers";

type BookingStatus = "booked" | "checked_in" | "cancelled" | "no_show";
type TripStatus = "scheduled" | "cancelled";

let seq = 0;

async function makePerson(db: AppDb, shopId: string, name: string): Promise<string> {
  const [row] = await db.insert(people).values({ shopId, fullName: name }).returning();
  if (!row) throw new Error("failed to insert person");
  return row.id;
}

async function addImportedFinancialHistory(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    occurredOn: string;
    direction: "payment" | "refund" | "unknown";
    amountCents: number | null;
    currency: string | null;
  },
): Promise<void> {
  seq += 1;
  await db.insert(importedPaymentHistory).values({
    shopId: input.shopId,
    personId: input.personId,
    occurredOn: input.occurredOn,
    direction: input.direction,
    title: `Imported source ${seq}`,
    statusLabel: input.direction === "payment" ? "Settled" : "Refunded",
    amountLabel: input.amountCents === null ? "unknown amount" : `$${input.amountCents / 100}`,
    amountCents: input.amountCents,
    currency: input.currency,
    sourceLabel: "Prior shop",
    dedupeKey: `imported-${seq}`,
    importedAt: new Date("2026-06-01T00:00:00Z"),
  });
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
  source: { provider?: string; providerRef?: string } = {},
): Promise<void> {
  await db
    .insert(bookingPayments)
    .values({
      shopId,
      bookingId,
      status,
      amountCents,
      currency: "usd",
      provider: source.provider,
      providerRef: source.providerRef,
    });
}

/**
 * A completed deposit checkout covering one booking — the deposit a later
 * balance overwrites. `gearCents` is that diver's rental gear, charged on the
 * same session; `settledTotalCents` is what Stripe actually collected for it
 * (null = no settled figure, as on any row predating that column).
 */
async function makeDepositCheckout(
  db: AppDb,
  shopId: string,
  tripId: string,
  bookingId: string,
  perDiverCents: number,
  options: { gearCents?: number; settledTotalCents?: number; taxCents?: number } = {},
): Promise<void> {
  seq += 1;
  const gearCents = options.gearCents ?? 0;
  const [checkout] = await db
    .insert(bookingCheckouts)
    .values({
      shopId,
      currency: "usd",
      tripId,
      status: "completed",
      isDeposit: true,
      stripeAccountId: "acct_test",
      stripeSessionId: `cs_${seq}`,
      amountPerDiverCents: perDiverCents,
      totalCents: perDiverCents + gearCents,
      taxCents: options.taxCents,
      settledTotalCents: options.settledTotalCents ?? null,
    })
    .returning();
  if (!checkout) throw new Error("failed to insert checkout");
  await db
    .insert(bookingCheckoutBookings)
    .values({ shopId, checkoutId: checkout.id, bookingId, gearCents, taxCents: options.taxCents });
}

/**
 * A post-trip tip on one booking. `paid` by default — the only state that is
 * money the shop actually has.
 */
async function makeTip(
  db: AppDb,
  shopId: string,
  bookingId: string,
  amountCents: number,
  status: "pending" | "paid" | "expired" = "paid",
): Promise<void> {
  seq += 1;
  await db.insert(tips).values({
    shopId,
    bookingId,
    status,
    stripeAccountId: "acct_test",
    stripeSessionId: `cs_tip_${seq}`,
    currency: "usd",
    amountCents,
    completedAt: status === "paid" ? new Date("2026-06-11T00:00:00Z") : null,
  });
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
  it("separates verified Stripe Tax from net revenue", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await makePerson(db, shop.id, "Taxed Tessa");
    const trip = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
    const booking = await makeBooking(db, shop.id, trip, diver);
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: trip,
        status: "completed",
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_taxed",
        currency: "usd",
        amountPerDiverCents: 18_000,
        totalCents: 18_000,
        taxEnabled: true,
        taxCents: 1_800,
        settledTotalCents: 19_800,
      })
      .returning();
    if (!checkout) throw new Error("failed to insert taxed checkout");
    await db.insert(bookingCheckoutBookings).values({
      shopId: shop.id,
      checkoutId: checkout.id,
      bookingId: booking,
      tripCents: 18_000,
      taxCents: 1_800,
    });
    await pay(db, shop.id, booking, "paid", 19_800, {
      provider: "stripe",
      providerRef: "cs_taxed",
    });

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
    expect(report).toMatchObject({ revenueCents: 18_000, taxCents: 1_800 });
    expect(summarizeMonth(report).taxCents).toBe(1_800);
  });

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

    // Money. a0: paid 18000. a1: a deposit checkout — 6000 deposit + 1000 of
    // rental gear asked, 6300 actually collected by Stripe (a 10% code) —
    // later topped up by a 12000 balance, so the current row reads paid/12000
    // and the *settled* deposit must be recovered → 6300, not the 6000 list
    // deposit and not a gear-less figure (PAY-H1/H2). a2: a staff manual mark
    // of 5000 (no order/checkout). B's seat: paid 20000. C (May) and D
    // (cancelled) each carry a payment that must be excluded.
    await pay(db, shop.id, a0, "paid", 18_000);
    await makeDepositCheckout(db, shop.id, a, a1, 6_000, {
      gearCents: 1_000,
      settledTotalCents: 6_300,
    });
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

    // base 18000 + 12000 + 5000 + 20000 = 55000, plus the recovered deposit at
    // what it settled for — 6300, this diver's whole share of a 7000 ask
    // Stripe collected 6300 against — not the 6000 pre-discount list deposit;
    // May and cancelled excluded.
    expect(report.revenueCents).toBe(61_300);

    const summary = summarizeMonth(report);
    expect(summary.tripCount).toBe(2);
    expect(summary.seatsOffered).toBe(16);
    expect(summary.seatsBooked).toBe(9);
    expect(summary.atCapacityTrips).toBe(1);
  });

  it("recovers a historical deposit at its asked amount when no settled figure was ever recorded", async () => {
    // Rows predating `settled_total_cents` carry no Stripe figure. They must
    // still contribute exactly what they always did — the deposit asked for —
    // rather than dropping out of revenue or reading as zero collected.
    const { db, shop } = await seededShopContext();
    const diver = await makePerson(db, shop.id, "Historical Hana");
    const trip = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
    const booking = await makeBooking(db, shop.id, trip, diver);
    await makeDepositCheckout(db, shop.id, trip, booking, 6_000);
    await pay(db, shop.id, booking, "paid", 12_000);

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
    expect(report.revenueCents).toBe(12_000 + 6_000);
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

  it("adds only clear, matching-currency imported payments and refunds to net revenue", async () => {
    const { db, shop } = await seededShopContext();
    const person = await makePerson(db, shop.id, "Imported Rosa");
    const before = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START, {
      currency: "usd",
      timeZone: "UTC",
    });

    await addImportedFinancialHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2026-06-02",
      direction: "payment",
      amountCents: 12_000,
      currency: "usd",
    });
    await addImportedFinancialHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2026-06-03",
      direction: "refund",
      amountCents: 2_000,
      currency: "usd",
    });
    // All of these stay visible in Orders, but none belongs in this aggregate:
    // unknown direction, a different currency, and a source day outside June.
    await addImportedFinancialHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2026-06-04",
      direction: "unknown",
      amountCents: 9_999,
      currency: "usd",
    });
    await addImportedFinancialHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2026-06-05",
      direction: "payment",
      amountCents: 8_888,
      currency: "eur",
    });
    await addImportedFinancialHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2026-05-31",
      direction: "payment",
      amountCents: 7_777,
      currency: "usd",
    });

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START, {
      currency: "usd",
      timeZone: "UTC",
    });
    expect(report.revenueCents).toBe(before.revenueCents + 10_000);
    expect(report).toMatchObject({
      importedPaymentCents: 12_000,
      importedRefundCents: 2_000,
      importedFinancialRecordCount: 2,
    });
  });

  it("excludes a payment/waiver row whose own shop_id doesn't match the trip's shop, even though it joins to that shop's booking (CR-007)", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-reporting-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");

    const diver = await makePerson(db, shop.id, "Diver X");
    const trip = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
    const booking = await makeBooking(db, shop.id, trip, diver);

    // Both rows join correctly to shop.id's booking via bookingId, but each
    // claims a different shop on its own shop_id column — the exact
    // inconsistency CR-007 exists to never trust. A query that (incorrectly)
    // relied on the bookingId join alone would still pick these up for
    // shop.id's report.
    await db.insert(bookingPayments).values({
      shopId: otherShop.id,
      bookingId: booking,
      status: "paid",
      amountCents: 99_999,
      currency: "usd",
    });
    const template = await getCurrentWaiverTemplate(db, shop.id);
    if (!template) throw new Error("seeded shop is missing a waiver template");
    await db.insert(waiverRecords).values({
      shopId: otherShop.id,
      bookingId: booking,
      personId: diver,
      templateId: template.id,
      templateTitle: template.title,
      templateVersion: template.version,
      templateBody: template.body,
      status: "completed",
      tokenHash: "hash-cross-shop",
      expiresAt: new Date("2027-01-01T00:00:00Z"),
      signedAt: new Date("2026-06-05T00:00:00Z"),
      completedAt: new Date("2026-06-05T00:00:00Z"),
    });

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
    expect(report.revenueCents).toBe(0);
    expect(report.trips.find((t) => t.title === "Reef")).toMatchObject({ waiverComplete: 0 });

    // The mismatched rows don't leak into the other shop's report either —
    // the trip and booking they join to both belong to `shop`, not `otherShop`.
    const otherReport = await getMonthlyReport(db, otherShop.id, JUNE_START, JULY_START);
    expect(otherReport.trips).toEqual([]);
    expect(otherReport.revenueCents).toBe(0);
  });

  /**
   * Tips are the last Stripe-vs-Reports divergence (PAY-M2). They are reported
   * as their own figure, anchored to the trip that earned them, and never
   * folded into `revenueCents` — a tip is its own Stripe charge, 100% to the
   * shop, and never touches the booking payment gate.
   */
  describe("tips", () => {
    it("sums settled tips on the month's trips as their own figure, leaving revenue alone", async () => {
      const { db, shop } = await seededShopContext();
      const diver = await makePerson(db, shop.id, "Tipper Tess");
      const other = await makePerson(db, shop.id, "Tipper Tom");
      const trip = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
      const booking = await makeBooking(db, shop.id, trip, diver);
      const second = await makeBooking(db, shop.id, trip, other);
      await pay(db, shop.id, booking, "paid", 18_000);
      await makeTip(db, shop.id, booking, 2_000);
      await makeTip(db, shop.id, second, 1_500);

      const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
      expect(report.tipsCents).toBe(3_500);
      expect(report.tipCount).toBe(2);
      // The fare and the gratuity stay separate numbers.
      expect(report.revenueCents).toBe(18_000);
      expect(summarizeMonth(report).tipsCents).toBe(3_500);
    });

    it("counts only tips Stripe actually settled — a pending or expired session is money nobody has", async () => {
      const { db, shop } = await seededShopContext();
      const diver = await makePerson(db, shop.id, "Tipper Tess");
      const trip = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
      const booking = await makeBooking(db, shop.id, trip, diver);
      await makeTip(db, shop.id, booking, 2_000, "paid");
      await makeTip(db, shop.id, booking, 9_900, "pending");
      await makeTip(db, shop.id, booking, 8_800, "expired");

      const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
      expect(report.tipsCents).toBe(2_000);
      expect(report.tipCount).toBe(1);
    });

    it("buckets a tip by the trip's departure month, and never counts a cancelled boat's", async () => {
      const { db, shop } = await seededShopContext();
      const diver = await makePerson(db, shop.id, "Tipper Tess");
      const june = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "June reef");
      const may = await makeTrip(db, shop.id, new Date("2026-05-10T12:00:00Z"), 10, "May reef");
      const scrubbed = await makeTrip(
        db,
        shop.id,
        new Date("2026-06-14T12:00:00Z"),
        10,
        "Scrubbed",
        "cancelled",
      );
      await makeTip(db, shop.id, await makeBooking(db, shop.id, june, diver), 2_000);
      await makeTip(db, shop.id, await makeBooking(db, shop.id, may, diver), 5_000);
      await makeTip(db, shop.id, await makeBooking(db, shop.id, scrubbed, diver), 7_000);

      const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
      expect(report.tipsCents).toBe(2_000);
      expect(report.tipCount).toBe(1);
    });

    it("reports zero for a month with no tips rather than leaving the figure absent", async () => {
      const { db, shop } = await seededShopContext();
      const diver = await makePerson(db, shop.id, "Diver X");
      const trip = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
      await pay(db, shop.id, await makeBooking(db, shop.id, trip, diver), "paid", 18_000);

      const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
      expect(report.tipsCents).toBe(0);
      expect(report.tipCount).toBe(0);
    });

    it("never counts a tip row whose own shop_id doesn't match the trip's shop (CR-007)", async () => {
      const { db, shop } = await seededShopContext();
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Other Shop", slug: "other-shop-tips-test", timezone: "UTC" })
        .returning();
      if (!otherShop) throw new Error("second shop insert failed");
      const diver = await makePerson(db, shop.id, "Diver X");
      const trip = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
      const booking = await makeBooking(db, shop.id, trip, diver);
      await makeTip(db, otherShop.id, booking, 9_999);

      const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
      expect(report.tipsCents).toBe(0);
      const otherReport = await getMonthlyReport(db, otherShop.id, JUNE_START, JULY_START);
      expect(otherReport.tipsCents).toBe(0);
    });
  });
});

describe("pagedMonthlyReportTrips", () => {
  it("pages by number and never repeats or skips a trip", async () => {
    const { db, shop } = await seededShopContext();
    for (let day = 1; day <= 5; day++) {
      await makeTrip(db, shop.id, new Date(`2026-06-0${day}T10:00:00Z`), 4, `Trip ${day}`);
    }

    const all = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
    expect(all.trips.length).toBeGreaterThanOrEqual(5);

    const sortedIds = [...all.trips]
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((trip) => trip.tripId);

    const first = await pagedMonthlyReportTrips(db, shop.id, JUNE_START, JULY_START, { limit: 2 });
    // The count is the month's trips, not the page's — it is what the pager
    // says out loud.
    expect(first.total).toBe(all.trips.length);
    expect(first.pageCount).toBe(Math.ceil(all.trips.length / 2));

    const seen: string[] = [];
    for (let page = 1; page <= first.pageCount; page++) {
      const chunk = await pagedMonthlyReportTrips(db, shop.id, JUNE_START, JULY_START, {
        page,
        limit: 2,
      });
      expect(chunk.page).toBe(page);
      expect(chunk.trips.length).toBeLessThanOrEqual(2);
      seen.push(...chunk.trips.map((trip) => trip.tripId));
    }
    expect(seen).toEqual(sortedIds);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("goes back a page as well as forward", async () => {
    const { db, shop } = await seededShopContext();
    for (let day = 1; day <= 4; day++) {
      await makeTrip(db, shop.id, new Date(`2026-06-0${day}T10:00:00Z`), 4, `Trip ${day}`);
    }
    const second = await pagedMonthlyReportTrips(db, shop.id, JUNE_START, JULY_START, {
      page: 2,
      limit: 2,
    });
    const back = await pagedMonthlyReportTrips(db, shop.id, JUNE_START, JULY_START, {
      page: second.page - 1,
      limit: 2,
    });
    const first = await pagedMonthlyReportTrips(db, shop.id, JUNE_START, JULY_START, {
      page: 1,
      limit: 2,
    });
    expect(back.trips.map((trip) => trip.tripId)).toEqual(first.trips.map((trip) => trip.tripId));
  });

  it("never truncates summarizeMonth's totals, even when the table page is tiny", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await makePerson(db, shop.id, "Deep Dana");
    for (let day = 1; day <= 4; day++) {
      const tripId = await makeTrip(
        db,
        shop.id,
        new Date(`2026-06-1${day}T10:00:00Z`),
        1,
        `T${day}`,
      );
      const bookingId = await makeBooking(db, shop.id, tripId, diver);
      await pay(db, shop.id, bookingId, "paid", 10_000);
    }

    // A one-row display page — proof the headline metrics still see every
    // trip in the month, not just the page a viewer happens to be on.
    const tinyPage = await pagedMonthlyReportTrips(db, shop.id, JUNE_START, JULY_START, {
      limit: 1,
    });
    expect(tinyPage.trips).toHaveLength(1);
    expect(tinyPage.pageCount).toBeGreaterThan(1);

    const totals = summarizeMonth(await getMonthlyReport(db, shop.id, JUNE_START, JULY_START));
    expect(totals.tripCount).toBeGreaterThanOrEqual(4);
    expect(totals.seatsOffered).toBeGreaterThanOrEqual(4);
    expect(totals.seatsBooked).toBeGreaterThanOrEqual(4);
    expect(totals.atCapacityTrips).toBeGreaterThanOrEqual(4);
    expect(totals.revenueCents).toBeGreaterThanOrEqual(40_000);
  });

  it("treats a nonsensical page as the first and one past the end as the last", async () => {
    const { db, shop } = await seededShopContext();
    await makeTrip(db, shop.id, new Date("2026-06-02T10:00:00Z"), 4, "Trip A");
    await makeTrip(db, shop.id, new Date("2026-06-03T10:00:00Z"), 4, "Trip B");

    const all = await pagedMonthlyReportTrips(db, shop.id, JUNE_START, JULY_START);
    for (const requested of [0, -3, Number.NaN]) {
      const clamped = await pagedMonthlyReportTrips(db, shop.id, JUNE_START, JULY_START, {
        page: requested,
      });
      expect(clamped.page).toBe(1);
      expect(clamped.trips.map((trip) => trip.tripId)).toEqual(
        all.trips.map((trip) => trip.tripId),
      );
    }

    // A `?page=` bookmarked on a busier month, carried onto a quieter one by
    // the month arrows: the last real page, not an empty table.
    const past = await pagedMonthlyReportTrips(db, shop.id, JUNE_START, JULY_START, {
      page: 9,
      limit: 1,
    });
    expect(past.page).toBe(past.pageCount);
    expect(past.trips).toHaveLength(1);
  });
});

describe("earliestReportedTripStart", () => {
  it("returns the oldest scheduled departure, ignoring cancelled ones", async () => {
    const { db, shop } = await seededShopContext();
    // Older than anything the demo seed lays down, so it is unambiguously the
    // floor whatever the seeded history happens to contain.
    const oldest = new Date("2019-03-04T09:00:00Z");
    await makeTrip(db, shop.id, new Date("2019-01-02T09:00:00Z"), 6, "Scrubbed", "cancelled");
    await makeTrip(db, shop.id, oldest, 6, "First ever");

    expect(await earliestReportedTripStart(db, shop.id)).toEqual(oldest);
  });

  it("is shop-scoped, and null for a shop that has never scheduled a trip", async () => {
    const { db, shop } = await seededShopContext();
    const [other] = await db
      .insert(shops)
      // A unique suffix, not a time read: `shops.slug` is unique and this
      // test inserts a second shop alongside the seeded one.
      .values({ name: "Empty Shop", slug: `empty-${crypto.randomUUID()}`, timezone: "UTC" })
      .returning();
    if (!other) throw new Error("failed to insert shop");

    expect(await earliestReportedTripStart(db, other.id)).toBeNull();
    expect(await earliestReportedTripStart(db, shop.id)).not.toBeNull();
  });
});

describe("earliestImportedFinancialHistoryDate", () => {
  it("uses the same eligible source-history boundary as the revenue aggregate", async () => {
    const { db, shop } = await seededShopContext();
    const person = await makePerson(db, shop.id, "Earliest Import");
    await addImportedFinancialHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2020-01-01",
      direction: "unknown",
      amountCents: 1_000,
      currency: "usd",
    });
    await addImportedFinancialHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2020-02-01",
      direction: "payment",
      amountCents: 1_000,
      currency: "eur",
    });
    await addImportedFinancialHistory(db, {
      shopId: shop.id,
      personId: person,
      occurredOn: "2020-03-01",
      direction: "refund",
      amountCents: 1_000,
      currency: "usd",
    });

    expect(await earliestImportedFinancialHistoryDate(db, shop.id, "usd")).toBe("2020-03-01");
    expect(await earliestImportedFinancialHistoryDate(db, shop.id, "eur")).toBe("2020-02-01");
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

/**
 * **A partial refund has to leave the retained money in the report** (issue
 * #699).
 *
 * The base-revenue query used to filter on `paid`/`deposit_paid` alone, and
 * its own comment claimed it covered "refunds (excluded)" — true only while
 * every refund was total. A seat left `partly_refunded` and outside the list
 * would have reported the *whole* charge as nothing; left in the list at the
 * pre-refund figure it would have reported money the shop no longer has.
 * Neither is a rounding error: they are the two ways this number can lie to
 * the person deciding whether the season worked.
 */
describe("monthly revenue after a partial refund", () => {
  it("counts what the shop kept, not the whole charge and not zero", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await makePerson(db, shop.id, "Partly Paula");
    const trip = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
    const booking = await makeBooking(db, shop.id, trip, diver);
    // $200 taken, $30 handed back after the second dive was called off.
    await pay(db, shop.id, booking, "partly_refunded", 17_000);

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
    expect(report.revenueCents).toBe(17_000);
  });

  it("still drops a fully refunded seat to nothing", async () => {
    const { db, shop } = await seededShopContext();
    const diver = await makePerson(db, shop.id, "Refunded Rafa");
    const trip = await makeTrip(db, shop.id, new Date("2026-06-10T12:00:00Z"), 10, "Reef");
    const booking = await makeBooking(db, shop.id, trip, diver);
    await pay(db, shop.id, booking, "refunded", 0);

    const report = await getMonthlyReport(db, shop.id, JUNE_START, JULY_START);
    expect(report.revenueCents).toBe(0);
  });
});

describe("crewCountsByTrip (issue #700 — crew load, never a cost)", () => {
  it("counts distinct crew assigned per trip, batched across every trip in one query", async () => {
    const { db, shop } = await seededShopContext();
    const staff = await listStaff(db, shop.id);
    const [first, second] = staff;
    if (!first || !second) throw new Error("seeded shop needs at least two staff members");
    const thin = await makeTrip(db, shop.id, new Date("2026-06-05T12:00:00Z"), 10, "Thin charter");
    const crewed = await makeTrip(
      db,
      shop.id,
      new Date("2026-06-12T12:00:00Z"),
      10,
      "Fully crewed charter",
    );
    await setTripCrew(db, shop.id, crewed, [first.person.id, second.person.id]);

    const counts = await crewCountsByTrip(db, shop.id, [thin, crewed]);
    expect(counts.get(thin)).toBeUndefined();
    expect(counts.get(crewed)).toBe(2);
  });

  it("returns nothing for a trip ids list that is empty, without a query", async () => {
    const { db, shop } = await seededShopContext();
    expect(await crewCountsByTrip(db, shop.id, [])).toEqual(new Map());
  });

  it("never counts a genuinely different shop's crew against this trip id (CR-007)", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-crew-count-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const staff = await listStaff(db, shop.id);
    const [first] = staff;
    if (!first) throw new Error("seeded shop needs a staff member");
    const trip = await makeTrip(db, shop.id, new Date("2026-06-12T12:00:00Z"), 10, "Reef");
    await setTripCrew(db, shop.id, trip, [first.person.id]);

    expect(await crewCountsByTrip(db, otherShop.id, [trip])).toEqual(new Map());
  });
});
