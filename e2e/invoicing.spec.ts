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
 * - the role refusal (raising an invoice is owner/manager work, H-14);
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

  test("a shop that can't take money lands on Orders with the reason, not a dead order form", async ({
    page,
  }) => {
    // No /api/test/seed-stripe-account here: the demo shop starts unconnected,
    // and `canAcceptPayments` is what the page checks before rendering a single
    // field. An invoice form for a shop with nowhere to send the money would be
    // a dead end, so the route lands back on Orders and says why — with the
    // connect path offered — instead of silently dumping on the divers list
    // (the explained-landing rule every payment gate now follows). FlashParams
    // strips the query, so assert the banner, not the URL param.
    await page.goto(NEW_ORDER);
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/orders$/);
    await expect(page.getByText(/Payments aren't connected yet/).first()).toBeVisible();
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
   * Billing a diver is owner/manager work, same as the refund on the order it
   * becomes and the discount codes that set what a trip costs (H-14, ADR
   * 20260724-role-authorization, extended by 20260803-invoicing-role-gate).
   * This spec used to pin the opposite — any staff role could raise an invoice —
   * as the place that decision would become visible; it was made, and this is
   * now the refusal.
   *
   * A captain keeps *reading* orders, which is why the landing is the Orders
   * index with the reason rather than Today: the door is closed, not the room.
   */
  test("a captain is turned away from the order form and told why", async ({ page, request }) => {
    await request.post("/api/test/seed-stripe-account");
    await page.goto(NEW_ORDER);

    await expect(page).toHaveURL(/\/shop\/blue-mantis\/orders$/);
    // FlashParams strips the query, so assert the banner, not the URL param.
    await expect(page.getByText(/limited to owners and managers/).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "New order" })).toHaveCount(0);
  });
});
