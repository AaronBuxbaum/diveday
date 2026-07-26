import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

/**
 * The embed widget (docs ADR 20260726-schedule-embed): a shop pastes the
 * schedule into its own website, so the two things that must hold are (1) the
 * embed route actually renders compact and framable, and (2) nothing else on
 * the site became framable as a side effect of adding that exception.
 */
test("the schedule embed renders without page chrome and allows framing", async ({ page }) => {
  const response = await page.goto("/shop/blue-mantis/schedule?embed=1");
  expect(response?.headers()["x-frame-options"]).toBeUndefined();
  expect(response?.headers()["content-security-policy"]).toBeUndefined();
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).not.toBeVisible();
});

test("a non-embed page still denies framing", async ({ page }) => {
  const response = await page.goto("/shop/blue-mantis/schedule");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
});

test("staff get a copy-pasteable snippet from settings", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/settings/embed");
  await expect(page.getByRole("heading", { name: "Website embed" })).toBeVisible();
  await expect(page.getByText(/<iframe src="http/)).toBeVisible();
  await expect(page.getByText(/schedule\?embed=1/).first()).toBeVisible();
});
