/**
 * `pnpm billing:pricing-test` — the pricing A/B test, one row per arm (ADR
 * 20261022-pricing-ab-test): set-up requests, shops, cards added, first paid,
 * active now, canceled, DiveDay revenue in total and per paying shop, and the
 * percent arm's card volume. Real shops only. Read-only; runs against whatever
 * database `getDb()` resolves, like `pnpm billing:free-term`.
 */
import { getDb } from "@/db/client";
import { pricingTestByArm } from "@/db/pricing-test-report";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function main(): Promise<number> {
  const rows = await pricingTestByArm(await getDb());
  console.table(
    rows.map((row) => ({
      arm: row.arm,
      "set-up requests": row.setupRequests,
      shops: row.shops,
      "cards added": row.cardsAdded,
      "first paid": row.firstPaid,
      "active now": row.activeNow,
      canceled: row.canceled,
      revenue: dollars(row.revenueCents),
      "per paying shop": row.payingShops > 0 ? dollars(row.revenueCents / row.payingShops) : "-",
      "card volume": dollars(row.volumeCents),
    })),
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
