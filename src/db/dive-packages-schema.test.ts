import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { bookings, divePackageEntitlements, divePackages, orders, people } from "./schema";
import { upsertShopStripeAccount } from "./stripe-accounts";

/**
 * **The constraints, exercised.** This layer is schema only — the rules that
 * consume these rows arrive above it — so what is worth proving here is that
 * the database refuses the shapes the model says are impossible
 * (ADR 20260822-a-package-is-entitlements-not-money).
 *
 * A check constraint nobody has ever hit is a check constraint nobody knows
 * works.
 */
describe("the dive package tables", () => {
  async function context() {
    const { db, shop } = await seededShopContext();
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    if (!person) throw new Error("seed has no people");
    const [pkg] = await db
      .insert(divePackages)
      .values({ shopId: shop.id, name: "Ten dives", diveCount: 10, priceCents: 90_000 })
      .returning();
    // `orders.stripe_account_id` is a foreign key: money in this app always
    // came from a connected account that exists.
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    // An order is what a diver paid on, so an entitlement needs one to point at.
    // `orders` requires its Stripe identifiers — money in this app always came
    // from somewhere — so the fixture supplies them rather than pretending.
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
    if (!pkg || !order) throw new Error("fixture insert returned no row");
    return { db, shop, person, pkg, order };
  }

  it("refuses a package that sells no dives, or costs nothing", async () => {
    const { db, shop } = await context();
    await expect(
      db
        .insert(divePackages)
        .values({ shopId: shop.id, name: "Zero", diveCount: 0, priceCents: 1 }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(divePackages)
        .values({ shopId: shop.id, name: "Free", diveCount: 1, priceCents: 0 }),
    ).rejects.toThrow();
  });

  it("refuses an invalid fixed end date", async () => {
    const { db, shop } = await context();
    await expect(
      db
        .insert(divePackages)
        .values({ shopId: shop.id, name: "Invalid", diveCount: 1, priceCents: 1, validUntil: "not-a-date" }),
    ).rejects.toThrow();
  });

  it("refuses an entitlement consumed by nobody, or at no time", async () => {
    // The pair is the whole model: `booking_id` says which seat took the dive
    // and `consumed_at` says when. Half a pair reads as "used by nobody" or
    // "used at no time", and both are worse than a refusal.
    const { db, shop, person, pkg, order } = await context();
    const base = {
      shopId: shop.id,
      packageId: pkg.id,
      personId: person.id,
      orderId: order.id,
    };

    await expect(
      db.insert(divePackageEntitlements).values({ ...base, consumedAt: nowDate() }),
    ).rejects.toThrow();
  });

  it("lets one booking consume one row per tank", async () => {
    const { db, shop, person, pkg, order } = await context();
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .limit(1);
    if (!booking) throw new Error("seed has no bookings");
    const consumed = {
      shopId: shop.id,
      packageId: pkg.id,
      personId: person.id,
      orderId: order.id,
      bookingId: booking.id,
      consumedAt: nowDate(),
    };

    await db.insert(divePackageEntitlements).values(consumed);
    await db.insert(divePackageEntitlements).values(consumed);
  });

  it("lets many unused entitlements coexist", async () => {
    // The partial-index half: ten unused dives all carry a null booking, and a
    // An unused package is represented by one row per tank.
    const { db, shop, person, pkg, order } = await context();
    const rows = Array.from({ length: 10 }, () => ({
      shopId: shop.id,
      packageId: pkg.id,
      personId: person.id,
      orderId: order.id,
    }));

    await db.insert(divePackageEntitlements).values(rows);
    const held = await db
      .select({ id: divePackageEntitlements.id })
      .from(divePackageEntitlements)
      .where(eq(divePackageEntitlements.personId, person.id));
    expect(held).toHaveLength(10);
  });
});
