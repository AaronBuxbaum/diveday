import { expect, READ_ONLY, signedInAs, signedInAsOwner, test } from "./fixtures";

const BILLING = "/shop/blue-mantis/settings/billing";

/**
 * Settings > Billing, how a shop pays DiveDay (ADR 20261007-subscription-billing).
 *
 * The e2e fleet configures no `BILLING_STRIPE_*` values, and blocks external
 * HTTP on purpose, so the page is in its "not turned on" state — the state every
 * deployment is in until a human finishes the `stripe-billing-setup` manual
 * action. blue-mantis is a demo shop, which is never billed and says so ahead
 * of anything else; a real shop's "isn’t turned on yet" line is the
 * `settings-billing` capture in e2e/visual.spec.ts (a freshly onboarded shop)
 * and `settings/billing/page.test.tsx`. What these tests cover: the page
 * renders, offers no door to Stripe, and is the owner's alone. Checkout, the Portal and the webhook are
 * covered by unit tests against a faked Stripe (`settings/billing/actions.test.ts`,
 * `api/webhooks/billing/route.test.ts`).
 *
 * READ_ONLY: nothing here writes. `shop_subscriptions` is not restored by
 * `/api/test/reset`, and no test in this file can create a row in it.
 */

test.describe("Billing settings on the demo shop, before billing is turned on", () => {
  signedInAsOwner();

  test("says a demo shop is never billed, and offers no button to Stripe", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto(BILLING);

    await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
    await expect(page.getByText("A demo shop is never billed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a card" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Manage billing" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel plan" })).toHaveCount(0);
  });
});

test.describe("Billing settings, for anyone but the owner", () => {
  signedInAs("captain");

  test("sends a captain home with the reason", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto(BILLING);

    await expect(page).toHaveURL(/\/shop\/blue-mantis\?notice=billing-not-authorized$/);
    await expect(page.getByText("Billing is limited to the owner.")).toBeVisible();
  });
});
