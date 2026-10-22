import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { recordSetupRequest } from "./funnel";
import { pricingTestByArm } from "./pricing-test-report";
import { people, pricingVolumeStatements, shopSubscriptions, shops, userAccounts } from "./schema";

const PAID_AT = new Date("2031-06-15T12:00:00Z");
let seq = 0;

async function shopOn(
  db: AppDb,
  values: Partial<typeof shopSubscriptions.$inferInsert>,
  options: { isDemo?: boolean; login?: boolean } = {},
) {
  seq += 1;
  const [shop] = await db
    .insert(shops)
    .values({
      name: "Arm Shop",
      slug: `arm-shop-${seq}`,
      timezone: "UTC",
      isDemo: options.isDemo ?? false,
    })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  if (options.login ?? true) {
    const [owner] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Owner" })
      .returning();
    if (!owner) throw new Error("person insert failed");
    await db
      .insert(userAccounts)
      .values({ personId: owner.id, email: `arm-${seq}@example.test`, hashedPassword: "x" });
  }
  await db.insert(shopSubscriptions).values({ shopId: shop.id, ...values });
  return shop.id;
}

describe("pricingTestByArm", () => {
  it("counts each arm's funnel, revenue and volume, real shops only", async () => {
    const db = await unseededTestDb();
    const request = {
      shopName: "X",
      region: "Y",
      runsBoat: true,
      currentSystem: "paper",
      contactName: "Z",
      email: "z@example.test",
      phone: null,
      source: "pricing",
      locale: "en-US",
    } as const;
    await recordSetupRequest(db, { ...request, pricingPlan: "percent_of_volume" });
    await recordSetupRequest(db, { ...request, pricingPlan: "percent_of_volume" });
    await recordSetupRequest(db, { ...request, pricingPlan: "flat_monthly" });
    await recordSetupRequest(db, request);

    const flat = {
      pricingPlan: "flat_monthly",
      pricingPlanSource: "assigned",
      assignedPricingPlan: "flat_monthly",
    } as const;
    const percent = {
      pricingPlan: "percent_of_volume",
      pricingPlanSource: "assigned",
      assignedPricingPlan: "percent_of_volume",
    } as const;
    await shopOn(db, {
      ...flat,
      stripeSubscriptionId: "sub_1",
      stripeStatus: "active",
      firstPaidAt: PAID_AT,
      paidTotalCents: 19_800,
    });
    await shopOn(db, {
      ...flat,
      stripeSubscriptionId: "sub_2",
      stripeStatus: "canceled",
      firstPaidAt: PAID_AT,
      paidTotalCents: 9_900,
    });
    await shopOn(db, flat);
    const paying = await shopOn(db, {
      ...percent,
      stripeSubscriptionId: "sub_3",
      stripeStatus: "active",
      firstPaidAt: PAID_AT,
      paidTotalCents: 4_500,
    });
    // Moved by hand to flat: still counted in the arm it was assigned.
    await shopOn(db, { ...percent, pricingPlan: "flat_monthly", pricingPlanSource: "override" });
    // Never counted: a demo, and a row nobody can sign into.
    await shopOn(db, { ...flat, paidTotalCents: 99_900 }, { isDemo: true });
    await shopOn(db, { ...flat, paidTotalCents: 99_900 }, { login: false });
    await db.insert(pricingVolumeStatements).values({
      shopId: paying,
      month: "2031-06-01",
      volumeCents: 150_000,
      basisPoints: 300,
      feeCents: 4_500,
      stripeMeterIdentifier: "id",
    });

    expect(await pricingTestByArm(db)).toEqual([
      {
        arm: "flat_monthly",
        setupRequests: 1,
        shops: 3,
        cardsAdded: 2,
        firstPaid: 2,
        activeNow: 1,
        canceled: 1,
        revenueCents: 29_700,
        payingShops: 2,
        volumeCents: 0,
      },
      {
        arm: "percent_of_volume",
        setupRequests: 2,
        shops: 2,
        cardsAdded: 1,
        firstPaid: 1,
        activeNow: 1,
        canceled: 0,
        revenueCents: 4_500,
        payingShops: 1,
        volumeCents: 150_000,
      },
    ]);
  });
});
