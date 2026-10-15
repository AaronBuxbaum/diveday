import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fakePromotions } from "@/test/fakes";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { startPaymentOperation } from "./payment-operations";
import { reserveDiscountUse } from "./promo-caps";
import { createShopPromoCode } from "./shop-promos";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";

/**
 * The last use of a capped discount code, taken by two checkouts at once
 * (fourth review, row 33). `reserveDiscountUse` counts and tags under a
 * transaction-scoped advisory lock keyed on the code; PGlite cannot hold two
 * transactions, so this is the first test where two attempts meet. Without the
 * lock both count zero uses, both tag their intent, and both reach Stripe with
 * a code that had one use left.
 */

describePostgres("reserveDiscountUse under real concurrency", () => {
  it("gives the last use of a capped code to exactly one of two checkouts", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db, "Promo Reef");
    await upsertShopStripeAccount(pg.db, shop.id, "acct_race");
    await setShopStripeAccountStatus(pg.db, "acct_race", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const created = await createShopPromoCode(
      pg.db,
      { shopId: shop.id, code: "LAST1", discountPercent: 10, scope: "all", maxRedemptions: 1 },
      fakePromotions(),
    );
    if (!created.ok) throw new Error(`promo refused: ${created.reason}`);
    const ref = {
      shopId: shop.id,
      source: "shop" as const,
      promoId: created.promo.id,
      now: nowDate(),
    };
    const intents = [
      await startPaymentOperation(pg.db, { shopId: shop.id, kind: "checkout_session" }),
      await startPaymentOperation(pg.db, { shopId: shop.id, kind: "checkout_session" }),
    ];

    const gate = await holdRowLock(
      pg,
      sql`select pg_advisory_xact_lock(hashtext('promo_cap'), hashtext(${created.promo.id}::text))`,
    );
    const attempts = intents.map((intent) =>
      reserveDiscountUse(pg.connect(), { ...ref, intentId: intent.id }),
    );
    await waitForLockWaiters(pg.db, attempts.length);
    await gate.release();

    expect((await Promise.all(attempts)).sort()).toEqual(["reserved", "used_up"]);
  });
});
