import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";

/**
 * Staff invoicing — `/shop/[shopSlug]/orders/new`, the front desk's "bill this
 * diver" form. It shipped with no e2e or visual coverage at all (the
 * 2026-08-03 test-system evaluation found it, hence the exemption
 * `scripts/route-coverage.json` carried for this route until this spec landed).
 *
 * ## The boundary this spec stops at
 *
 * A *successful* order cannot be produced in this fleet, and that is a property
 * of the environment rather than a gap in the test. `createOrder` (src/db/orders.ts)
 * writes its durable payment-intent row, then calls Stripe to create the real
 * invoice, and only inserts the local `orders` row once Stripe confirms. The
 * fleet sets no `STRIPE_SECRET_KEY`, so `invoicingProviderFromEnvironment()`
 * hands back `disabledInvoicingProvider` and every valid submission resolves as
 * `not_configured` → `stripe_failed`. `DIVEDAY_DISABLE_EXTERNAL_HTTP=1` means
 * nothing would reach Stripe even if a key were present.
 *
 * So this spec pins everything reachable *without* a live charge — the same
 * framing e2e/refunds.spec.ts and e2e/promo-codes.spec.ts use:
 *
 * - the connect-first refusal (no order form at all until the shop can take money);
 * - the form rendering against real seeded customers;
 * - both pre-Stripe validation refusals, which never call Stripe;
 * - the Stripe-step failure, which is what a real submission actually reaches here.
 *
 * Orders that *exist* — the index, an order's detail, its money formatting — come
 * from the seed and are covered by e2e/orders-demo.spec.ts and the `orders` /
 * `order-detail` visual captures.
 */

const NEW_ORDER = "/shop/blue-mantis/orders/new";
// `${fullName} — ${email}`, both deterministic in the seed (src/db/seed.ts).
const CUSTOMER = "Priya Sharma — priya.sharma@example.com";

test("the order form is not reachable signed out", async ({ page }) => {
  await page.goto(NEW_ORDER);
  await expect(page).toHaveURL(/\/sign-in/);
});

test.describe("as owner", () => {
  signedInAsOwner();

  test("a shop that can't take money is sent to its divers instead of an order form", async ({
    page,
  }) => {
    // No /api/test/seed-stripe-account here: the demo shop starts unconnected,
    // and `canAcceptPayments` is what the page checks before rendering a single
    // field. An invoice form for a shop with nowhere to send the money would be
    // a dead end, so the route redirects rather than showing one.
    await page.goto(NEW_ORDER);
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/divers$/);
  });

  test("an owner builds an invoice and it gets as far as Stripe, which this fleet can't reach", async ({
    page,
    request,
  }) => {
    // Marks the demo shop connected + charges-enabled in the database without
    // ever calling Stripe (the route's own doc comment) — it unlocks the
    // surface, never a real charge.
    await request.post("/api/test/seed-stripe-account");

    await page.goto(NEW_ORDER);
    await expect(page.getByRole("heading", { level: 1, name: "New order" })).toBeVisible();

    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByLabel("Order note").fill("Two-tank reef trip + rental set");
    // Row 0 of the four fixed line-item rows. The kind select and the
    // description input are unlabelled by design (a compact grid), so they are
    // reached by name; quantity and unit price carry aria-labels.
    const firstRow = page.locator('select[name="kind-0"]').filter({ visible: true });
    await firstRow.selectOption("trip_fee");
    await page
      .locator('input[name="description-0"]')
      .filter({ visible: true })
      .fill("Two-Tank Reef — Molasses & French");
    await page.locator('input[name="quantity-0"]').filter({ visible: true }).fill("2");
    await page.locator('input[name="unitAmount-0"]').filter({ visible: true }).fill("129.00");

    await page.getByRole("button", { name: "Create and send invoice" }).click();

    // The honest end of the road in this fleet: the form's own danger banner,
    // and staff are left on the page with the invoice still to send — not
    // dropped on an order that doesn't exist. Filtered by text because Next's
    // always-present `#__next-route-announcer__` also carries `role="alert"`,
    // so an unfiltered query is ambiguous the moment a navigation mounts it.
    await expect(page.getByRole("alert").filter({ hasText: "Stripe" })).toContainText(
      "Stripe couldn't create that invoice. Try again in a moment.",
    );
    await expect(page).toHaveURL(/\/orders\/new/);
    await expect(page.getByRole("heading", { level: 1, name: "New order" })).toBeVisible();
  });

  test("an invoice with no priced line, or an out-of-bounds one, is refused before Stripe", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");

    // A customer but no line items at all: refused by the action itself, no
    // payment intent and no Stripe call.
    await page.goto(NEW_ORDER);
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page.getByRole("button", { name: "Create and send invoice" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Pick a customer" })).toContainText(
      "Pick a customer and at least one line item with an amount.",
    );

    // A typed line whose amount is past the bound fails the *whole*
    // submission rather than silently dropping that row — a staff member who
    // typed four lines must never end up with a three-line invoice (CR-016).
    //
    // Re-navigating first, deliberately: this refusal renders the same words
    // as the one above, so asserting against a page that still carries the
    // previous banner would pass without the second submission ever happening.
    await page.goto(NEW_ORDER);
    await expect(page.getByRole("alert").filter({ hasText: "Pick a customer" })).toHaveCount(0);
    await page.getByLabel("Customer").selectOption({ label: CUSTOMER });
    await page
      .locator('input[name="description-0"]')
      .filter({ visible: true })
      .fill("Private charter");
    await page.locator('input[name="unitAmount-0"]').filter({ visible: true }).fill("250000");
    await page.getByRole("button", { name: "Create and send invoice" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Pick a customer" })).toContainText(
      "Pick a customer and at least one line item with an amount.",
    );
  });
});

test.describe("as captain", () => {
  signedInAs("captain");

  /**
   * Pinning current behaviour, deliberately: unlike `/shop/[shopSlug]/promos`,
   * which refuses a captain outright, this route's only gate is
   * `requireStaffSession()` plus "can this shop take money" — there is no
   * owner/manager check on the page or on `createOrderAction`. Any staff member
   * can raise an invoice today. If that is ever meant to be owner/manager work,
   * this test is where the decision becomes visible instead of silent.
   */
  test("any staff member can reach the order form — there is no owner/manager gate today", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");
    await page.goto(NEW_ORDER);
    await expect(page.getByRole("heading", { level: 1, name: "New order" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create and send invoice" })).toBeVisible();
  });
});
