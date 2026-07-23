import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("the command palette finds a diver by name and ⌘K jumps to a page shortcut", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis");

  // The nav Search button opens the palette (phone users have no ⌘K).
  await page.getByRole("button", { name: "Search" }).click();
  const box = page.getByRole("combobox", { name: /Search divers/ });
  await expect(box).toBeFocused();

  await box.fill("Priya");
  const option = page.getByRole("option", { name: /Priya Sharma/ });
  await expect(option).toBeVisible();

  // Keyboard-only: first result is active, Enter navigates to the person record.
  await box.press("Enter");
  await expect(page).toHaveURL(/\/divers\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { name: /Priya Sharma/ })).toBeVisible();

  // ⌘K reopens the palette anywhere, and a "Go to" shortcut jumps to a page.
  await page.keyboard.press("ControlOrMeta+k");
  const reopened = page.getByRole("combobox", { name: /Search divers/ });
  await expect(reopened).toBeFocused();
  await reopened.fill("Blockers");
  await page.getByRole("option", { name: "Blockers" }).click();
  await expect(page).toHaveURL(/\/blockers$/);
});

test("the divers list filters live as you type, no submit", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  const search = page.getByRole("searchbox", { name: "Search divers" });
  await expect(page.getByRole("cell", { name: /Priya Sharma/ })).toBeVisible();

  await search.fill("zzz-no-such-diver");
  await expect(page.getByText("No divers match this view.")).toBeVisible();

  await search.fill("Priya");
  await expect(page.getByRole("cell", { name: /Priya Sharma/ })).toBeVisible();
});
