import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, test } from "./fixtures";
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

  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByRole("heading", { name: "What divers say" })).toBeVisible();
  await expect(
    page.getByText("Every review here comes from a diver who was on the boat."),
  ).toBeVisible();
});

test("a review carrying words waits for staff, and publishing it puts it on the public page", async ({
  page,
}) => {
  const comment = "The crew found us a nurse shark under the ledge.";
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await page.getByRole("radio", { name: "4 out of 5 stars" }).check();
  await page.getByLabel("Anything you'd tell another diver?").fill(comment);
  await page.getByRole("button", { name: "Leave my review" }).click();
  await expect(
    page.getByText("Thanks — the shop will read your words before they go up."),
  ).toBeVisible();

  // Unmoderated words are not on the shop's public page.
  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByText(comment)).toHaveCount(0);

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/reviews");
  const card = page.locator("li").filter({ hasText: comment });
  await expect(card.getByText("Waiting on you")).toBeVisible();
  await card.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Review published to your schedule page.")).toBeVisible();

  // Signed out again, the diver-facing schedule now carries it.
  await page.context().clearCookies();
  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByText(comment)).toBeVisible();
});

test("a published review can be taken back down, and leaves the public page with it", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/reviews");

  // Target a *written* published review specifically: hiding a bare rating
  // would make the "gone from the public page" assertion below vacuous, since
  // bare ratings are never listed there in the first place.
  const comment = "Vis was unreal and the crew found us a turtle on the second tank.";
  const published = page.locator("li").filter({ hasText: comment });
  await expect(published.getByText("Published")).toBeVisible();
  await published.getByRole("button", { name: "Hide" }).click();
  await expect(
    page.getByText("Review hidden — it no longer counts toward your rating."),
  ).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/shop/blue-mantis/schedule");
  await expect(page.getByText(comment)).toHaveCount(0);
});

test("the public schedule publishes the shop's rating as structured data", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule");
  const graph = await page.locator('script[type="application/ld+json"]').first().textContent();
  const parsed = JSON.parse(graph ?? "{}");
  const first = parsed.itemListElement?.[0]?.item;
  expect(first["@type"]).toBe("Event");
  expect(first.organizer.aggregateRating.ratingValue).toBeGreaterThan(0);
  // Only what an anonymous visitor already sees — never a diver's identity.
  expect(graph).not.toContain("@demo.invalid>");
  expect(graph?.toLowerCase()).not.toContain("bookingid");
});

test("the embed widget emits no structured data — the standalone page is canonical", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule?embed=1");
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
});
