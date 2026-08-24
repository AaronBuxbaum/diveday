import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBookingParty } from "./bookings";
import {
  consumeEntitlementForBooking,
  countSpendableDives,
  createDivePackage,
  deleteDivePackage,
  grantPackageEntitlements,
  listDivePackages,
  listSpendableEntitlements,
  releaseEntitlementForBooking,
  shopSellsPackages,
} from "./dive-packages";
import {
  bookingPaymentEvents,
  bookingPayments,
  bookings,
  divePackageEntitlements,
  orders,
  people,
} from "./schema";
import { upsertShopStripeAccount } from "./stripe-accounts";
import { listStaff, upcomingTripsWithCounts } from "./trips";

async function packageContext() {
  const { db, shop } = await seededShopContext();
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id))
    .limit(1);
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.shopId, shop.id))
    .limit(1);
  if (!person || !booking) throw new Error("seed missing a person or a booking");

  await upsertShopStripeAccount(db, shop.id, "acct_test");
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      personId: person.id,
      createdByPersonId: person.id,
      description: "Ten-dive package",
      totalCents: 90_000,
      currency: "usd",
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
      stripeInvoiceId: "in_test",
    })
    .returning();
  if (!order) throw new Error("order insert returned no row");
  return { db, shop, person, booking, order };
}

describe("a shop's package price list", () => {
  it("is opt-in by presence, like the gear register", async () => {
    // Zero packages means no package UI anywhere; defining the first turns it
    // on (ADR 20260815-minimal-gear-register's shape).
    const { db, shop } = await packageContext();
    expect(await shopSellsPackages(db, shop.id)).toBe(false);

    await createDivePackage(db, {
      shopId: shop.id,
      name: "Ten dives",
      diveCount: 10,
      priceCents: 90_000,
      scope: "all",
      validUntil: null,
    });

    expect(await shopSellsPackages(db, shop.id)).toBe(true);
  });

  it("keeps a diver's dives when the shop stops selling the product", async () => {
    // The softness is load-bearing here rather than conventional: the
    // entitlements reference the package row and must outlive it. A diver who
    // paid for ten dives does not lose them because the shop changed its menu.
    const { db, shop, person, order } = await packageContext();
    const pkg = await createDivePackage(db, {
      shopId: shop.id,
      name: "Retired five-pack",
      diveCount: 5,
      priceCents: 45_000,
      scope: "all",
      validUntil: null,
    });
    if (!pkg) throw new Error("package insert returned no row");
    await grantPackageEntitlements(db, {
      shopId: shop.id,
      packageId: pkg.id,
      personId: person.id,
      orderId: order.id,
      diveCount: 5,
      validUntil: null,
    });

    await deleteDivePackage(db, shop.id, pkg.id);

    expect(await listDivePackages(db, shop.id)).toHaveLength(0);
    expect(await countSpendableDives(db, shop.id, person.id)).toBe(5);
  });
});

describe("selling and spending a package", () => {
  async function sold(over: { diveCount?: number; scope?: "all" | "fun_dives" } = {}) {
    const ctx = await packageContext();
    const pkg = await createDivePackage(ctx.db, {
      shopId: ctx.shop.id,
      name: "Ten dives",
      diveCount: over.diveCount ?? 10,
      priceCents: 90_000,
      scope: over.scope ?? "all",
      validUntil: null,
    });
    if (!pkg) throw new Error("package insert returned no row");
    await grantPackageEntitlements(ctx.db, {
      shopId: ctx.shop.id,
      packageId: pkg.id,
      personId: ctx.person.id,
      orderId: ctx.order.id,
      diveCount: over.diveCount ?? 10,
      validUntil: null,
    });
    return { ...ctx, pkg };
  }

  it("grants one row per dive, all against the one order", async () => {
    // Sharing the order is what makes "refund the whole package" a question
    // that can be asked of the data.
    const { db, shop, person, order } = await sold();
    const held = await listSpendableEntitlements(db, shop.id, person.id);
    expect(held).toHaveLength(10);

    const rows = await db
      .select({ orderId: divePackageEntitlements.orderId })
      .from(divePackageEntitlements)
      .where(eq(divePackageEntitlements.personId, person.id));
    expect(new Set(rows.map((row) => row.orderId))).toEqual(new Set([order.id]));
  });

  it("spends exactly one dive on a booking, and hands it back on release", async () => {
    const { db, shop, person, booking } = await sold();

    const consumed = await consumeEntitlementForBooking(db, {
      shopId: shop.id,
      personId: person.id,
      bookingId: booking.id,
      trip: { courseId: null },
    });

    expect(consumed?.bookingId).toBe(booking.id);
    expect(await countSpendableDives(db, shop.id, person.id)).toBe(9);

    // Undoing a link, never crediting an amount — so it cannot round, drift, or
    // give back more than it took.
    const released = await releaseEntitlementForBooking(db, shop.id, booking.id);
    expect(released?.id).toBe(consumed?.id);
    expect(await countSpendableDives(db, shop.id, person.id)).toBe(10);
  });

  it("returns null rather than throwing when the diver has no covering dive", async () => {
    // Not a failure: a diver with nothing left simply pays the ordinary way.
    const { db, shop, person, booking } = await sold({ scope: "fun_dives" });

    const consumed = await consumeEntitlementForBooking(db, {
      shopId: shop.id,
      personId: person.id,
      bookingId: booking.id,
      trip: { courseId: "a-course" },
    });

    expect(consumed).toBeNull();
    expect(await countSpendableDives(db, shop.id, person.id)).toBe(10);
  });

  it("never lets one booking eat more than its planned tanks", async () => {
    // Repeated booking-path calls must not spend a second tank after the
    // booking already has its planned coverage.
    const { db, shop, person, booking } = await sold();
    await consumeEntitlementForBooking(db, {
      shopId: shop.id,
      personId: person.id,
      bookingId: booking.id,
      trip: { courseId: null },
    });

    await expect(
      consumeEntitlementForBooking(db, {
        shopId: shop.id,
        personId: person.id,
        bookingId: booking.id,
        trip: { courseId: null },
      }),
    ).resolves.toBeNull();

    expect(await countSpendableDives(db, shop.id, person.id)).toBe(9);
  });

  it("releases nothing for a booking that consumed nothing", async () => {
    const { db, shop, booking } = await sold();
    expect(await releaseEntitlementForBooking(db, shop.id, booking.id)).toBeNull();
  });

  it("stops counting a dive once it has lapsed", async () => {
    const { db, shop, person, order } = await packageContext();
    const pkg = await createDivePackage(db, {
      shopId: shop.id,
      name: "Week pass",
      diveCount: 3,
      priceCents: 30_000,
      scope: "all",
      validUntil: "2026-08-31",
    });
    if (!pkg) throw new Error("package insert returned no row");
    const purchasedAt = new Date("2026-08-24T14:32:00.000Z");
    await grantPackageEntitlements(db, {
      shopId: shop.id,
      packageId: pkg.id,
      personId: person.id,
      orderId: order.id,
      diveCount: 3,
      validUntil: "2026-08-31",
      purchasedAt,
    });

    expect(await countSpendableDives(db, shop.id, person.id, purchasedAt)).toBe(3);
    const afterLapse = new Date("2026-09-01T00:00:00.000Z");
    expect(await countSpendableDives(db, shop.id, person.id, afterLapse)).toBe(0);
  });
});

/**
 * **The whole point, end to end**: a diver with a prepaid dive books a covered
 * departure, the seat settles as paid through the gate every other path
 * converges on, and cancelling hands the dive back.
 *
 * There is deliberately no second path to "paid" — `PAYMENT_CLEARED` is what
 * readiness, the manifest and the check-in counter all consult, and a fourth
 * spelling of that fact is how three surfaces come to disagree
 * (ADR 20260822-a-package-is-entitlements-not-money).
 */
describe("booking a departure with a package", () => {
  async function diverHoldingDives(scope: "all" | "fun_dives" = "all") {
    const { db, shop } = await seededShopContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("seed has no staff");
    const pkg = await createDivePackage(db, {
      shopId: shop.id,
      name: "Ten dives",
      diveCount: 10,
      priceCents: 90_000,
      scope,
      validUntil: null,
    });
    if (!pkg) throw new Error("package insert returned no row");
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((row) => row.title.startsWith("Two-Tank Reef — Molasses"));
    if (!trip) throw new Error("demo reef trip missing");
    return { db, shop, staff, pkg, trip };
  }

  async function grantTo(
    db: Awaited<ReturnType<typeof seededShopContext>>["db"],
    shopId: string,
    personId: string,
    packageId: string,
  ) {
    await upsertShopStripeAccount(db, shopId, "acct_test");
    const [order] = await db
      .insert(orders)
      .values({
        shopId,
        personId,
        createdByPersonId: personId,
        description: "Ten-dive package",
        totalCents: 90_000,
        currency: "usd",
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
        stripeInvoiceId: "in_test",
      })
      .returning();
    if (!order) throw new Error("order insert returned no row");
    await grantPackageEntitlements(db, {
      shopId,
      packageId,
      personId,
      orderId: order.id,
      diveCount: 10,
      validUntil: null,
    });
  }

  it("settles the seat as paid and spends exactly one dive", async () => {
    const { db, shop, pkg, trip } = await diverHoldingDives();
    // Book once to mint the person, then give them the package, then book the
    // second seat — the one the package pays for.
    const first = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Pia Packages",
        email: "pia-packages@example.com",
      },
    ]);
    if (!first.ok) throw new Error(`booking failed: ${first.reason}`);
    const personId = first.bookings[0].personId;
    await grantTo(db, shop.id, personId, pkg.id);
    expect(await countSpendableDives(db, shop.id, personId)).toBe(10);

    // A *different* departure: the first booking exists to mint the person, and
    // re-booking the same trip updates that row rather than creating a seat.
    // From *now*, not the epoch: the epoch form returns departures that have
    // already sailed, and booking one is refused as unavailable.
    const second = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.id !== trip.id && row.courseId === null && row.capacity > row.booked,
    );
    if (!second) throw new Error("seed has no second open fun-dive departure");
    const covered = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: second.id,
        fullName: "Pia Packages",
        email: "pia-packages@example.com",
      },
    ]);
    if (!covered.ok) throw new Error(`booking failed: ${covered.reason}`);
    const bookingId = covered.bookings[0].bookingId;

    // Through the one gate, not a status written beside it.
    const [payment] = await db
      .select({ status: bookingPayments.status, provider: bookingPayments.provider })
      .from(bookingPayments)
      .where(eq(bookingPayments.bookingId, bookingId));
    expect(payment?.status).toBe("paid");
    expect(payment?.provider).toBe("dive_package");
    const [event] = await db
      .select({ operation: bookingPaymentEvents.operation })
      .from(bookingPaymentEvents)
      .where(eq(bookingPaymentEvents.bookingId, bookingId))
      .orderBy(bookingPaymentEvents.createdAt);
    expect(event?.operation).toBe("package_consumed");
    expect(await countSpendableDives(db, shop.id, personId)).toBe(8);

    // ...and cancelling hands it back.
    await cancelBooking(db, shop.id, bookingId);
    expect(await countSpendableDives(db, shop.id, personId)).toBe(10);
  });

  it("changes nothing for a shop that sells no packages", async () => {
    // Opt-in by presence: the whole feature is invisible until a shop defines
    // its first package, and a booking must pay the ordinary way.
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((row) => row.title.startsWith("Two-Tank Reef — Molasses"));
    if (!trip) throw new Error("demo reef trip missing");

    const booked = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Nora Nopackage",
        email: "nora-nopackage@example.com",
      },
    ]);
    if (!booked.ok) throw new Error(`booking failed: ${booked.reason}`);

    const payments = await db
      .select({ status: bookingPayments.status })
      .from(bookingPayments)
      .where(eq(bookingPayments.bookingId, booked.bookings[0].bookingId));
    expect(payments).toHaveLength(0);
  });
});

/**
 * **A stranger must not be able to spend a diver's prepaid dives.**
 *
 * `identityUnconfirmed` is set when a public booking reuses an existing person
 * by email but the submitted *name* disagrees — a possible shared-inbox or
 * different-human signal (H-13). `persistDeclaration` already refuses to write
 * a certification claim in that state, on the grounds that a statement made
 * under a disagreeing name is not provably about that person.
 *
 * Spending that person's prepaid property is the same act with a worse failure:
 * anyone who knows a regular's email could book seats in their name on the
 * public form and drain their package, and the victim's only notice would be a
 * balance nothing renders (`dive-domain-expert`, issue #706).
 */
describe("a booking made under an unconfirmed identity", () => {
  it("never spends the matched diver's dives", async () => {
    const { db, shop } = await seededShopContext();
    const [staffPerson] = await listStaff(db, shop.id);
    if (!staffPerson) throw new Error("seed has no staff");
    const pkg = await createDivePackage(db, {
      shopId: shop.id,
      name: "Ten dives",
      diveCount: 10,
      priceCents: 90_000,
      scope: "all",
      validUntil: null,
    });
    if (!pkg) throw new Error("package insert returned no row");
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const trip = trips.find((row) => row.courseId === null && row.capacity > row.booked);
    if (!trip) throw new Error("seed has no open fun-dive departure");

    // The regular, booked once so they exist, then given their package.
    const regular = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Rosa Regular",
        email: "rosa-regular@example.com",
      },
    ]);
    if (!regular.ok) throw new Error(`booking failed: ${regular.reason}`);
    const personId = regular.bookings[0].personId;
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId,
        createdByPersonId: staffPerson.person.id,
        description: "Ten-dive package",
        totalCents: 90_000,
        currency: "usd",
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
        stripeInvoiceId: "in_test",
      })
      .returning();
    if (!order) throw new Error("order insert returned no row");
    await grantPackageEntitlements(db, {
      shopId: shop.id,
      packageId: pkg.id,
      personId,
      orderId: order.id,
      diveCount: 10,
      validUntil: null,
    });

    // Someone else, on the public form, using the regular's email under a
    // different name — which is exactly what raises `identityUnconfirmed`.
    const second = trips.find(
      (row) => row.id !== trip.id && row.courseId === null && row.capacity > row.booked,
    );
    if (!second) throw new Error("seed has no second open fun-dive departure");
    const impostor = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: second.id,
        fullName: "Someone Else Entirely",
        email: "rosa-regular@example.com",
      },
    ]);
    if (!impostor.ok) throw new Error(`booking failed: ${impostor.reason}`);

    // The seat exists — this is not a refusal, and the shop still gets the
    // booking. What did not happen is the spend.
    expect(await countSpendableDives(db, shop.id, personId)).toBe(10);
    const payments = await db
      .select({ status: bookingPayments.status })
      .from(bookingPayments)
      .where(eq(bookingPayments.bookingId, impostor.bookings[0].bookingId));
    expect(payments).toHaveLength(0);
  });
});
