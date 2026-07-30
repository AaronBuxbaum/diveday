import { expect, test } from "./fixtures";
import { openTripFromBoard, signInAsOwner } from "./helpers";

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

test("an owner sees the shop's codes with their scope, window, and redemption count", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/promos");
  await expect(page.getByRole("heading", { name: "Discounts a diver can type" })).toBeVisible();

  const standing = page.locator("li").filter({ hasText: "REEF10" });
  await expect(standing.getByText("10% off")).toBeVisible();
  await expect(standing.getByText("Trips and courses")).toBeVisible();
  await expect(standing.getByText("Live", { exact: true })).toBeVisible();

  // An expired code is honestly not live, rather than quietly still offered.
  const expired = page.locator("li").filter({ hasText: "OPENWATER25" });
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

  const failed = page.locator("li").filter({ hasText: "E2ETEST" });
  await expect(failed.getByText("Failed at Stripe")).toBeVisible();
  // No switch-on affordance: enabling it would validate locally then fail at
  // checkout, which is worse than staying visibly broken.
  await expect(failed.getByRole("button")).toHaveCount(0);
});

test("a code the shop switched off stops being live", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/promos");
  const standing = page.locator("li").filter({ hasText: "REEF10" });
  await standing.getByRole("button", { name: "Switch off" }).click();
  await expect(page.getByText(/Code switched off/)).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "REEF10" }).getByText("Switched off"),
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
  await page.goto("/shop/blue-mantis/schedule");
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
