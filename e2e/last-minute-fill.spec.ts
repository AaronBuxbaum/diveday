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
    .filter({ visible: true });
  await nudge.getByRole("link", { name: "Open trip" }).click();
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
  await expect(certified).toContainText("certified");
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
 * **Geometry, and pinned to one branch.** The gap is a handful of pixels either
 * way — exactly the size of difference a monochrome capture and a reviewer's
 * eye both wave through — so it is measured rather than photographed. The panel
 * legitimately flips *above* its trigger when it would not fit below, so the
 * "below" branch is fixed as the one under test rather than the assertion
 * accepting both and proving less.
 *
 * **Pinning it took two goes, and the first one only looked like a pin.**
 * Setting an explicit 1280x900 viewport and centring the trigger was not
 * enough: `scrollIntoView({block: "center"})` clamps at the end of the
 * document, and this trigger sits near the foot of the page, so "centred"
 * quietly became "as low as the page will go". How much room was left beneath
 * it was then whatever the content above happened to add up to — 370px here,
 * and on CI not enough, which is the gap of -105 that went red on `main`
 * (run 33102223519). The measurement that settled it: `window.scrollY` came
 * back *equal to* the maximum scroll, so the centring had never happened at
 * all and the test had been passing on luck.
 *
 * Two things hold it now. The body gets a viewport's worth of trailing padding,
 * so the scroll is no longer clamped and the trigger genuinely lands
 * mid-viewport on any runner; and the room below is **asserted** before the gap
 * is, so losing it again fails as itself rather than as a large negative number
 * that reads like a placement bug.
 */
test("the certification hint opens beside the mark, not beside its tap target", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/s/blue-mantis");
  // **Make the centring real.** `scrollIntoView({block: "center"})` below is
  // best-effort: it clamps at the end of the document, and this trigger sits
  // near the foot of the page — so "centred" silently becomes "as low as the
  // page will go", and how much room is left under it is whatever the content
  // above happens to add up to. That is not a pin, it is a coincidence, and it
  // broke on CI with a gap of -105 (the panel correctly flipping *above*,
  // having no room below) while passing here with 370px to spare.
  //
  // A viewport's worth of trailing room means the scroll is no longer clamped,
  // so the trigger really does land mid-viewport on any runner. It changes
  // nothing the code under test reads: `place()` measures the trigger's own
  // viewport rect, not the document's height.
  await page.addStyleTag({ content: "body { padding-bottom: 100vh; }" });
  const dealList = page.locator("#last-minute-list");
  await dealList.locator("summary").click();
  // By its accessible name, never "the first disclosure in here" — a
  // `<summary>` and an `EditDisclosure` wear the same attributes.
  const trigger = dealList.getByRole("button", { name: "Why we ask about certification" });
  await trigger.waitFor();
  await trigger.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // Read the id *before* the hover. The panel is placed by measurement and is
  // dismissed by any scroll, so a locator action after the hover could scroll
  // the page to reach its own target and leave this measuring a gap nobody
  // would ever see.
  const panelId = await trigger.getAttribute("aria-controls");
  // **Hovered at a point, not through the locator.** `locator.hover()` runs
  // Playwright's actionability scroll first, and on CI's pinned Chromium that
  // scroll undoes the centring above — measured: `scrollY` 3654 → 3226, which
  // drops the trigger's bottom to 900.28 in a 900px viewport and leaves
  // `spaceBelow` at -0.28. The panel then correctly flips *above*, and the
  // assertion below fails saying there was no room, which is true and not the
  // thing under test. It reproduces every run on that browser and passes on
  // the fallback one, which is why it read as flake.
  //
  // The trigger is already centred and already visible, so there is nothing
  // for that scroll to fix — moving the mouse to its own box centre is the
  // same hover without it. This is the same hazard the note above `panelId`
  // describes, one line further down than it was written for.
  const box = await trigger.boundingBox();
  if (!box) throw new Error("the certification hint trigger has no box to hover");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  const geometry = await page.evaluate((id) => {
    const note = document.getElementById(id);
    const button = document.querySelector(`button[aria-controls="${id}"]`);
    const glyph = button?.querySelector("span");
    if (!note || !button || !glyph) throw new Error("no hint on the page");
    const mark = glyph.getBoundingClientRect();
    const target = button.getBoundingClientRect();
    const panel = note.getBoundingClientRect();
    return {
      open: getComputedStyle(note).visibility,
      markGap: panel.top - mark.bottom,
      // What the gap would have been measured from the tap target instead —
      // the regression this test exists for.
      targetGap: panel.top - target.bottom,
      dx: panel.left - mark.left,
      markWidth: mark.width,
      targetWidth: target.width,
      // The precondition, measured rather than assumed — see the assertion.
      spaceBelow: window.innerHeight - target.bottom,
      panelHeight: panel.height,
    };
  }, panelId ?? "");

  expect(geometry.open).toBe("visible");
  // **The branch under test is the one that actually ran.** `place()` flips the
  // panel above its trigger whenever it would not fit below, which is correct
  // behaviour and a different measurement — so if the room ever disappears
  // again, this fails saying *that*, instead of the gap assertions below
  // reporting a large negative number and sending the next reader after a
  // placement bug that is not there.
  expect(geometry.spaceBelow).toBeGreaterThan(geometry.panelHeight + 8);
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
