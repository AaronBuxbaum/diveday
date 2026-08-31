import type { Page } from "@playwright/test";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, signedInAsOwner, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

/**
 * The verified-review loop end to end (docs ADR 20260729-verified-diver-reviews):
 * a diver rates from their own recap link, staff moderate what carries words,
 * and only released reviews reach the public schedule.
 *
 * The staff half reads as a worklist: three groups, "Waiting on you" first, and
 * the group header is the only place a review's state is written (ADR
 * 20260827-people-not-lists, decision 3). So "is this review published?" is
 * asked here as "which group is it in?" — the pill it used to wear is gone, and
 * a row moving between groups is what a publish or a hide *is*.
 */

/** One of the three groups, by the heading that names it. */
function group(page: Page, name: RegExp) {
  return page.getByRole("region", { name });
}

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
  // The aggregate is said once, in the shop's identity band — the shelf below
  // quotes divers and opens the archive (ADR
  // 20260827-clearwater-surface-language, decision 8).
  await expect(page.getByText("4.3 · 83 reviews")).toHaveCount(1);
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
  // The group says it is waiting; the row does not repeat it.
  await expect(
    group(page, /^Waiting on you/)
      .locator("li")
      .filter({ hasText: comment }),
  ).toHaveCount(1);
  await expect(card.getByText("Waiting on you")).toHaveCount(0);

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
  await card.scrollIntoViewIfNeeded();
  // Read **after** the row is scrolled into view: `scrollIntoViewIfNeeded` is
  // itself a scroll, so an offset captured before it is not where the page
  // stands when the tap lands. Captured here, the assertion can be equality —
  // which fails on a partial jump as well as on a reset to the top, where a
  // bare `> 0` would only have caught the reset.
  const scrolledTo = await page.evaluate(() => window.scrollY);
  expect(scrolledTo).toBeGreaterThan(0);

  await card.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Review published to your schedule page.")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolledTo);
  // And the outcome is not smuggled onto the URL either, which is the other
  // half of what the redirect used to do.
  await expect(page).toHaveURL(/\/shop\/blue-mantis\/reviews$/);

  // And it has moved groups: publishing is exactly that, on a page whose
  // groups carry the state.
  await expect(
    group(page, /^Published/)
      .locator("li")
      .filter({ hasText: comment }),
  ).toHaveCount(1);
  await expect(
    group(page, /^Waiting on you/)
      .locator("li")
      .filter({ hasText: comment }),
  ).toHaveCount(0);

  await expect(card.getByRole("button", { name: "Mark as standout" })).toBeVisible();
  await card.getByRole("button", { name: "Mark as standout" }).click();
  await expect(page.getByText("Review marked as standout.")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolledTo);

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
    await expect(
      group(page, /^Published/)
        .locator("li")
        .filter({ hasText: comment }),
    ).toHaveCount(1);
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
    // The row leaves the Published group on the revalidate — no page bounce and
    // no badge, and the toast above is what says what happened.
    //
    // It does not appear in a Hidden group *on this page*: the moderated list
    // sorts every published review ahead of every hidden one so the two groups
    // cannot interleave across a page boundary (`listShopReviewsForStaff`), and
    // this shop has 82 published reviews, so the row it just hid is now on the
    // last page. That is why the toast has to outlive the row — it is the only
    // confirmation the staffer gets, and the only Undo.
    await expect(
      group(page, /^Published/)
        .locator("li")
        .filter({ hasText: comment }),
    ).toHaveCount(0);

    await page.context().clearCookies();
    await page.goto("/s/blue-mantis");
    await expect(page.getByText(comment)).toHaveCount(0);
  });

  test("a waiting review can be hidden with a recorded reason", async ({ page }) => {
    // No filter to reach for: the worklist leads the page, so a staffer opening
    // Reviews is already looking at everything waiting on them.
    await page.goto("/shop/blue-mantis/reviews");
    const waiting = group(page, /^Waiting on you/)
      .locator("li")
      .filter({ hasText: "A warm, patient crew and a brilliant final drift over the reef." })
      .filter({ visible: true });
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
    // Back in the Published group, which is the only place this page writes
    // that word — asked of the group rather than of the row, because the row
    // deliberately says nothing about its own state.
    await expect(
      group(page, /^Published/)
        .locator("li")
        .filter({ hasText: comment }),
    ).toHaveCount(1);

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
  await page.goto("/shop/blue-mantis/reviews");
  // **No selection to make.** The tick boxes retired with the filter chips: the
  // waiting group *is* the selection, and its header carries the one act that
  // clears it (ADR 20260827-people-not-lists, decision 3). "Publish both" at
  // two, "Publish all N" above that.
  const waitingGroup = group(page, /^Waiting on you/);
  const waitingRows = waitingGroup.locator("li");
  await expect(waitingRows.first()).toBeVisible();
  const count = await waitingRows.count();
  expect(count).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("checkbox")).toHaveCount(0);

  const clearAll = page.getByRole("button", {
    name: count === 2 ? "Publish both" : `Publish all ${count}`,
  });
  await clearAll.click();

  const outcome = page.getByText(`${count} reviews published to your schedule page.`);
  await expect(outcome).toBeVisible();
  // Nothing is waiting any more, so the group and the act it carried are both
  // gone — which is exactly the case that used to swallow this sentence whole.
  await expect(waitingGroup).toHaveCount(0);
  // And what it released is on screen underneath, in the group that now owns it.
  await expect(
    group(page, /^Published/)
      .locator("li")
      .filter({ hasText: comment }),
  ).toHaveCount(1);

  // The confirmation is on the list it changed, not in a banner at the top of
  // the page: below the title, above the first group. Asserted on where it
  // actually renders, because the bug this replaced was purely one of position —
  // the sentence was correct and nobody could see it.
  //
  // The three rects are read inside one `evaluate` so nothing can scroll or
  // re-render between them; an earlier version took three separate
  // `boundingBox()` calls that straddled a re-render and compared coordinates
  // from two different pages. Document-relative, so a scroll before the
  // measurement cannot skew it either. The waits above are the deterministic
  // gate (`pnpm check:e2e-hygiene` refuses the timing guess).
  const titleEl = await page
    .getByRole("heading", { level: 1, name: "What divers said" })
    .elementHandle();
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
      const [titleNode, outcomeNode, rowNode] = nodes;
      const top = (node: Element) => node.getBoundingClientRect().top + window.scrollY;
      const bottom = (node: Element) => node.getBoundingClientRect().bottom + window.scrollY;
      return {
        titleBottom: bottom(titleNode),
        outcomeTop: top(outcomeNode),
        rowTop: top(rowNode),
      };
    },
    [titleEl, outcomeEl, reviewRowEl],
  );
  expect(layout.outcomeTop).toBeGreaterThan(layout.titleBottom);
  expect(layout.outcomeTop).toBeLessThan(layout.rowTop);

  await page.context().clearCookies();
  await page.goto("/s/blue-mantis");
  await expect(page.getByText(comment)).toBeVisible();
});

test.describe("as owner, the worklist leads", () => {
  signedInAsOwner();

  /**
   * The page's shape, pinned: the work comes first, and the record is quiet
   * beneath it (ADR 20260827-people-not-lists, decision 3).
   */
  test("puts what is waiting above what is already published", async ({ page }) => {
    await page.goto("/shop/blue-mantis/reviews");
    const waitingEl = await group(page, /^Waiting on you/).elementHandle();
    const publishedEl = await group(page, /^Published/).elementHandle();
    const order = await page.evaluate(
      (nodes) => {
        const [waitingNode, publishedNode] = nodes;
        const top = (node: Element) => node.getBoundingClientRect().top + window.scrollY;
        return { waitingTop: top(waitingNode), publishedTop: top(publishedNode) };
      },
      [waitingEl, publishedEl],
    );
    expect(order.waitingTop).toBeLessThan(order.publishedTop);
  });

  /**
   * **One aggregate rendering.** Four stat tiles said the rating, the published
   * count, the waiting count and the hidden count above a queue that then said
   * three of the four again. The counts moved into the group labels that own
   * them, and the rating is one line under the title — said once.
   */
  test("says how the shop is rated exactly once", async ({ page }) => {
    await page.goto("/shop/blue-mantis/reviews");
    await page.getByRole("heading", { level: 1, name: "What divers said" }).waitFor();
    await expect(page.getByText(/average across \d+ published review/)).toHaveCount(1);
    // The tiles, and the region that grouped them, are gone.
    await expect(page.getByRole("region", { name: "Rating overview" })).toHaveCount(0);
    await expect(page.getByText("Public rating")).toHaveCount(0);
    // And so is the filter row: the groups are the filter.
    await expect(page.getByRole("link", { name: "All reviews" })).toHaveCount(0);
  });

  test("a published review carries no state pill — its group says so", async ({ page }) => {
    await page.goto("/shop/blue-mantis/reviews");
    const comment = "Vis was unreal and the crew found us a turtle on the second tank.";
    const published = page.locator("li").filter({ hasText: comment }).filter({ visible: true });
    await expect(published.getByText("Published", { exact: true })).toHaveCount(0);
    await expect(
      group(page, /^Published/)
        .locator("li")
        .filter({ hasText: comment }),
    ).toHaveCount(1);
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

  const heading = page.getByRole("heading", { level: 1, name: "All reviews" });
  await expect(heading).toBeVisible();
  // The archive joins the display scale, and keeps the aggregate to the count;
  // the hero owns the average-plus-count line (ADR
  // 20260827-clearwater-surface-language, decision 8).
  await expect(heading).toHaveClass(/text-4xl/);
  await expect(page.getByText(/^\d+ reviews$/)).toHaveCount(1);
  await expect(page.getByText("Read what divers who were on the boat said")).toHaveCount(0);
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
