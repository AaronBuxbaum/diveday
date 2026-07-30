import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

// The recap page (`/recap/[token]`) is a public, signed-token diver surface, the
// same shape as the readiness page: it must fail closed on a bad or forged
// token and reveal nothing. The happy-path rendering is covered by the
// getRecapPageData integration tests (src/db/recap.test.ts); here we prove the
// route is wired and the fail-closed notice shows.
test("a tampered recap token reveals nothing", async ({ page }) => {
  await page.goto("/recap/not-a-real-token");
  await expect(page.getByRole("heading", { name: /recap link isn.t available/ })).toBeVisible();
});

test("an oversize recap photo is rejected client-side before it ever reaches the server (CR-011)", async ({
  page,
}) => {
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await expect(page.getByRole("heading", { name: /Nice diving/ })).toBeVisible();

  // Assert stylized recap map is rendered (delight feature)
  await expect(page.getByLabel("Stylized recap navigation map of your dive sites")).toBeVisible();

  const photoInput = page.locator('input[name="photo"]');
  await photoInput.setInputFiles({
    name: "recap.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(6 * 1024 * 1024), // over the 5 MB recap-photo limit
  });
  await expect(page.getByRole("alert").filter({ hasText: "over 5 MB" })).toBeVisible();
  // Rejected client-side: the picker itself is cleared, not just annotated —
  // a submit right after cannot silently carry the oversize file.
  await expect(photoInput).toHaveValue("");
});

test("a shop's review link appears on the recap page once set, and not before", async ({
  page,
}) => {
  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  await expect(page.getByRole("heading", { name: /Nice diving/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Leave a public review" })).toHaveCount(0);

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/settings");
  await page.getByLabel("Review link").fill("https://g.page/r/blue-mantis/review");
  await page.getByRole("button", { name: "Save review link" }).click();
  await expect(page.getByText("Review link saved.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
  const reviewLink = page.getByRole("link", { name: "Leave a public review" });
  await expect(reviewLink).toBeVisible();
  await expect(reviewLink).toHaveAttribute("href", "https://g.page/r/blue-mantis/review");
  await expect(reviewLink).toHaveAttribute("target", "_blank");
});
