import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, test } from "./fixtures";

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
