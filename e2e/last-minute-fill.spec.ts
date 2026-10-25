import type { APIRequestContext, Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  HELD_SEND_TIMEOUT_MS,
  openDiverFileGroup,
  openTodayBoatFolds,
  rosterRow,
  tripPathByTitle,
} from "./helpers";

const diver = diverTranslator("en-US");
const staff = staffTranslator("en-US");

/**
 * The seeded departure leaving today that the list is offered: the reef
 * morning asks for Open Water and no specialty card, where the night charter
 * asks for a Night card nobody on the list holds, so its panel is rightly
 * empty (dive-domain review of #2656, m1).
 */
const REEF = "Two-Tank Reef — Molasses & French";

/** The Today row that says people want in on the reef morning's open seats. */
const WANT_IN_ROW = /3 seats open, \d+ want in/;

/**
 * Puts one joiner on Blue Mantis's last-minute list through the same write the
 * public form makes, declared level and all. Every test below but the first is
 * about what staff do with the list, so none of them spends its budget typing a
 * sign-up; the first test is the one that signs up through the form.
 */
async function joinTheList(
  request: APIRequestContext,
  joiner: { fullName: string; email: string; certificationLevel?: string },
): Promise<void> {
  const response = await request.post("/api/test/seed-last-minute-interest", {
    // No upper bound, and "around from" 2020 covers today's frozen-clock departure.
    data: { shopSlug: "blue-mantis", availableFrom: "2020-01-01", ...joiner },
  });
  expect(response.ok()).toBe(true);
}

/** The reef morning's "Who wants in" panel, opened by the trip's own address. */
async function openWhoWantsIn(page: Page): Promise<void> {
  const tripPath = await tripPathByTitle(page, "blue-mantis", REEF);
  await page.goto(`${tripPath}#who-wants-in`);
  await expect(page.getByRole("heading", { name: /Who wants in/ })).toBeVisible();
  // A tick before React owns the panel is lost when it hydrates (CI saw
  // "Clicking the checkbox did not change its state" on main too), so every
  // test starts once the send forms say they are hydrated. Each row has its
  // own Offer form since A14 (`offer-seat-<interest id>`); the first stands
  // for the panel, and `offerFor` waits on the row it acts on.
  await expect(page.locator('form[id^="offer-seat-"]').first()).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  // The panel keeps the names past its preview cap behind "Show N more".
  const more = page.getByText(/^Show \d+ more$/);
  if ((await more.count()) > 0) await more.first().click();
}

/**
 * One joiner's own "Offer a seat", once React owns its form so a tap is not a
 * native submit, with the list's one discount turned on (A14: the discount
 * disclosure above the list rides with every row's offer).
 */
async function offerFor(page: Page, name: string) {
  const send = page.getByRole("button", {
    name: staff("trips.whoWantsIn.offerSeatAria", { name }),
  });
  await expect(send.locator("xpath=ancestor::form")).toHaveAttribute("data-hydrated", "true");
  await page.getByText(staff("trips.whoWantsIn.addDiscount"), { exact: true }).click();
  return send;
}

/**
 * Fill-the-boat, the public half: a diver joins the shop-wide last-minute list
 * from the schedule page, saying what they can dive. The e2e fleet never
 * configures a real STRIPE_SECRET_KEY (docs ADR 20260727-last-minute-fill-promos),
 * so the staff half below stops where Stripe would mint the coupon, the same
 * boundary every other payment-adjacent spec stops at.
 */
test("a diver joins the last-minute list from the shop's schedule page", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  // Scoped to the wait-list card: the schedule page carries a second form
  // now ("Nothing on a date that works?"), which legitimately asks for a
  // name and an email too, and getByLabel matches by substring.
  const waitList = page.locator("#last-minute-list");
  await waitList.locator("summary").click();
  await waitList.getByLabel("Name").fill("Nora Quinn");
  await waitList.getByLabel("Email").fill("nora.e2e@example.com");
  // The reef morning asks for Open Water, and the panel lists only who fits it
  // (dive-domain review of #2656, m1), so Nora says what she holds.
  await waitList.getByLabel("Certification level").selectOption("open_water");
  // The shop-wide deal list records only a broad level signal. Nitrox remains
  // a trip-specific declaration on the wait list, not a deal-list checkbox.
  await expect(waitList.getByLabel("I’m certified for nitrox (enriched air)")).toHaveCount(0);
  await page.locator('input[name="availableFrom"]').filter({ visible: true }).fill("2020-01-01");
  await page.getByRole("button", { name: "Notify me" }).click();
  await expect(
    page.getByRole("heading", { name: diver("lastMinute.joinedHeading") }),
  ).toBeVisible();
});

// /api/test/seed-interest-unsubscribe-token mints a real
// interest_unsubscribe_tokens row (test-only, gated identically to
// /api/test/reset) so this drives the actual /unsubscribe/[token] page and
// server action, since the real send flow can't reach a live email in e2e
// (Stripe always fails first — see the tests below) and the token is
// otherwise only ever readable from inside one and hashed at rest.
test("a diver can self-serve unsubscribe from last-minute deal emails", async ({
  page,
  request,
}) => {
  await joinTheList(request, { fullName: "Uma Torres", email: "uma.e2e@example.com" });
  const seeded = await request.post("/api/test/seed-interest-unsubscribe-token", {
    data: { shopSlug: "blue-mantis", email: "uma.e2e@example.com" },
  });
  expect(seeded.ok()).toBe(true);
  const { token } = await seeded.json();

  await page.goto(`/unsubscribe/${token}`);
  await expect(page.getByRole("heading", { name: "Stop last-minute deal emails?" })).toBeVisible();
  await expect(page.getByText("Blue Mantis Divers")).toBeVisible();
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.getByRole("heading", { name: "You’re unsubscribed" })).toBeVisible();

  // Revisiting the same link is idempotent, not a dead link.
  await page.goto(`/unsubscribe/${token}`);
  await expect(page.getByRole("heading", { name: "You’re unsubscribed" })).toBeVisible();
});

test("an unknown unsubscribe link reads as unavailable, not a crash", async ({ page }) => {
  await page.goto("/unsubscribe/not-a-real-token");
  await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible();
});

test.describe("staff and the list", () => {
  signedInAsOwner();

  test("Today nudges staff toward the departure people want in on", async ({ page, request }) => {
    await joinTheList(request, {
      fullName: "Nora Quinn",
      email: "nora.e2e@example.com",
      certificationLevel: "open_water",
    });
    await page.goto("/shop/blue-mantis");
    // The want-in row is a chore: on a long boat it sits behind "and N more".
    await openTodayBoatFolds(page);
    const nudge = page
      .locator("li")
      .filter({ hasText: WANT_IN_ROW })
      // The row itself, not the day station that contains it. Since the home
      // became the day's spine every row about a departure nests inside that
      // departure's own `<li>`, and `hasText` matches an ancestor as readily as
      // the element that holds the words.
      .filter({ hasNot: page.locator("li") })
      .filter({ visible: true });
    // One row for everyone who wants in ("N want in"): its door is the departure's
    // "Who wants in" panel, where the list is offered a seat. The panel itself is
    // the tests below; following the door here would render the trip page twice.
    await expect(nudge.getByRole("link", { name: "Offer a seat" })).toHaveAttribute(
      "href",
      /\/shop\/blue-mantis\/trips\/[0-9a-f-]+#who-wants-in$/,
    );
  });

  test("a send that fails at Stripe is recorded on the trip, not lost", async ({
    page,
    request,
  }) => {
    // A held send counts eight seconds down before it leaves (ADR
    // 20260906-before-you-ask, decision 2), and the outcome is allowed the hold
    // plus the Stripe attempt (HELD_SEND_TIMEOUT_MS, 20s). Measured 2026-10-24:
    // 17.7–18.0s locally at one worker, 8s of it the hold, and CI's loaded
    // runners take about twice the rest.
    test.setTimeout(45_000);
    // Unlocks the "not_connected" gate without ever calling real Stripe (same
    // route the visual suite uses to render Stripe-gated surfaces).
    await request.post("/api/test/seed-stripe-account");
    await joinTheList(request, {
      fullName: "Nora Quinn",
      email: "nora.e2e@example.com",
      certificationLevel: "open_water",
    });
    await openWhoWantsIn(page);
    const send = await offerFor(page, "Nora Quinn");
    await send.click();
    const stripeFailed = page.getByText(staff("trips.notices.lastMinuteStripeFailed"));
    try {
      await expect(stripeFailed).toBeVisible({ timeout: HELD_SEND_TIMEOUT_MS });
    } catch (error) {
      // This has failed on CI only, where the screenshot is out of reach. Say
      // where the page ended up and what it said instead, so the log alone
      // tells a send that never left from a notice drawn inside a shut panel.
      const seen = await page.evaluate(() => ({
        url: location.pathname + location.search + location.hash,
        notices: [...document.querySelectorAll('[role="status"], [role="alert"]')]
          .map((node) => node.textContent?.trim())
          .filter(Boolean),
        promoteOpen: document.querySelector("#last-minute-deal")?.closest("details")?.open ?? null,
      }));
      throw new Error(`${(error as Error).message}\nPage state: ${JSON.stringify(seen)}`);
    }

    // The attempt is durable evidence even though it failed — a staffer sees
    // it, not silence. Not exact: the badge's text is "Failed at Stripe"
    // (trips.lastMinute.status.failed), and its danger tone prepends a
    // decorative aria-hidden glyph on top of that (Badge.tsx toneGlyph).
    await expect(page.getByText(/25% off/)).toBeVisible();
    await expect(page.getByText(/failed/i)).toBeVisible();
  });

  test("a failed send attempt does not silence the Today row — nothing actually went out", async ({
    page,
    request,
  }) => {
    // The held send (8s, allowed HELD_SEND_TIMEOUT_MS) on top of the trip page
    // and Today. Measured 2026-10-24: 19.6–21.3s locally at one worker, 8s of it
    // the hold, and CI's loaded runners take about twice the rest.
    test.setTimeout(45_000);
    await request.post("/api/test/seed-stripe-account");
    await joinTheList(request, {
      fullName: "Priya Shah",
      email: "priya.e2e@example.com",
      certificationLevel: "open_water",
    });
    await openWhoWantsIn(page);
    // Stripe is seeded connected but has no real key, so this send fails at the
    // Stripe step: durable proof an *attempt* happened, but no code actually
    // went out, so the Today row (people still want in) keeps prompting staff.
    const send = await offerFor(page, "Priya Shah");
    // A fixed amount rather than a percent (amendment 2026-10-09 to ADR
    // 20260729-shop-promo-codes): the attempt's line names it once per booking.
    await page.getByRole("combobox", { name: "Discount type" }).selectOption("amount");
    await page.getByRole("spinbutton", { name: "Discount" }).fill("20");
    await send.click();
    await expect(
      page.getByText(`${staff("trips.lastMinute.amountOff", { amount: "$20" })} ·`),
    ).toBeVisible({ timeout: HELD_SEND_TIMEOUT_MS });

    await page.goto("/shop/blue-mantis");
    // The want-in row is a chore: on a long boat it sits behind "and N more".
    await openTodayBoatFolds(page);
    await expect(page.getByText(WANT_IN_ROW)).toBeVisible();
  });

  /**
   * **The email this feature exists to prevent** (FU-20260813).
   *
   * A joiner may optionally say what they can dive, and the staffer about to send
   * a discount sees it beside their name, marked self-declared, *before* they
   * press send. Nothing filters the blast — that is the deliberate design, argued
   * in the follow-up — so the whole safeguard is that the claim is legible at the
   * moment of the decision. This spec is that claim reaching the panel; the
   * first test proves the public form takes it.
   */
  test("a joiner's declared level reaches the staffer before they send a deal", async ({
    page,
    request,
  }) => {
    await joinTheList(request, {
      fullName: "Tess Alvarez",
      email: "tess.e2e@example.com",
      certificationLevel: "open_water",
    });
    await openWhoWantsIn(page);

    // The row a staffer reads before deciding carries the level claim as
    // self-declared; the deal list does not collect a separate nitrox claim.
    const recipient = page
      .locator("li")
      .filter({ hasText: "Tess Alvarez" })
      .filter({ visible: true });
    await expect(recipient).toContainText(
      staff("shared.certificationSummary.selfDeclared", { value: "Open Water" }),
    );

    // And the offer is still there: informing, never gating. A filter here would
    // quietly stop the offer reaching everyone the shop has never carded, which
    // is most of a deal list.
    await expect(
      page.getByRole("button", {
        name: staff("trips.whoWantsIn.offerSeatAria", { name: "Tess Alvarez" }),
      }),
    ).toBeEnabled();
  });

  /**
   * **The answer the list had no way to give until 2026-08-15**, and the one the
   * whole column exists for: a joiner who holds no card at all — a Discover Scuba
   * customer, a snorkeller, the non-diving half of a couple. Their only option
   * used to be "Rather not say", which reads to a staffer exactly like a certified
   * regular who skipped an optional question, so the shop mailed them a certified
   * two-tank charter.
   *
   * A person who has not confirmed a certification is not an eligible recipient
   * for a certification-gated departure. They should be absent from the send
   * list entirely, rather than appearing with a warning that staff might miss.
   */
  test("an uncertified joiner is excluded from the last-minute send list", async ({
    page,
    request,
  }) => {
    await joinTheList(request, {
      fullName: "Nell Byrne",
      email: "nell.e2e@example.com",
      certificationLevel: "none_declared",
    });
    // A second joiner who holds the card, so "everyone who fits" has more than
    // one row to tick beside the seeded list.
    await joinTheList(request, {
      fullName: "Owen Achebe",
      email: "owen.e2e@example.com",
      certificationLevel: "open_water",
    });
    await openWhoWantsIn(page);

    await expect(rosterRow(page, "Owen Achebe").filter({ visible: true })).toBeVisible();
    await expect(rosterRow(page, "Nell Byrne").filter({ visible: true })).toHaveCount(0);
    await expect(page.getByText(/below this departure’s requirement/)).toHaveCount(0);

    // Other eligible recipients can still be offered a seat, each from their own row.
    await expect(
      page.getByRole("button", {
        name: staff("trips.whoWantsIn.offerSeatAria", { name: "Owen Achebe" }),
      }),
    ).toBeEnabled();
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
  test("a self-declared card cannot be certified without verified evidence", async ({
    page,
    request,
  }) => {
    await joinTheList(request, {
      fullName: "Milo Vance",
      email: "milo.e2e@example.com",
      certificationLevel: "rescue",
    });
    // Search rather than the bare index: the roster is paged, and a joiner who
    // signed up seconds ago is not on page 1 of a seeded shop.
    await page.goto("/shop/blue-mantis/divers?q=Milo+Vance");
    await page.getByRole("link", { name: "Milo Vance" }).click();
    // The cards are behind the record's Certification records door (slice A).
    await openDiverFileGroup(page, "Certification records");
    const card = page.locator("li").filter({ hasText: "Rescue" }).filter({ visible: true }).first();
    await expect(card).toContainText(staff("divers.certifications.selfDeclaredLabel"));
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
    await expect(certified).not.toContainText(staff("divers.certifications.selfDeclaredLabel"));
  });
});

/**
 * **The hint panel belongs to the mark you are pointing at.**
 *
 * `InfoHint`'s trigger was a 44px box around a 12px glyph (`-m-3 size-11 p-3`,
 * the tap-target floor from principles.md §2) and the panel was placed from
 * that box — so it opened 16px below and 16px left of the dot under the
 * pointer, reading as a note about nothing in particular rather than about the
 * question it hangs off. The trigger is now the 20px mark's own box and the
 * 44px target a stretched `::after` (pixel-craft class 7: the ring belongs to
 * the mark), so the box a bounding rect reports *is* the mark; this still
 * checks the target reaches the floor.
 * Underneath that, the panel is `position: fixed` and
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
 * under test is that the panel hangs off the 20px mark rather than the 44px
 * target, and the target is symmetric round the mark, so the same comparison
 * holds in either direction: the gap is `panel.top - mark.bottom` below and
 * `mark.top - panel.bottom` above. Accepting both branches proves exactly as
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
  // `<summary>` and a disclosure trigger wear the same attributes.
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
    const glyph = button?.querySelector("svg");
    if (!note || !button || !glyph) throw new Error("no hint on the page");
    const mark = glyph.getBoundingClientRect();
    const panel = note.getBoundingClientRect();
    // Which way `place()` went — read off the result rather than predicted from
    // the geometry that produced it.
    const below = panel.top >= mark.bottom;
    return {
      open: getComputedStyle(note).visibility,
      below,
      markGap: below ? panel.top - mark.bottom : mark.top - panel.bottom,
      dx: panel.left - mark.left,
      markWidth: mark.width,
      // The button's own box is the mark's; the target is its stretched
      // `::after`, which a bounding rect cannot see.
      buttonWidth: button.getBoundingClientRect().width,
      targetWidth: Number.parseFloat(getComputedStyle(button, "::after").width),
    };
  }, panelId ?? "");

  expect(geometry.open).toBe("visible");
  // The mark really is the small dot, the button is the mark's box, and the
  // target still reaches the 44px floor.
  expect(geometry.markWidth).toBeLessThan(24);
  expect(Math.abs(geometry.buttonWidth - geometry.markWidth)).toBeLessThanOrEqual(1);
  expect(geometry.targetWidth).toBeGreaterThanOrEqual(44);
  // `PANEL_GAP` is 8; a couple of pixels of slack for sub-pixel layout. Hung
  // off the 44px target instead it would sit 12px further away.
  expect(geometry.markGap).toBeGreaterThanOrEqual(6);
  expect(geometry.markGap).toBeLessThanOrEqual(12);
  // Left-aligned to the mark wherever there is room for it.
  expect(Math.abs(geometry.dx)).toBeLessThanOrEqual(2);
});
