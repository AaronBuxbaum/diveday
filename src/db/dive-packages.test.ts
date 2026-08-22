import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
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
import { bookings, divePackageEntitlements, orders, people } from "./schema";
import { upsertShopStripeAccount } from "./stripe-accounts";

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
      validityDays: null,
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
      validityDays: null,
    });
    if (!pkg) throw new Error("package insert returned no row");
    await grantPackageEntitlements(db, {
      shopId: shop.id,
      packageId: pkg.id,
      personId: person.id,
      orderId: order.id,
      diveCount: 5,
      validityDays: null,
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
      validityDays: null,
    });
    if (!pkg) throw new Error("package insert returned no row");
    await grantPackageEntitlements(ctx.db, {
      shopId: ctx.shop.id,
      packageId: pkg.id,
      personId: ctx.person.id,
      orderId: ctx.order.id,
      diveCount: over.diveCount ?? 10,
      validityDays: null,
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

  it("never lets one seat eat two dives", async () => {
    // The guard that matters most: `bookSpot` runs concurrently, and the
    // partial unique index on `booking_id` is the backstop however a race
    // resolves.
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
    ).rejects.toThrow();

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
      validityDays: 7,
    });
    if (!pkg) throw new Error("package insert returned no row");
    const purchasedAt = nowDate();
    await grantPackageEntitlements(db, {
      shopId: shop.id,
      packageId: pkg.id,
      personId: person.id,
      orderId: order.id,
      diveCount: 3,
      validityDays: 7,
      purchasedAt,
    });

    expect(await countSpendableDives(db, shop.id, person.id, purchasedAt)).toBe(3);
    const afterLapse = new Date(purchasedAt.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(await countSpendableDives(db, shop.id, person.id, afterLapse)).toBe(0);
  });
});
