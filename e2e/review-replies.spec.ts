import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

/**
 * **The shop answers a review in public** (batch 4, K2): an owner writes one
 * short reply under a published review, it shows under the review on the
 * shop's public pages signed with the shop's name, and deleting it takes it
 * down again. Escaping, the length limit and the owner/manager gate are unit
 * tested (`src/components/ShopReviews.test.tsx`, `src/db/review-replies.test.ts`,
 * `actions.authz.test.ts`); this is the loop a shop runs.
 */

test("an owner replies under a published review, and the reply reaches the public page", async ({
  page,
}) => {
  const comment = "Calm water and a turtle at the second stop.";
  const reply = "Thank you! Come back for the night dive.";

  // A diver's review with words, published by staff, so it leads every list.
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await page.getByRole("radio", { name: "5 out of 5 stars" }).check();
  await page.getByLabel("Anything you’d tell another diver?").fill(comment);
  await page.getByRole("button", { name: "Leave my review" }).click();
  await expect(
    page.getByText("Thanks. The shop will read your words before they go up."),
  ).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/reviews");
  const waiting = page.getByRole("region", { name: /^Needs you/ });
  await waiting
    .locator("li")
    .filter({ hasText: comment })
    .getByRole("button", { name: "Publish" })
    .click();
  await expect(page.getByText("Review published to your schedule page")).toBeVisible();

  const row = page
    .getByRole("region", { name: /^Published/ })
    .locator("li")
    .filter({ hasText: comment });
  await row.getByRole("button", { name: "Reply in public" }).click();
  await row.getByLabel("Your reply").fill(reply);
  await row.getByRole("button", { name: "Save reply" }).click();
  await expect(row.getByText("Reply published")).toBeVisible();
  await expect(row.getByText(/^Reply from /)).toBeVisible();
  await expect(row.getByText(reply)).toBeVisible();

  // Under the review on the public archive, signed with the shop's name.
  await page.goto("/s/blue-mantis/reviews");
  const publicReview = page.locator("li").filter({ hasText: comment });
  await expect(publicReview.locator("[data-review-reply]")).toContainText(/^Reply from /);
  await expect(publicReview.locator("[data-review-reply]")).toContainText(reply);

  // Deleted, it is gone from the public page as well.
  await page.goto("/shop/blue-mantis/reviews");
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: "Delete reply" }).click();
  await expect(row.getByText("Reply deleted")).toBeVisible();
  await page.goto("/s/blue-mantis/reviews");
  await expect(publicReview).toHaveCount(1);
  await expect(publicReview.locator("[data-review-reply]")).toHaveCount(0);
});
