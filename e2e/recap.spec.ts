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
