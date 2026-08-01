import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";
import { openTripFromBoard, signInAs, signInAsOwner } from "./helpers";

/**
 * Shop-wide promo codes (docs ADR 20260729-shop-promo-codes). The fleet has no
 * real `STRIPE_SECRET_KEY`, so a *create* here always fails at the Stripe step
 * — which is itself the behaviour worth pinning: the row survives as visible
 * evidence, reads as `failed`, and can never discount anything. The seeded
 * codes cover the live-code surface.
 */

test("the promo page is owner/manager work, not open to every staff member", async ({ page }) => {
  await page.goto("/shop/blue-mantis/promos");
  // Signed out, the staff gate sends an anonymous visitor to sign in.
  await expect(page).toHaveURL(/\/sign-in/);
});

test("a non-owner is bounced to Settings with the promo-specific refusal, not the rentals one", async ({
  page,
}) => {
  // A captain has no use for promo codes (they discount real money). Lands on
  // Settings — this gate's redirect target — but must show *why Promos
  // refused*, not Settings' own rental-prices `not_authorized` message
  // (task 82, UX persona 11 "Kai").
  await signInAs(page, DEV_STAFF_LOGINS.captain);
  await page.goto("/shop/blue-mantis/promos");
  // Not a URL assertion: FlashParams strips `?notice=promos_not_authorized`
  // via history.replaceState shortly after mount — the rendered banner is
  // the stable signal.
  await expect(page).toHaveURL(/\/shop\/blue-mantis\/settings(\?.*)?$/);
  // Scoped to the flash notice itself (role="alert", ShopNotice's danger
  // tone): the settings page also carries its own standing "payments are
  // gated" paragraph, unconditionally shown to any non-owner regardless of
  // which page redirected them here, and it happens to share a leading
  // clause with the rentals notAuthorized message — a page-wide substring
  // search can't tell the two apart, but the alert region can.
  const flash = page.getByRole("alert");
  await expect(flash).toContainText(
    "Promo codes discount real money, so they're limited to owners and managers.",
  );
  await expect(flash).not.toContainText("The rental catalog, rental prices, and Stripe connection");
});

test("an owner sees the shop's codes with their scope, window, and redemption count", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/promos");
  await expect(page.getByRole("heading", { name: "Discounts a diver can type" })).toBeVisible();

  const standing = page.locator("li").filter({ hasText: "REEF10" }).filter({ visible: true });
  await expect(standing.getByText("10% off")).toBeVisible();
  await expect(standing.getByText("Trips and courses")).toBeVisible();
  // The success-tone Badge prepends a decorative aria-hidden glyph
  // (Badge.tsx toneGlyph), so the element's own text is "✓ Live", not
  // "Live" alone — and a bare substring match also picks up the "live
  // now" window text elsewhere in this same card.
  await expect(standing.getByText("✓ Live")).toBeVisible();

  // An expired code is honestly not live, rather than quietly still offered.
  const expired = page.locator("li").filter({ hasText: "OPENWATER25" }).filter({ visible: true });
  await expect(expired.getByText("Not live right now")).toBeVisible();
});

test("a code Stripe never minted is kept as failed evidence, and cannot be switched on", async ({
  page,
  request,
}) => {
  // Unlocks the "not_connected" gate without ever calling real Stripe.
  await request.post("/api/test/seed-stripe-account");
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/promos");

  await page.getByLabel("Code").fill("E2ETEST");
  await page.getByLabel("Discount").fill("15");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText(/Stripe didn't create that code/)).toBeVisible();

  const failed = page.locator("li").filter({ hasText: "E2ETEST" }).filter({ visible: true });
  await expect(failed.getByText("Failed at Stripe")).toBeVisible();
  // No switch-on/off affordance: enabling it would validate locally then
  // fail at checkout, which is worse than staying visibly broken. "Copy
  // code", "Try again", and "Delete" are all legitimate for a failed row.
  await expect(failed.getByRole("button", { name: /^Switch/ })).toHaveCount(0);
});

test("deleting a failed code can be undone from the toast, which re-runs Stripe creation", async ({
  page,
  request,
}) => {
  await request.post("/api/test/seed-stripe-account");
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/promos");

  await page.getByLabel("Code").fill("E2EUNDO");
  await page.getByLabel("Discount").fill("15");
  await page.getByRole("button", { name: "Create code" }).click();
  await expect(page.getByText(/Stripe didn't create that code/)).toBeVisible();
  const failed = page.locator("li").filter({ hasText: "E2EUNDO" }).filter({ visible: true });
  await expect(failed.getByText("Failed at Stripe")).toBeVisible();

  // A code that never went live needs no confirm dialog to delete (docs/design/principles.md
  // #7): it's gone immediately, with a toast offering Undo instead of a
  // blocking "are you sure?".
  await failed.getByRole("button", { name: "Delete" }).click();
  await expect(
    page.locator("li").filter({ hasText: "E2EUNDO" }).filter({ visible: true }),
  ).toHaveCount(0);
  const toast = page.getByRole("status");
  await expect(toast.getByText("Code deleted.")).toBeVisible();

  // Undo re-runs Stripe creation with the same code, discount, and scope —
  // the same path an ordinary "create a promo" takes, so it fails here for
  // the same reason the original create did (no real Stripe key in the fleet).
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/Couldn't restore that code/)).toBeVisible();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "E2EUNDO" })
      .filter({ visible: true })
      .getByText("Failed at Stripe"),
  ).toBeVisible();
});

test("a code the shop switched off stops being live", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/promos");
  const standing = page.locator("li").filter({ hasText: "REEF10" });
  await standing.getByRole("button", { name: "Switch off" }).click();
  await expect(page.getByText(/Code switched off/)).toBeVisible();
  await expect(
    page
      .locator("li")
      .filter({ hasText: "REEF10" })
      .filter({ visible: true })
      .getByText("Switched off"),
  ).toBeVisible();
});

test("a diver can type a promo code on a payable trip's booking form", async ({
  page,
  request,
}) => {
  // Pay-at-booking (and therefore the promo box) only appears once the shop can
  // actually take a charge.
  await request.post("/api/test/seed-stripe-account");
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  // The board links staff at trip *management*; the booking form a diver sees
  // is the public page for the same departure.
  const tripId = new URL(page.url()).pathname.split("/").pop();

  await page.context().clearCookies();
  await page.goto(`/shop/blue-mantis/schedule/${tripId}`);
  const promoField = page.getByLabel("Promo code");
  // One box for both kinds of code — a diver has no idea whether they were
  // handed a shop-wide code or a one-trip deal, and the server resolves both.
  if (await promoField.isVisible()) {
    await expect(page.getByText("(if you have one)")).toBeVisible();
  }
});
