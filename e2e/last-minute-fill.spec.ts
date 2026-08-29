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
  await waitList.locator("summary").click();
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
    // The row itself, not the day station that contains it. Since the home
    // became the day's spine every row about a departure nests inside that
    // departure's own `<li>`, and `hasText` matches an ancestor as readily as
    // the element that holds the words.
    .filter({ hasNot: page.locator("li") })
    .filter({ visible: true });
  await expect(nudge).toBeVisible();

  // The row's door names where it goes — a station short of crew *and* short
  // of divers renders both rows under one heading, and two links announced
  // "Open trip" would be indistinguishable. It carries this trip's own
  // #last-minute-deal anchor, which is what auto-opens the "Promote this trip"
  // disclosure the deal panel lives behind (task 156).
  await nudge.getByRole("link", { name: "Open last-minute deal" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+#last-minute-deal$/);
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
  await waitList.locator("summary").click();
  await waitList.getByLabel("Name").fill("Priya Shah");
  await waitList.getByLabel("Email").fill("priya.e2e@example.com");
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(page.getByRole("heading", { name: "You’re on the list." })).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis");
  const nudge = page
    .locator("li")
    .filter({ hasText: "3 seats open with no last-minute deal sent yet." })
    // The row itself, not the day station that contains it. Since the home
    // became the day's spine every row about a departure nests inside that
    // departure's own `<li>`, and `hasText` matches an ancestor as readily as
    // the element that holds the words.
    .filter({ hasNot: page.locator("li") })
    .filter({ visible: true });
  await expect(nudge).toBeVisible();
  // The row's door names where it goes — a station short of crew *and* short
  // of divers renders both rows under one heading, and two links announced
  // "Open trip" would be indistinguishable. It carries this trip's own
  // #last-minute-deal anchor, which is what auto-opens the "Promote this trip"
  // disclosure the deal panel lives behind (task 156).
  await nudge.getByRole("link", { name: "Open last-minute deal" }).click();
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
  await waitList.locator("summary").click();
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
  await dealList.locator("summary").click();
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
    // The row itself, not the day station that contains it. Since the home
    // became the day's spine every row about a departure nests inside that
    // departure's own `<li>`, and `hasText` matches an ancestor as readily as
    // the element that holds the words.
    .filter({ hasNot: page.locator("li") })
    .filter({ visible: true });
  await nudge.getByRole("link", { name: "Open last-minute deal" }).click();
  await expect(page.getByRole("heading", { name: "Last-minute deal" })).toBeVisible();

  // The row a staffer reads before deciding carries the level claim as
  // self-declared; the deal list does not collect a separate nitrox claim.
  const recipient = page
    .locator("li")
    .filter({ hasText: "Tess Alvarez" })
    .filter({ visible: true });
  await expect(recipient).toContainText("Open Water — unverified");

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
  await dealList.locator("summary").click();
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
  await page.goto(`/shop/blue-mantis/trips/${tripId}#last-minute-deal`);
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
  await dealList.locator("summary").click();
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
  // **The attribution, not a lowercase badge word.** Slice 8a's shared
  // `CertificationCardRow` replaced "certified" with the sentence that names
  // who sighted the card and when — which on a card-verification surface is the
  // fact worth pinning, since the whole point of this flow is that a person
  // looked at the plastic. Matched as a pattern so the seeded reviewer's name
  // and the date stay the seed's business.
  await expect(certified).toContainText(/Certified by .+ on /);
  await expect(certified).toContainText("Open Water");
  await expect(certified).not.toContainText("Rescue");
  await expect(certified).not.toContainText("Self-declared — no certification number yet");
});

/**
 * **The hint panel belongs to the mark you are pointing at.**
 *
 * `InfoHint`'s trigger is a 44px box around a 12px glyph (`-m-3 size-11 p-3`,
 * the tap-target floor from principles.md §2) and the panel was placed from
 * that box — so it opened 16px below and 16px left of the dot under the
 * pointer, reading as a note about nothing in particular rather than about the
 * question it hangs off. Underneath that, the panel is `position: fixed` and
 * every `<details>` is a containing block for one in Chromium (through the
 * `::details-content` pseudo the UA wraps its body in), which put it hundreds
 * of pixels away; it is portalled to `document.body` for that.
 *
 * This is the one ⓘ a diver meets on a public page: the "why are you asking me
 * this?" beside the certification question.
 *
 * **It measures whichever branch ran, and controls no scroll position at all.**
 * `place()` flips the panel *above* its trigger when it would not fit below,
 * and this test used to pin the below branch — on the argument that an
 * assertion accepting both would prove less. It does not. The relationship
 * under test is that the panel hangs off the 12px glyph rather than the padded
 * box, the padding is symmetric, so the same two comparisons hold in either
 * direction: the gap is `panel.top - mark.bottom` below and
 * `mark.top - panel.bottom` above, and `targetGap < markGap` — the actual
 * regression guard — is true in both. Accepting both branches proves exactly as
 * much and stops the test depending on how tall the document happens to be.
 *
 * **That dependency was the whole failure history**, and none of it was ever
 * about `InfoHint`. Pinning the branch meant guaranteeing room below a trigger
 * near the foot of a page, and every layer of the guarantee failed in turn:
 * `scrollIntoView({block: "center"})` clamps at the end of the document, so
 * "centred" silently became "as low as the page will go" (`spaceBelow` 370px
 * locally, -105 on CI, run 33102223519); a viewport of trailing
 * `padding-bottom` fixed the clamp; then `locator.hover()`'s own actionability
 * scroll undid the centring on CI's pinned Chromium (`scrollY` 3654 → 3226,
 * trigger bottom 900.28 in a 900px viewport, `spaceBelow` -0.28). That last one
 * reproduced every run on one browser and passed on the other, so it read as
 * flake — and cost a working day on the Clearwater 6b branch, where it looked
 * like the branch's fault because the branch had changed the shell's height.
 * Two fixes were written and pushed against a disclosure animation race that
 * was never the cause; the disproof was an unrelated branch touching no chrome
 * failing identically (issue #1095).
 *
 * So: no viewport pinning, no `scrollIntoView`, no `spaceBelow` precondition,
 * no `mouse.move` workaround. If you find yourself adding one back to make an
 * assertion hold, the assertion is asking about the wrong thing.
 */
test("the certification hint opens beside the mark, not beside its tap target", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  const dealList = page.locator("#last-minute-list");
  await dealList.locator("summary").click();
  // By its accessible name, never "the first disclosure in here" — a
  // `<summary>` and an `EditDisclosure` wear the same attributes.
  const trigger = dealList.getByRole("button", { name: "Why we ask about certification" });
  await trigger.waitFor();
  // Read the id *before* the hover. The panel is placed by measurement and is
  // dismissed by any scroll, so a locator action after the hover could scroll
  // the page to reach its own target and leave this measuring a gap nobody
  // would ever see.
  const panelId = await trigger.getAttribute("aria-controls");
  await trigger.hover();

  const geometry = await page.evaluate((id) => {
    const note = document.getElementById(id);
    const button = document.querySelector(`button[aria-controls="${id}"]`);
    const glyph = button?.querySelector("span");
    if (!note || !button || !glyph) throw new Error("no hint on the page");
    const mark = glyph.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    const panel = note.getBoundingClientRect();
    // Which way `place()` went — read off the result rather than predicted from
    // the geometry that produced it.
    const below = panel.top >= mark.bottom;
    return {
      open: getComputedStyle(note).visibility,
      below,
      markGap: below ? panel.top - mark.bottom : mark.top - panel.bottom,
      // What the gap would have been measured from the tap target instead —
      // the regression this test exists for. Symmetric padding, so the same
      // subtraction in whichever direction the panel went.
      targetGap: below ? panel.top - target.bottom : target.top - panel.bottom,
      dx: panel.left - mark.left,
      markWidth: mark.width,
      targetWidth: target.width,
    };
  }, panelId ?? "");

  expect(geometry.open).toBe("visible");
  // The mark really is the small dot and the target really is the 44px box —
  // the whole reason measuring the wrong one moved the panel.
  expect(geometry.markWidth).toBeLessThan(24);
  expect(geometry.targetWidth).toBeGreaterThanOrEqual(40);
  // `PANEL_GAP` is 8; a couple of pixels of slack for sub-pixel layout.
  expect(geometry.markGap).toBeGreaterThanOrEqual(6);
  expect(geometry.markGap).toBeLessThanOrEqual(12);
  // And it is the *mark* the panel hangs off: anchored to the padded box it
  // would sit a padding's worth further away, which is what this used to do.
  expect(geometry.targetGap).toBeLessThan(geometry.markGap);
  // Left-aligned to the mark wherever there is room for it.
  expect(Math.abs(geometry.dx)).toBeLessThanOrEqual(2);
});
