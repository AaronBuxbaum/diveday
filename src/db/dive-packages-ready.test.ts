import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import {
  consumeEntitlementsForBooking,
  createDivePackage,
  deleteDivePackage,
  grantPackageEntitlements,
  listDivePackages,
  packageDivesForBooking,
} from "./dive-packages";
import { bookings, divePackageEntitlements, orders, people } from "./schema";
import { upsertShopStripeAccount } from "./stripe-accounts";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();

/** A diver, a booking of theirs, and a paid order, on a shop selling none of the demo packages. */
async function packageContext() {
  const { db, shop } = fileCtx;
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
  for (const pkg of await listDivePackages(db, shop.id)) {
    await deleteDivePackage(db, shop.id, pkg.id);
  }
  await upsertShopStripeAccount(db, shop.id, "acct_test");
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      personId: person.id,
      createdByPersonId: person.id,
      description: "Five fun dives",
      status: "paid",
      totalCents: 20_000,
      amountPaidCents: 20_000,
      currency: "usd",
      stripeAccountId: "acct_test",
      stripeCustomerId: "cus_test",
      stripeInvoiceId: "in_test",
    })
    .returning();
  if (!order) throw new Error("order insert returned no row");
  return { db, shop, person, booking, order };
}

/**
 * **What `/ready`'s Pay step says about packages** (issue 4309): the compact
 * balance and the optional breakdown under it, read from one list of the
 * entitlements the backing rule still counts.
 */
describe("the package dives /ready lists", () => {
  it("breaks what /ready says is left down by cover and end date, as the backing rule counts it (issue 4309)", async () => {
    const { db, shop, person, booking, order } = await packageContext();
    const funDives = await createDivePackage(db, {
      shopId: shop.id,
      name: "Five fun dives",
      diveCount: 5,
      priceCents: 20_000,
      scope: "fun_dives",
      validUntil: "2099-06-30",
    });
    const anyTrip = await createDivePackage(db, {
      shopId: shop.id,
      name: "Three dives, courses too",
      diveCount: 3,
      priceCents: 30_000,
      scope: "all",
      validUntil: null,
    });
    if (!funDives || !anyTrip) throw new Error("package insert returned no row");
    const [secondOrder] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: person.id,
        createdByPersonId: person.id,
        description: "Three dives",
        status: "paid",
        totalCents: 30_000,
        amountPaidCents: 30_000,
        currency: "usd",
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
        stripeInvoiceId: "in_test_2",
      })
      .returning();
    if (!secondOrder) throw new Error("order insert returned no row");
    await grantPackageEntitlements(db, {
      shopId: shop.id,
      packageId: funDives.id,
      personId: person.id,
      orderId: order.id,
      diveCount: 5,
      validUntil: "2099-06-30",
    });
    await grantPackageEntitlements(db, {
      shopId: shop.id,
      packageId: anyTrip.id,
      personId: person.id,
      orderId: secondOrder.id,
      diveCount: 3,
      validUntil: null,
    });

    // A two-tank fun dive spends two, from the package that ends first.
    await consumeEntitlementsForBooking(db, {
      shopId: shop.id,
      personId: person.id,
      bookingId: booking.id,
      trip: { courseId: null, plannedDives: 2 },
    });
    const input = { shopId: shop.id, personId: person.id, bookingId: booking.id };
    expect(await packageDivesForBooking(db, input)).toEqual({
      left: 6,
      usedHere: 2,
      groups: [
        { scope: "fun_dives", useBy: "2099-06-30", count: 3 },
        { scope: "all", useBy: null, count: 3 },
      ],
    });

    // A refunded order takes its dives out of the balance and the breakdown alike.
    await db.update(orders).set({ status: "refunded" }).where(eq(orders.id, secondOrder.id));
    expect(await packageDivesForBooking(db, input)).toEqual({
      left: 3,
      usedHere: 2,
      groups: [{ scope: "fun_dives", useBy: "2099-06-30", count: 3 }],
    });

    // Spend the rest: a fully used package leaves nothing to break down.
    await db
      .update(divePackageEntitlements)
      .set({ consumedAt: new Date("2026-08-01T00:00:00Z"), bookingId: booking.id })
      .where(eq(divePackageEntitlements.orderId, order.id));
    expect(await packageDivesForBooking(db, input)).toEqual({ left: 0, usedHere: 5, groups: [] });
  });
});
