import type { DbExecutor } from "./client";
import { divePackages } from "./schema";

/**
 * **Two dive packages on sale**, so the demo's Packages tab, its public price
 * list, the booking flow's "use a prepaid dive" and the staff Discounts page
 * all have something to show (UX review 2026-10-10, item 18; ADR
 * 20260822-a-package-is-entitlements-not-money). `/s/blue-mantis/packages`
 * was a 404 on the demo although the feature shipped.
 *
 * **Stable half**, like the boats: a package is shop configuration, which
 * `/api/test/reset` leaves standing, so seeding it with the schedule would add
 * two more on every reset. A test that needs a shop with nothing on sale takes
 * a private shop, which mints without history and so without these.
 */
/*
 * **Priced as a deal** (H-20261014-package-dive-is-a, fourth UX review item 9). A package dive is one
 * tank, and the demo's two-tank boats sell at $95, so $47.50 a tank at the
 * door. The cards come in under it ($40 and $37.50 a tank); at $80 a dive the
 * card cost more than paying on the day and read as a mistake.
 */
export async function seedPackages(db: DbExecutor, shopId: string): Promise<void> {
  await db.insert(divePackages).values([
    // i18n-exempt: a shop names its own packages, like its packing list.
    { shopId, name: "Five-dive card", diveCount: 5, priceCents: 20_000, scope: "fun_dives" },
    // i18n-exempt: the shop's own words, not DiveDay's.
    { shopId, name: "Ten-dive card", diveCount: 10, priceCents: 37_500, scope: "fun_dives" },
  ]);
}
