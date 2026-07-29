import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

/**
 * Fill-the-boat: a diver opts into the shop-wide last-minute list, staff see
 * a Today nudge on the under-capacity trip departing today (the seeded
 * "Two-Tank Reef — Molasses & French", same trip today.test.ts anchors on),
 * and the trip's own page reflects both the eligible count and a send
 * attempt. The e2e fleet never configures a real STRIPE_SECRET_KEY (docs ADR
 * 20260727-last-minute-fill-promos), so this only exercises up to Stripe
 * actually minting the coupon/promotion code — the same boundary every other
 * payment-adjacent e2e spec in this suite already stops at.
 */
test("diver opts in, Today nudges staff, and the trip page reflects the send attempt", async ({
  page,
  request,
}) => {
  // Public opt-in, a staff sign-in, and two round trips through the send
  // action all in one flow — same reasoning as visual.spec.ts's heavier
  // multi-step tests for the suite's 15s default.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill("nora.e2e@example.com");
  // No upper bound — "around from" 2020 covers today's frozen-clock departure.
  await page.locator('input[name="availableFrom"]').fill("2020-01-01");
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You're on the list." })).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis");
  await expect(page.getByText("3 seats open with no last-minute deal sent yet.")).toBeVisible();

  await page.getByRole("link", { name: "Open guests" }).first().click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+\/guests$/);
  await expect(page.getByRole("heading", { name: "Last-minute deal" })).toBeVisible();
  const sendButton = page.getByRole("button", { name: /Send to \d+ diver/ });
  await expect(sendButton).toBeVisible();

  // Unlocks the "not_connected" gate without ever calling real Stripe (same
  // route the visual suite uses to render Stripe-gated surfaces).
  await request.post("/api/test/seed-stripe-account");
  await page.reload();
  await sendButton.click();
  await expect(
    page.getByText("Stripe couldn't create the discount code. Try again in a moment."),
  ).toBeVisible();

  // The attempt is durable evidence even though it failed — a staffer sees
  // it, not silence.
  await expect(page.getByText(/25% off/)).toBeVisible();
  await expect(page.getByText("failed", { exact: true })).toBeVisible();
});

test("a failed send attempt does not silence the Today nudge — nothing actually went out", async ({
  page,
  request,
}) => {
  test.setTimeout(45_000);
  await request.post("/api/test/seed-stripe-account");
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByLabel("Name").fill("Priya Shah");
  await page.getByLabel("Email").fill("priya.e2e@example.com");
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You're on the list." })).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis");
  await expect(page.getByText("3 seats open with no last-minute deal sent yet.")).toBeVisible();
  await page.getByRole("link", { name: "Open guests" }).first().click();
  // Stripe is seeded connected but has no real key, so this send fails at the
  // Stripe step — durable proof an *attempt* happened, but no code actually
  // went out, so the nudge (which dedupes on a genuinely `sent` row) must
  // keep prompting staff to try again rather than reading the attempt as done.
  await page.getByRole("button", { name: /Send to \d+ divers?/ }).click();
  await expect(page.getByText(/off · /)).toBeVisible();

  await page.goto("/shop/blue-mantis");
  await expect(page.getByText("3 seats open with no last-minute deal sent yet.")).toBeVisible();
});
