import { walkPlan } from "../scripts/persona-bots/personas.mjs";
import { expect, test } from "./fixtures";
import { E2E_TEST_ROUTE_SECRET } from "./servers";
import { mintOnboardFormPath } from "./setup-link";

test("Victor's setup link opens the onboarding form", async ({ page }) => {
  const visit = walkPlan().find((entry) => entry.path === "/onboard");
  expect(visit?.mint).toBe("setup-link");
  const path = await mintOnboardFormPath(page, {
    headers: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
  });
  await page.goto(path);
  await expect(page.locator('input[name="shopName"]').filter({ visible: true })).toBeVisible();
});
