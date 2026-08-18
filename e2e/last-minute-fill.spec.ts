import { expect, test } from "./fixtures";
import { seededTripId, signInAsOwner } from "./helpers";

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
  await page.goto("/s/blue-mantis");
  // Scoped to the wait-list card: the schedule page carries a second form
  // now ("Nothing on a date that works?"), which legitimately asks for a
  // name and an email too, and getByLabel matches by substring.
  const waitList = page.locator("#last-minute-list");
  await waitList.getByLabel("Name").fill("Nora Quinn");
  await waitList.getByLabel("Email").fill("nora.e2e@example.com");
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
  await page.goto("/s/blue-mantis");
  // Scoped to the wait-list card: the schedule page carries a second form
  // now ("Nothing on a date that works?"), which legitimately asks for a
  // name and an email too, and getByLabel matches by substring.
  const waitList = page.locator("#last-minute-list");
  await waitList.getByLabel("Name").fill("Priya Shah");
  await waitList.getByLabel("Email").fill("priya.e2e@example.com");
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
  await page.goto("/s/blue-mantis");
  // Scoped to the wait-list card: the schedule page carries a second form
  // now ("Nothing on a date that works?"), which legitimately asks for a
  // name and an email too, and getByLabel matches by substring.
  const waitList = page.locator("#last-minute-list");
  await waitList.getByLabel("Name").fill("Uma Torres");
  await waitList.getByLabel("Email").fill("uma.e2e@example.com");
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

/**
 * **The email this feature exists to prevent** (FU-20260813).
 *
 * A joiner may optionally say what they can dive, and the staffer about to send
 * a discount sees it beside their name, marked self-declared, *before* they
 * press send. Nothing filters the blast — that is the deliberate design, argued
 * in the follow-up — so the whole safeguard is that the claim is legible at the
 * moment of the decision. This spec is that claim surviving the trip from a
 * public form to the panel.
 */
test("a joiner's declared level reaches the staffer before they send a deal", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/s/blue-mantis");
  const dealList = page.locator("#last-minute-list");
  await dealList.getByLabel("Name").fill("Tess Alvarez");
  await dealList.getByLabel("Email").fill("tess.e2e@example.com");
  await dealList.getByLabel("Certification level").selectOption("open_water");
  // The shop-wide deal list records only a broad level signal. Nitrox remains
  // a trip-specific declaration on the wait list, not a deal-list checkbox.
  await expect(dealList.getByLabel("I'm certified for nitrox (enriched air)")).toHaveCount(0);
  await page.locator('input[name="availableFrom"]').filter({ visible: true }).fill("2020-01-01");
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis");
  const nudge = page
    .locator("li")
    .filter({ hasText: "3 seats open with no last-minute deal sent yet." })
    .filter({ visible: true });
  await nudge.getByRole("link", { name: "Open trip" }).click();
  await expect(page.getByRole("heading", { name: "Last-minute deal" })).toBeVisible();

  // The row a staffer reads before deciding carries the level claim as
  // self-declared; the deal list does not collect a separate nitrox claim.
  const recipient = page
    .locator("li")
    .filter({ hasText: "Tess Alvarez" })
    .filter({ visible: true });
  await expect(recipient).toContainText("Open Water — unconfirmed");

  // And the send is still offered: informing, never gating. A filter here would
  // quietly stop the blast reaching everyone the shop has never carded, which
  // is most of a deal list.
  await expect(page.getByRole("button", { name: /Send to \d+ diver/ })).toBeEnabled();
});

/**
 * **The answer the list had no way to give until 2026-08-15**, and the one the
 * whole column exists for: a joiner who holds no card at all — a Discover Scuba
 * customer, a snorkeller, the non-diving half of a couple. Their only option
 * used to be "Rather not say", which reads to a staffer exactly like a certified
 * regular who skipped an optional question, so the shop mailed them a certified
 * two-tank charter.
 *
 * The form no longer asks the broad deal-list joiner for a nitrox claim. The
 * separate wait-list declaration keeps that safety-sensitive question on the
 * trip-specific surface.
 *
 * A person who has not confirmed a certification is not an eligible recipient
 * for a certification-gated departure. They should be absent from the send
 * list entirely, rather than appearing with a warning that staff might miss.
 */
test("an uncertified joiner is excluded from the last-minute send list", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/s/blue-mantis");
  const dealList = page.locator("#last-minute-list");
  await dealList.getByLabel("Name").fill("Nell Byrne");
  await dealList.getByLabel("Email").fill("nell.e2e@example.com");
  await dealList.getByLabel("Certification level").selectOption("none_declared");
  await expect(dealList.getByLabel("I'm certified for nitrox (enriched air)")).toHaveCount(0);
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();

  await signInAsOwner(page);
  // The night charter, not today's reef morning: the shop-wide list is the same
  // everywhere, but only a departure the whole seeded list matches puts eleven
  // people in front of a ten-name panel.
  const tripId = await seededTripId(page, "blue-mantis", "Night Dive — City of Washington");
  await page.goto(`/shop/blue-mantis/trips/${tripId}/guests#last-minute-deal`);
  await expect(page.getByRole("heading", { name: "Last-minute deal" })).toBeVisible();

  await expect(
    page.locator("li").filter({ hasText: "Nell Byrne" }).filter({ visible: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/below this departure's requirement/)).toHaveCount(0);

  // Other eligible recipients can still receive the deal.
  await expect(page.getByRole("button", { name: /Send to \d+ diver/ })).toBeEnabled();
});

/**
 * The other half of the same promise: the claim never becomes a shortcut. A
 * self-declared card cannot be certified on the one tap every other pending
 * card gets — the staffer has to enter the agency, number **and level** from
 * the certification evidence being verified, which is the same act as capturing one.
 *
 * The level is the half worth exercising end to end: this diver claimed Rescue
 * and the certification evidence the staffer is verifying says Open Water. Without the
 * select, transcribing the number would have certified Rescue.
 */
test("a self-declared card cannot be certified without verified evidence", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/s/blue-mantis");
  const dealList = page.locator("#last-minute-list");
  await dealList.getByLabel("Name").fill("Milo Vance");
  await dealList.getByLabel("Email").fill("milo.e2e@example.com");
  await dealList.getByLabel("Certification level").selectOption("rescue");
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();

  await signInAsOwner(page);
  // Search rather than the bare index: the roster is paged, and a joiner who
  // signed up seconds ago is not on page 1 of a seeded shop.
  await page.goto("/shop/blue-mantis/divers?q=Milo+Vance");
  await page.getByRole("link", { name: "Milo Vance" }).click();
  const card = page.locator("li").filter({ hasText: "Rescue" }).filter({ visible: true }).first();
  await expect(card).toContainText("Self-declared — no certification number yet");
  // The one-tap control every staff-captured pending card wears is absent here.
  await expect(card.getByRole("button", { name: "Mark certified" })).toBeHidden();

  await card.getByText("Verify certification record").click();
  // Prefilled with the claim, so leaving it alone is still one glance — but the
  // certification evidence says Open Water, and this is where that gets corrected.
  await expect(card.getByLabel("Level on the certification record")).toHaveValue("rescue");
  await card.getByLabel("Level on the certification record").selectOption("open_water");
  await card.getByLabel("Certification number").fill("RES-8080");
  await card.getByRole("button", { name: "Mark certified" }).click();

  // Sighted: it now reads as an ordinary certified card carrying the number the
  // staffer read off it — at the level *they* read, not the one the diver typed.
  const certified = page.locator("li").filter({ hasText: "RES-8080" }).filter({ visible: true });
  await expect(certified).toContainText("certified");
  await expect(certified).toContainText("Open Water");
  await expect(certified).not.toContainText("Rescue");
  await expect(certified).not.toContainText("Self-declared — no certification number yet");
});
