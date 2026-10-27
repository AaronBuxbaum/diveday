import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

test("the diver search keeps its initial focus after session verification", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/divers");
  const search = page.getByPlaceholder("Search people");
  await expect(page.locator("[data-staff-session-lock]")).toHaveCount(0);
  await expect(search).toBeFocused();
});

test("the new departure field keeps its initial focus after session verification", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule/board/new?add=full");
  await expect(page.locator("[data-staff-session-lock]")).toHaveCount(0);
  await expect(page.getByLabel("What is it")).toBeFocused();
});

test("real staff input renews the session; an expired warm cookie reaches sign-in", async ({
  page,
}, testInfo) => {
  // Own session: ageing a shared storage-state session would break later specs.
  await signInAsOwner(page);
  const confirmed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/staff-activity") && response.request().method() === "GET",
  );
  await page.reload();
  expect((await confirmed).status()).toBe(200);
  await expect(page.locator("#staff-session-content")).not.toHaveAttribute("inert");
  const activity = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/staff-activity") && response.request().method() === "POST",
  );
  await page.keyboard.press("Tab");
  expect((await activity).status()).toBe(204);
  expect(
    (await page.request.post("/api/test/age-staff-session", { data: { age: "idle" } })).status(),
  ).toBe(204);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const locked = page.getByRole("alertdialog", { name: "Session paused" });
  await expect(locked).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(locked.locator(":focus")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("staff-idle-locked.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("staff-idle-locked-mobile.png") });
  await page.reload();
  await expect(page).toHaveURL(/\/sign-in\?session=ended/);
});

test("a staff 404 locks its open search results when the session expires", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/no-such-page");
  await page.getByRole("main").getByRole("button", { name: "Search" }).click();
  await page.getByRole("combobox", { name: /Search divers/ }).fill("Priya Sharma");
  await expect(page.getByRole("option", { name: "Priya Sharma", exact: true })).toBeVisible();
  expect(
    (await page.request.post("/api/test/age-staff-session", { data: { age: "idle" } })).status(),
  ).toBe(204);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const locked = page.getByRole("alertdialog", { name: "Session paused" });
  await expect(locked).toBeVisible();
  const result = page.getByRole("option", { name: "Priya Sharma", exact: true });
  expect(await result.evaluate((option) => Boolean(option.closest("[inert]")))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(locked.locator(":focus")).toHaveCount(1);
});
