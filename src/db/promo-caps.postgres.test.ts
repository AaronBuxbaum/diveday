import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fakePromotions } from "@/test/fakes";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { startPaymentOperation } from "./payment-operations";
import { reserveDiscountUse } from "./promo-caps";
import { paymentOperationIntents, shops } from "./schema";
import { createShopPromoCode } from "./shop-promos";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";

/**
 * A "first diver only" code under genuine contention (A§4 item 6).
 *
 * `reserveDiscountUse` takes a transaction-scoped advisory lock keyed on the
 * discount, re-counts the code's uses under it, and tags the winner's
 * payment-operation intent before letting go. PGlite is one connection, so
 * every other test of it runs the attempts one after another and stays green
 * with the lock deleted. Here five checkouts, each on its own connection, are
 * parked behind a gate holding that same advisory lock, and released together.
 *
 * **The outcome is the assertion**: exactly one attempt reserved the single
 * use and exactly one intent carries the code. The gate establishes only that
 * the five were in flight at once (docs/engineering/testing.md, "Reading a race
 * test correctly"). With the lock removed from `reserveDiscountUse` nothing
 * parks on the gate, so `waitForLockWaiters` times out instead: the run still
 * fails, on the wait rather than on the count.
 */

const promoCapLock = (promoId: string) =>
  sql`select pg_advisory_xact_lock(hashtext('promo_cap'), hashtext(${promoId}::text))`;

describePostgres("reserveDiscountUse under real concurrency", () => {
  it("gives a one-use code to exactly one of five simultaneous checkouts", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Caps ${suffix}`, slug: `caps-${suffix}`, timezone: "America/New_York" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const account = `acct_caps_${suffix}`;
    await upsertShopStripeAccount(pg.db, shop.id, account);
    await setShopStripeAccountStatus(pg.db, account, {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const created = await createShopPromoCode(
      pg.db,
      { shopId: shop.id, code: "FIRSTONE", discountPercent: 10, scope: "all", maxRedemptions: 1 },
      fakePromotions(),
    );
    if (!created.ok) throw new Error(`promo creation failed: ${created.reason}`);
    const promoId = created.promo.id;
    const intents = await Promise.all(
      Array.from({ length: 5 }, () =>
        startPaymentOperation(pg.db, { shopId: shop.id, kind: "checkout_session" }),
      ),
    );

    const gate = await holdRowLock(pg, promoCapLock(promoId));
    const attempts = intents.map((intent) =>
      reserveDiscountUse(pg.connect(), {
        shopId: shop.id,
        source: "shop",
        promoId,
        intentId: intent.id,
        now: nowDate(),
      }),
    );
    await waitForLockWaiters(pg.db, intents.length);
    await gate.release();
    const outcomes = await Promise.all(attempts);

    expect(outcomes.filter((outcome) => outcome === "reserved")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "used_up")).toHaveLength(4);
    const tagged = await pg.db
      .select({ id: paymentOperationIntents.id })
      .from(paymentOperationIntents)
      .where(eq(paymentOperationIntents.promoCodeId, promoId));
    expect(tagged).toHaveLength(1);
  });
});
