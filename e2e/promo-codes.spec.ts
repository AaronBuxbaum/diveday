import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard } from "./helpers";

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

test.describe("as captain", () => {
  signedInAs("captain");

  test("a non-owner is bounced to Settings with the promo-specific refusal, not the rentals one", async ({
    page,
  }) => {
    // A captain has no use for promo codes (they discount real money). Lands on
    // Settings — this gate's redirect target — but must show *why Promos
    // refused*, not Settings' own rental-prices `not_authorized` message
    // (task 82, UX persona 11 "Kai").
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
    // search can't tell the two apart, but the alert region can. Also filtered
    // by text: Next's own always-present `#__next-route-announcer__` carries
    // `role="alert"` too, so an unfiltered query is ambiguous the moment
    // FlashParams' `history.replaceState` call above makes the router treat
    // this as a navigation and mount it.
    const flash = page.getByRole("alert").filter({ hasText: "Promo codes discount real money" });
    await expect(flash).toContainText(
      "Promo codes discount real money, so they're limited to owners and managers.",
    );
    await expect(flash).not.toContainText(
      "The rental catalog, rental prices, and Stripe connection",
    );
  });
});

test.describe("as owner", () => {
  signedInAsOwner();

  test("an owner sees the shop's codes with their scope, window, and redemption count", async ({
    page,
  }) => {
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

  /**
   * The promo box rides on pay-at-booking, which needs three things at once
   * (schedule/[id]/page.tsx): a priced trip, a Stripe account that can take a
   * charge, and `publicAppUrl()` — a configured public origin for Stripe's
   * return links. This fleet runs `next start` (a production runtime) with
   * `APP_HOST` deliberately blanked in playwright.config.ts's `serverEnv`, and
   * `checkPublicHost` refuses a loopback origin in production, so
   * `publicAppUrl()` is null here and pay-at-booking can never switch on — the
   * same limitation schedule-embed.spec.ts and visual.spec.ts both document
   * against this same helper.
   *
   * So this pins the state the fleet can actually reach, which is a real one
   * (any deploy that forgets APP_HOST lands in it): the shop is connected to
   * Stripe, and the booking form still falls back to book-now-pay-later with
   * no promo box and no payment hand-off. What it deliberately does *not*
   * claim is that a diver can type a code — that half is unreachable here, and
   * the promo resolution behind it is covered by src/lib/promo-codes.ts's unit
   * tests and by `bookSpot`'s. This test previously wrapped its whole body in
   * `if (await promoField.isVisible())`, which meant it asserted nothing at
   * all on every run since the day it was written.
   */
  test("a Stripe-connected shop with no public origin still books without a payment step", async ({
    page,
    request,
  }) => {
    await request.post("/api/test/seed-stripe-account");
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
    // The board links staff at trip *management*; the booking form a diver sees
    // is the public page for the same departure.
    const tripId = new URL(page.url()).pathname.split("/").pop();

    await page.context().clearCookies();
    await page.goto(`/s/blue-mantis/trips/${tripId}`);
    // Wait for the booking form itself before asserting anything is absent —
    // otherwise "no promo box" is indistinguishable from "the form hasn't
    // rendered yet".
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await expect(
      page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }),
    ).toBeVisible();
    await expect(page.getByLabel("Promo code")).toHaveCount(0);
    await expect(page.getByText("(if you have one)")).toHaveCount(0);
    await expect(page.getByText("You'll finish paying on a secure Stripe page.")).toHaveCount(0);
  });
});
