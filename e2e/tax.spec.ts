import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openSettingsRow } from "./helpers";

/**
 * Per-shop Stripe Tax (issue #959, ADR
 * 20260826-stripe-tax-is-opt-in-and-provider-owned): a shop opts in, and from
 * then on Stripe calculates sales tax / VAT on top of the listed prices for
 * booking checkouts and staff invoices alike. DiveDay keeps no rate tables and
 * computes no tax — the connected account's own Stripe Tax registrations are
 * the source of truth, and the amount is only ever read back off a paid
 * session.
 *
 * ## What only a browser can prove here
 *
 * The permission gate and the stored column are already pinned server-side
 * (`settings/actions.authz.test.ts` refuses a captain and round-trips an
 * owner), and the provider forms are pinned in `src/lib/payments/*.test.ts`.
 * What none of those can see is the **consequence one surface has on
 * another**: turning the setting on in Settings is what makes the staff
 * invoice form grow a customer billing address, because Stripe Tax cannot
 * calculate without a location. Those two files never import each other, so
 * only a real round trip through both connects them.
 *
 * ## Why every test here takes a shop of its own
 *
 * `shops.tax_enabled` is shop-wide configuration, and `/api/test/reset`
 * restores the shared blue-mantis fixture's *schedule*, not its settings — the
 * `shops` row survives a reset by design. A spec that drove the demo shop's tax
 * flag would hand it to whichever spec Playwright's sharding ran next in the
 * same worker, which is exactly the failure ADR
 * 20260815-per-test-private-shops exists to stop. So each test mints its own
 * seeded shop through `privateShop` and drives *its* setting. Never a `finally`
 * that puts the flag back: that is a convention nothing enforces, and it does
 * not survive the failure it is there for.
 */

/** The tax row's own disclosure, so a bare "On"/"Off" is never read off a neighbour. */
function taxRow(page: Page) {
  return page
    .locator("details")
    .filter({ has: page.getByRole("heading", { level: 3, name: "Sales tax & VAT", exact: true }) })
    .first();
}

/** Tick or clear the opt-in and wait for the save to land. Leaves the page on settings. */
async function setTax(page: Page, shopSlug: string, enabled: boolean) {
  await page.goto(`/shop/${shopSlug}/settings`);
  await openSettingsRow(page, "Sales tax & VAT");
  const checkbox = page.getByLabel("Use Stripe Tax for new booking and invoice payments");
  await checkbox.setChecked(enabled);
  await page.getByRole("button", { name: "Save tax setting" }).click();
  await expect(page.getByText("Tax setting saved.")).toBeVisible();
}

test.describe("Stripe Tax opt-in", () => {
  // Each test mints a whole seeded shop, signs in as its owner, and drives
  // settings and the invoice form across several full page loads with a
  // server-action write between them — the same budget `e2e/currency.spec.ts`
  // documents for the identical shape. A hang still fails the 8s expect
  // timeout inside, so this can't mask one.
  test.setTimeout(60_000);

  /**
   * Off is the default and the shop is told so in words, not by an unticked
   * box it has to go looking for. A shop that handles tax outside DiveDay must
   * never discover it was being charged because a default leaned the other way.
   */
  test("a shop starts with tax off and says so on the row", async ({ page, privateShop }) => {
    await page.goto(`/shop/${privateShop.slug}/settings`);

    await expect(taxRow(page)).toContainText("Off");

    await openSettingsRow(page, "Sales tax & VAT");
    await expect(
      page.getByLabel("Use Stripe Tax for new booking and invoice payments"),
    ).not.toBeChecked();
  });

  test("turning tax on survives a reload, and turning it back off does too", async ({
    page,
    privateShop,
  }) => {
    await setTax(page, privateShop.slug, true);
    await expect(taxRow(page)).toContainText("On");

    // Reload rather than trust the post-action render: the claim is that the
    // column was written, not that the form echoed the box back.
    await page.goto(`/shop/${privateShop.slug}/settings`);
    await expect(taxRow(page)).toContainText("On");
    await openSettingsRow(page, "Sales tax & VAT");
    await expect(
      page.getByLabel("Use Stripe Tax for new booking and invoice payments"),
    ).toBeChecked();

    // The half a shop reaches for when it decides to handle tax itself. An
    // unchecked checkbox posts no field at all, so this is a genuinely
    // different code path from the one above, not its mirror image.
    await setTax(page, privateShop.slug, false);
    await page.goto(`/shop/${privateShop.slug}/settings`);
    await expect(taxRow(page)).toContainText("Off");
  });

  /**
   * The cross-surface consequence, and the reason this spec exists. Stripe Tax
   * needs a customer location to pick a jurisdiction, so an invoice raised
   * under it collects a billing address the untaxed form never asks for — and
   * `createOrder` refuses to send without one. Asserting the *absence* first is
   * what makes the presence mean something.
   */
  test("tax makes the staff invoice form collect a billing address", async ({
    page,
    request,
    privateShop,
  }) => {
    // A shop with nowhere to send money never gets an order form at all, so
    // connect this one first. Marks the row in the database; nothing reaches
    // Stripe, and this fleet sets no `STRIPE_SECRET_KEY` anyway.
    const connected = await request.post(
      `/api/test/seed-stripe-account?slug=${encodeURIComponent(privateShop.slug)}`,
    );
    expect(connected.ok()).toBe(true);

    const newOrder = `/shop/${privateShop.slug}/orders/new`;
    await page.goto(newOrder);
    await expect(page.getByRole("heading", { level: 1, name: "New order" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Customer billing address" })).toHaveCount(0);

    await setTax(page, privateShop.slug, true);

    await page.goto(newOrder);
    const billing = page.getByRole("group", { name: "Customer billing address" });
    await expect(billing).toBeVisible();
    // The field that actually picks the jurisdiction, and the one the domain
    // layer refuses to send without (`isUsableInvoiceCustomerAddress`). Exact,
    // because a substring "Address" also matches "Address line 2" beside it.
    await expect(billing.getByLabel("Address", { exact: true })).toHaveAttribute("required", "");
    await expect(billing.getByLabel("Country code", { exact: true })).toHaveAttribute(
      "required",
      "",
    );
  });
});
