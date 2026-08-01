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
  // Public opt-in, a staff sign-in, and two round trips through the send action
  // all in one flow — the suite's 15s default is sized for a single real flow,
  // not a chain of them.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill("nora.e2e@example.com");
  // No upper bound — "around from" 2020 covers today's frozen-clock departure.
  await page.locator('input[name="availableFrom"]').filter({ visible: true }).fill("2020-01-01");
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis");
  const nudge = page
    .locator("li")
    .filter({ hasText: "3 seats open with no last-minute deal sent yet." })
    .filter({ visible: true });
  await expect(nudge).toBeVisible();

  // "Open trip" (not the departure card's generic "Open guests") links to
  // this trip's own #last-minute-deal anchor, which is what auto-opens the
  // "Promote this trip" disclosure the deal panel lives behind (task 156).
  await nudge.getByRole("link", { name: "Open trip" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+\/guests#last-minute-deal$/);
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
  // it, not silence. Not exact: the badge's text is "Failed at Stripe"
  // (trips.lastMinute.status.failed), and its danger tone prepends a
  // decorative aria-hidden glyph on top of that (Badge.tsx toneGlyph).
  await expect(page.getByText(/25% off/)).toBeVisible();
  await expect(page.getByText(/failed/i)).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis");
  const nudge = page
    .locator("li")
    .filter({ hasText: "3 seats open with no last-minute deal sent yet." })
    .filter({ visible: true });
  await expect(nudge).toBeVisible();
  // "Open trip" (not the departure card's generic "Open guests") links to
  // this trip's own #last-minute-deal anchor, which is what auto-opens the
  // "Promote this trip" disclosure the deal panel lives behind (task 156).
  await nudge.getByRole("link", { name: "Open trip" }).click();
  // Stripe is seeded connected but has no real key, so this send fails at the
  // Stripe step — durable proof an *attempt* happened, but no code actually
  // went out, so the nudge (which dedupes on a genuinely `sent` row) must
  // keep prompting staff to try again rather than reading the attempt as done.
  await page.getByRole("button", { name: /Send to \d+ divers?/ }).click();
  await expect(page.getByText(/off · /)).toBeVisible();

  await page.goto("/shop/blue-mantis");
  await expect(page.getByText("3 seats open with no last-minute deal sent yet.")).toBeVisible();
});

// /api/test/seed-last-minute-unsubscribe-token mints a real
// last_minute_list_unsubscribe_tokens row (test-only, gated identically to
// /api/test/reset) so this drives the actual /unsubscribe/[token] page and
// server action, since the real send flow can't reach a live email in e2e
// (Stripe always fails first — see the tests above) and the token is
// otherwise only ever readable from inside one and hashed at rest.
test("a diver can self-serve unsubscribe from last-minute deal emails", async ({
  page,
  request,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByLabel("Name").fill("Uma Torres");
  await page.getByLabel("Email").fill("uma.e2e@example.com");
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();

  const seeded = await request.post("/api/test/seed-last-minute-unsubscribe-token", {
    data: { shopSlug: "blue-mantis", email: "uma.e2e@example.com" },
  });
  expect(seeded.ok()).toBe(true);
  const { token } = await seeded.json();

  await page.goto(`/unsubscribe/${token}`);
  await expect(page.getByRole("heading", { name: "Stop last-minute deal emails?" })).toBeVisible();
  await expect(page.getByText("Blue Mantis Divers")).toBeVisible();
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();

  // Revisiting the same link is idempotent, not a dead link.
  await page.goto(`/unsubscribe/${token}`);
  await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
});

test("an unknown unsubscribe link reads as unavailable, not a crash", async ({ page }) => {
  await page.goto("/unsubscribe/not-a-real-token");
  await expect(page.getByRole("heading", { name: "This link isn't available" })).toBeVisible();
});
