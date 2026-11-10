/** Organizer payment ledgers before and after unpaid holds expire. */
import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
const t = diverTranslator("en-US");
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "group-hold-ledger-divers",
    });
    for (const expired of [false, true]) {
      test(`organizer group hold ledger ${expired ? "expired" : "active"} (${scheme})`, async ({
        page,
        request,
        privateShop,
      }) => {
        const name = expired ? "expiredGroupHoldLedger" : "groupHoldLedger";
        const values = await seedFacts(request, ["stripeAccount", name], {
          slug: privateShop.slug,
        });
        const fact = values[name] as { token: string };
        await page.goto(`/ready/${fact.token}`);
        await expect(
          page.getByText(t("seatClaim.paidSummary", { paid: 1, total: 3 })),
        ).toBeVisible();
        await capture(
          page,
          expired ? "group-hold-ledger-expired" : "group-hold-ledger-active",
          scheme,
        );
      });
    }
  });
}
