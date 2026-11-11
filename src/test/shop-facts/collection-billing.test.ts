import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getBookingPayment } from "@/db/payments";
import { collectionEntries, shopSubscriptions } from "@/db/schema";
import { getBillingPercentMonth } from "@/features/billing-page";
import { paymentMarkFactsForTrip } from "@/features/payment-marks";
import { shopPricing } from "@/features/shop-subscriptions";
import { DEFAULT_PRICING_CONFIG } from "@/lib/billing/pricing-plans";
import { nowDate } from "@/lib/clock";
import { utcToWallTime } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import {
  seedCashReceipt,
  seedCollectionBilling,
  seedMixedCashReceipt,
  seedMixedDeposit,
} from "./collection-billing";

const ctx = fileScopedShopContext();
describe("collection billing browser facts", () => {
  it("opens a real cash receipt without creating an online capture", async () => {
    const { db, shop } = ctx;
    const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const fact = await seedCashReceipt(db, shop, actor, nowDate());
    expect(await getBookingPayment(db, shop.id, fact.bookingId)).toMatchObject({
      provider: null,
      amountCents: 12_000,
      manualHeldCents: 12_000,
    });
    expect(
      (
        await db
          .select()
          .from(collectionEntries)
          .where(eq(collectionEntries.sourceId, fact.bookingId))
      ).map((entry) => entry.amountCents),
    ).toEqual([12_000]);
  });
  it("builds real closed credit statements and separate native currency estimates", async () => {
    const { db, shop } = ctx;
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const now = nowDate();
    await db
      .insert(shopSubscriptions)
      .values({ shopId: shop.id, pricingPlan: "flat_monthly", pricingPlanSource: "assigned" })
      .onConflictDoUpdate({
        target: shopSubscriptions.shopId,
        set: { pricingPlan: "flat_monthly", pricingPlanSource: "assigned" },
      });
    await seedCollectionBilling(db, shop, owner, now);
    expect(
      (await db.select().from(shopSubscriptions).where(eq(shopSubscriptions.shopId, shop.id)))[0],
    ).toMatchObject({ pricingPlan: "percent_of_volume", planBasisPoints: 300 });
    expect(
      shopPricing(
        (
          await db.select().from(shopSubscriptions).where(eq(shopSubscriptions.shopId, shop.id))
        )[0] ?? null,
        DEFAULT_PRICING_CONFIG,
      ),
    ).toMatchObject({ plan: "percent_of_volume", monthlyCents: 0, basisPoints: 300 });
    const wall = utcToWallTime(now, shop.timezone);
    const rows = await getBillingPercentMonth(
      db,
      shop.id,
      { year: wall.year, month: wall.month },
      shop.timezone,
      null,
    );
    expect(rows.find((row) => row.currency === "usd")).toMatchObject({
      volumeCents: 7_000,
      statement: { feeCents: 150, refundCreditCents: 150 },
      pendingEvidence: false,
    });
    expect(rows.find((row) => row.currency === "jpy")).toMatchObject({
      volumeCents: 5_000,
      statement: null,
      pendingEvidence: false,
    });
  });
  it("opens a priced seat whose real checkout leaves an exact external balance", async () => {
    const { db, shop } = ctx;
    const fact = await seedMixedDeposit(db, shop, nowDate());
    expect(await getBookingPayment(db, shop.id, fact.bookingId)).toMatchObject({
      provider: "stripe",
      providerRef: `cs_visual_${fact.bookingId}`,
      status: "deposit_paid",
      amountCents: 5_000,
      manualHeldCents: 0,
    });
    expect(
      (await paymentMarkFactsForTrip(db, shop.id, fact.tripId)).get(fact.bookingId),
    ).toMatchObject({ balanceOwedCents: 7_000 });
  });
  it("opens the dedicated external-return control with only cash available to return", async () => {
    const { db, shop } = ctx;
    const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const fact = await seedMixedCashReceipt(db, shop, actor, nowDate());
    expect(await getBookingPayment(db, shop.id, fact.bookingId)).toMatchObject({
      provider: "mixed",
      amountCents: 12_000,
      manualHeldCents: 7_000,
    });
    expect(
      (await paymentMarkFactsForTrip(db, shop.id, fact.tripId)).get(fact.bookingId),
    ).toMatchObject({ onlineHeldCents: 5_000, manualHeldCents: 7_000 });
  });
});
