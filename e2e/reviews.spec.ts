import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, signedInAsOwner, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

/**
 * The verified-review loop end to end (docs ADR 20260729-verified-diver-reviews):
 * a diver rates from their own recap link, staff moderate what carries words,
 * and only released reviews reach the public schedule.
 */

test("a diver's bare rating publishes straight away and reaches the public page", async ({
  page,
}) => {
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await expect(page.getByRole("heading", { name: "How was your day?" })).toBeVisible();

  await page.getByRole("radio", { name: "5 out of 5 stars" }).check();
  await page.getByRole("button", { name: "Leave my review" }).click();

  // No words to moderate, so it counts immediately.
  await expect(page.getByText("Thanks — your rating is up.")).toBeVisible();
  // Reloading shows the diver what they already said, rather than a blank form.
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await expect(page.getByText("You rated this 5 out of 5.")).toBeVisible();

  await page.goto("/s/blue-mantis");
  await expect(page.getByRole("heading", { name: "What divers say" })).toBeVisible();
  await expect(
    page.getByText("Every review here comes from a diver who was on the boat."),
  ).toBeVisible();
});

test.describe("as owner", () => {
  signedInAsOwner();

  test("staff previewing the public page from Reviews actually see the reviews", async ({
    page,
  }) => {
    // /s/<slug> is the public, canonical page regardless of session (Lens 17,
    // docs/product/features/story-backlog.md — the staff operations board lives at its
    // own /shop/<slug>/schedule/board instead), so the "View public page" link
    // on Reviews needs no special flag: signed-in staff land on exactly what a
    // diver sees, reviews included.
    await page.goto("/shop/blue-mantis/reviews");
    const previewPage = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "View public page" }).click(),
    ]).then(([popup]) => popup);
    await expect(previewPage).toHaveURL(/\/s\/blue-mantis$/);
    await expect(previewPage.getByRole("heading", { name: "What divers say" })).toBeVisible();
  });
});

test("a review carrying words waits for staff, and publishing it puts it on the public page", async ({
  page,
}) => {
  const comment = "The crew found us a nurse shark under the ledge.";
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await page.getByRole("radio", { name: "4 out of 5 stars" }).check();
  await page.getByLabel("Anything you’d tell another diver?").fill(comment);
  await page.getByRole("button", { name: "Leave my review" }).click();
  await expect(
    page.getByText("Thanks — the shop will read your words before they go up."),
  ).toBeVisible();

  // Unmoderated words are not on the shop's public page.
  await page.goto("/s/blue-mantis");
  await expect(page.getByText(comment)).toHaveCount(0);

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/reviews");
  const card = page.locator("li").filter({ hasText: comment }).filter({ visible: true });
  await expect(card.getByText("Waiting on you")).toBeVisible();

  // **Neither of these taps throws the staffer back to the top of the list.**
  //
  // Every control here used to end in `revalidateAndRedirect(…, noticeUrl(…))`.
  // That is a soft navigation rather than a document reload, so the giveaway is
  // not a torn-down `window` — it is the two things `redirect()` does on the
  // way: it scrolls the destination to the top, and it puts the outcome on the
  // URL as `?notice=`. On a shop working down a weekend's queue that is one
  // jump to the top per review published, and the row you were reading moves
  // every time.
  //
  // So this scrolls to the bottom of the list first and asserts the viewport
  // stayed there. Nothing waits on a duration: the outcome text is the signal,
  // and the scroll offset is read only after it has rendered.
  await page.keyboard.press("End");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const scrolledTo = await page.evaluate(() => window.scrollY);

  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Review published to your schedule page.")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // And the outcome is not smuggled onto the URL either, which is the other
  // half of what the redirect used to do.
  await expect(page).toHaveURL(/\/shop\/blue-mantis\/reviews$/);

  await expect(card.getByRole("button", { name: "Mark as standout" })).toBeVisible();
  await card.getByRole("button", { name: "Mark as standout" }).click();
  await expect(page.getByText("Review marked as standout.")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // The offset the list was actually at, so a page too short to scroll would
  // fail here rather than passing two vacuous assertions above.
  expect(scrolledTo).toBeGreaterThan(0);

  // Signed out again, the diver-facing schedule now carries it.
  await page.context().clearCookies();
  await page.goto("/s/blue-mantis");
  await expect(page.getByText(comment)).toBeVisible();
});

test.describe("as owner, reviews list", () => {
  signedInAsOwner();

  test("a published review can be taken back down, and leaves the public page with it", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/reviews");

    // Target a *written* published review specifically: hiding a bare rating
    // would make the "gone from the public page" assertion below vacuous, since
    // bare ratings are never listed there in the first place.
    const comment = "Vis was unreal and the crew found us a turtle on the second tank.";
    const published = page.locator("li").filter({ hasText: comment }).filter({ visible: true });
    await expect(published.getByText("Published")).toBeVisible();
    await expect(published.getByRole("button", { name: "Hide this review" })).toHaveCount(0);
    // Hiding states a case (ADR 20260813-review-moderation-has-a-floor): the
    // reason picker waits behind the Hide disclosure, and the act is recorded
    // with whichever reason the shop chose. Still no confirm dialog — it is one
    // of DiveDay's land-then-undo actions (docs/design/principles.md #7) and
    // offers Undo from a toast.
    await published.getByText("Hide", { exact: true }).click();
    await expect(published.getByLabel("What happened")).toHaveCount(0);
    await published.getByLabel("Why are you taking it down?").selectOption("spam");
    await published.getByRole("button", { name: "Hide this review" }).click();
    await expect(page.getByRole("status").getByText("Review hidden.")).toBeVisible();
    await expect(published.getByText("⚠️Hidden", { exact: true })).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/s/blue-mantis");
    await expect(page.getByText(comment)).toHaveCount(0);
  });

  test("a waiting review can be hidden with a recorded reason", async ({ page }) => {
    await page.goto("/shop/blue-mantis/reviews?filter=waiting");
    const waiting = page
      .locator("li")
      .filter({ hasText: "A warm, patient crew and a brilliant final drift over the reef." })
      .filter({ visible: true });
    await expect(waiting.getByText("Waiting on you")).toBeVisible();
    await expect(waiting.getByRole("button", { name: "Publish" })).toBeVisible();
    await expect(waiting.getByText("Hide", { exact: true })).toBeVisible();
  });

  test("hiding a review can be undone from the toast", async ({ page }) => {
    await page.goto("/shop/blue-mantis/reviews");

    const comment = "Vis was unreal and the crew found us a turtle on the second tank.";
    const published = page.locator("li").filter({ hasText: comment }).filter({ visible: true });
    await published.getByText("Hide", { exact: true }).click();
    await published.getByLabel("Why are you taking it down?").selectOption("wrong_subject");
    await published.getByRole("button", { name: "Hide this review" }).click();
    const toast = page.getByRole("status");
    await expect(toast.getByText("Review hidden.")).toBeVisible();

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Review published to your schedule page.")).toBeVisible();
    // The badge, exactly — the same spelling the hide test above uses for
    // "⚠️Hidden". A bare `getByText("Published")` was unambiguous only while the
    // outcome lived in a banner at the top of the page: now that the row
    // reports its own outcome, "Review published to your schedule page." is a
    // substring match inside this very `<li>` and the loose locator resolves to
    // two elements.
    await expect(published.getByText("✅Published", { exact: true })).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/s/blue-mantis");
    await expect(page.getByText(comment)).toBeVisible();
  });
});

test("a weekend's held reviews can be cleared in one pass, not one button at a time", async ({
  page,
}) => {
  // Two reviews waiting: the seeded one, plus one this diver leaves now.
  const comment = "Second tank was the best dive of the trip.";
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await page.getByRole("radio", { name: "5 out of 5 stars" }).check();
  await page.getByLabel("Anything you’d tell another diver?").fill(comment);
  await page.getByRole("button", { name: "Leave my review" }).click();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/reviews?filter=waiting");
  const waiting = page.getByRole("checkbox", { name: /Select .+'s review to publish/ });
  await expect(waiting.first()).toBeVisible();
  const count = await waiting.count();
  expect(count).toBeGreaterThanOrEqual(2);
  for (const box of await waiting.all()) await box.check();

  await page.getByRole("button", { name: "Publish selected" }).click();
  const outcome = page.getByText(`${count} reviews published to your schedule page.`);
  await expect(outcome).toBeVisible();
  // It lands back on the whole list — so you see what you just released — and
  // nothing on it is still waiting: no row carries a tick box any more.
  await expect(page.getByRole("checkbox", { name: /review to publish/ })).toHaveCount(0);
  // And the confirmation is on the list it changed, not in a banner at the top
  // of the page. A bulk publish has no single control to sit beside — what
  // moved is N rows — so its home is the list's own header row: below the
  // rating tiles, immediately above the first review. Asserted on where it
  // actually renders, because the bug this replaced was purely one of
  // position: the sentence was correct and nobody could see it.
  //
  // Clearing the last waiting review also takes the "Publish selected" button
  // off the page, which is exactly the case that used to swallow this sentence
  // whole — the header row survives that, the button does not.
  // **Measured after the reveal lands, and all three in one frame.**
  //
  // `useRevealPublished` answers a publish from the "waiting" tab with a
  // `router.replace` onto the unfiltered list — same shell, no document
  // teardown, but the rows underneath change and the page re-lays-out. Three
  // separate `boundingBox()` calls straddled that: the overview was measured on
  // one render and the outcome on the next, so the assertion compared
  // coordinates from two different pages and reported the sentence 92px *above*
  // a block it sits below in the DOM. It went red on `main` the day the reveal
  // landed and is not a flake — it fails every run.
  //
  // Waiting for the URL to lose its filter is the deterministic gate for that
  // (`pnpm check:e2e-hygiene` refuses the timing guess), and reading the three
  // rects inside one `evaluate` is what makes them comparable: nothing can
  // scroll or re-render between them. Document-relative, so a scroll before the
  // measurement cannot skew it either.
  await expect(page).toHaveURL(/\/reviews$/);
  const overviewEl = await page.getByRole("region", { name: "Rating overview" }).elementHandle();
  const outcomeEl = await outcome.elementHandle();
  // A known review row, not "the first `<li>` on the page" — the staff nav is
  // a list too, and its items sit above everything here.
  const reviewRowEl = await page
    .locator("li")
    .filter({ hasText: comment })
    .filter({ visible: true })
    .first()
    .elementHandle();
  const layout = await page.evaluate(
    (nodes) => {
      const [overviewNode, outcomeNode, rowNode] = nodes;
      const top = (node: Element) => node.getBoundingClientRect().top + window.scrollY;
      const bottom = (node: Element) => node.getBoundingClientRect().bottom + window.scrollY;
      return {
        overviewBottom: bottom(overviewNode),
        outcomeTop: top(outcomeNode),
        rowTop: top(rowNode),
      };
    },
    [overviewEl, outcomeEl, reviewRowEl],
  );
  expect(layout.outcomeTop).toBeGreaterThan(layout.overviewBottom);
  expect(layout.outcomeTop).toBeLessThan(layout.rowTop);

  await page.context().clearCookies();
  await page.goto("/s/blue-mantis");
  await expect(page.getByText(comment)).toBeVisible();
});

test.describe("as owner, bulk publish", () => {
  signedInAsOwner();

  test("publishing with nothing ticked says so rather than pretending to work", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/reviews?filter=waiting");
    await page.getByRole("button", { name: "Publish selected" }).click();
    await expect(page.getByText("Tick the reviews you want to publish first.")).toBeVisible();
    // Nothing moved: the held review is still held.
    await expect(
      page.getByRole("checkbox", { name: /Select .+'s review to publish/ }).first(),
    ).toBeVisible();
  });

  test("a published review carries no tick box — the bulk control only publishes", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/reviews");
    const published = page
      .locator("li")
      .filter({ hasText: "Vis was unreal and the crew found us a turtle on the second tank." })
      .filter({ visible: true });
    await expect(published.getByRole("checkbox")).toHaveCount(0);
    await expect(published.getByText("Hide", { exact: true })).toBeVisible();
  });
});

test("the public schedule publishes the shop's rating as structured data", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  // No `.filter({ visible: true })`: a <script> tag has no rendered box and is
  // never "visible" per Playwright's definition, so the filter would match
  // zero elements and break this assertion outright.
  const graph = await page.locator('script[type="application/ld+json"]').first().textContent();
  const parsed = JSON.parse(graph ?? "{}");
  const first = parsed.itemListElement?.[0]?.item;
  expect(first["@type"]).toBe("Event");
  expect(first.organizer.aggregateRating.ratingValue).toBeGreaterThan(0);
  // Only what an anonymous visitor already sees — never a diver's identity.
  expect(graph).not.toContain("@demo.invalid>");
  expect(graph?.toLowerCase()).not.toContain("bookingid");
});

test("the public schedule publishes its published reviews as Review objects", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  // No `.filter({ visible: true })`: see the same-selector comment above — a
  // <script> tag is never "visible", so the filter would zero out the match.
  const graph = await page.locator('script[type="application/ld+json"]').first().textContent();
  const parsed = JSON.parse(graph ?? "{}");
  const reviews = parsed.review;
  expect(Array.isArray(reviews)).toBe(true);
  expect(reviews.length).toBeGreaterThan(0);
  const [firstReview] = reviews;
  expect(firstReview["@type"]).toBe("Review");
  expect(firstReview.author["@type"]).toBe("Person");
  expect(typeof firstReview.author.name).toBe("string");
  expect(firstReview.reviewRating["@type"]).toBe("Rating");
  expect(typeof firstReview.reviewBody).toBe("string");
  expect(typeof firstReview.datePublished).toBe("string");
  // Never threaded into a per-trip Event's organizer — only the page's own
  // top-level graph carries the shop's full review list.
  const firstTripOrganizer = parsed.itemListElement?.[0]?.item?.organizer;
  expect(firstTripOrganizer?.review).toBeUndefined();
});

test("the public review count opens all reviews without trip names", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  const reviewsLink = page.getByRole("link", { name: /reviews$/i });
  await expect(reviewsLink).toHaveAttribute("href", "/s/blue-mantis/reviews");
  await reviewsLink.click();

  await expect(page.getByRole("heading", { level: 1, name: "All reviews" })).toBeVisible();
  await expect(page.getByText("Two-Tank Reef — Molasses & French")).toHaveCount(0);
  await expect(
    page.getByText("Vis was unreal and the crew found us a turtle on the second tank."),
  ).toBeVisible();
});

test("the embed widget emits no structured data — the standalone page is canonical", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis?embed=1");
  // No `.filter({ visible: true })`: a <script> tag is never "visible" per
  // Playwright's definition, so the filter would always report count 0 —
  // asserting the wrong thing for the right-looking reason.
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
});
