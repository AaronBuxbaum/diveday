import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { InvoicingProvider } from "@/lib/payments/invoicing";
import { fileScopedShopContext } from "@/test/db";
import { sendDeal } from "@/test/deal";
import { fakePromotions } from "@/test/fakes";
import { createDivePackage } from "./dive-packages";
import { askAnytime } from "./interests";
import { createDiverPackageOrder } from "./orders";
import { people, shops } from "./schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { getActiveTripPromoByCode } from "./trip-promos";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

async function connected() {
  const { db, shop } = ctx;
  await upsertShopStripeAccount(db, shop.id, "acct_switch");
  await setShopStripeAccountStatus(db, "acct_switch", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  return { db, shop };
}

/** A provider that fails the test if anything reaches Stripe. */
const noInvoicing = new Proxy({} as InvoicingProvider, {
  get() {
    throw new Error("a switched-off sale must not reach Stripe");
  },
});

/**
 * **A hand-built post sells nothing a shop switched off** (the Features page).
 * The pages are gone; these are the writers under them.
 */
describe("sales behind a switched-off feature", () => {
  it("refuses a package order while dive packages are off, before keeping any details", async () => {
    const { db, shop } = await connected();
    const pkg = await createDivePackage(db, {
      shopId: shop.id,
      name: "Ten-dive card",
      diveCount: 10,
      priceCents: 45_000,
      scope: "all",
      validUntil: null,
    });
    if (!pkg) throw new Error("package not created");
    await db.update(shops).set({ divePackagesEnabled: false }).where(eq(shops.id, shop.id));

    const outcome = await createDiverPackageOrder(
      db,
      {
        shopId: shop.id,
        packageId: pkg.id,
        fullName: "Hana Handbuilt",
        email: "hana.handbuilt@example.com",
        lineDescription: "Ten-dive card",
      },
      noInvoicing,
    );

    expect(outcome).toEqual({ ok: false, reason: "not_on_sale" });
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.email, "hana.handbuilt@example.com"));
    expect(person).toBeUndefined();
  });

  it("stops applying a deal already sent once the last-minute list is off, and keeps it", async () => {
    const { db, shop } = await connected();
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
      (row) => row.title === "Two-Tank Reef — Christ of the Abyss",
    );
    if (!trip) throw new Error("seeded trip missing");
    await askAnytime(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
      declaration: { level: "open_water", noCertification: false, nitrox: false },
    });
    const deal = await sendDeal(
      db,
      { shopId: shop.id, shopSlug: shop.slug, tripId: trip.id, discountPercent: 25 },
      fakePromotions(),
    );
    if (!deal.ok) throw new Error("deal not sent");
    const lookup = { shopId: shop.id, tripId: trip.id, code: deal.code };

    await db.update(shops).set({ lastMinuteListEnabled: false }).where(eq(shops.id, shop.id));
    expect(await getActiveTripPromoByCode(db, lookup)).toBeNull();

    await db.update(shops).set({ lastMinuteListEnabled: true }).where(eq(shops.id, shop.id));
    expect((await getActiveTripPromoByCode(db, lookup))?.id).toBe(deal.promoId);
  });
});
