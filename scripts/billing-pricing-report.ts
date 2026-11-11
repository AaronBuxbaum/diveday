/** Read-only billing performance by current plan: pnpm billing:pricing-report. */
import { getDb } from "@/db/client";
import { pricingByPlan } from "@/features/pricing-report";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function main(): Promise<number> {
  const rows = await pricingByPlan(await getDb());
  console.table(
    rows.map((row) => ({
      plan: row.plan,
      "set-up requests": row.setupRequests,
      shops: row.shops,
      "cards added": row.cardsAdded,
      "first paid": row.firstPaid,
      "active now": row.activeNow,
      canceled: row.canceled,
      revenue: dollars(row.revenueCents),
      "per paying shop": row.payingShops > 0 ? dollars(row.revenueCents / row.payingShops) : "-",
      "recorded USD collections": dollars(row.volumeCents),
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
