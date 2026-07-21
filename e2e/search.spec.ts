import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

test("the command palette pulls up a diver by name and lands on their record", async ({ page }) => {
  await signInAsOwner(page);

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
});

test("⌘K opens the palette and a 'Go to' shortcut jumps to a page", async ({ page }) => {
  await signInAsOwner(page);
  await page.keyboard.press("ControlOrMeta+k");
  const box = page.getByRole("combobox", { name: /Search divers/ });
  await expect(box).toBeFocused();

  await box.fill("Blockers");
  await page.getByRole("option", { name: "Blockers" }).click();
  await expect(page).toHaveURL(/\/blockers$/);
});

test("the divers list filters live as you type, no submit", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/divers");
  const search = page.getByRole("searchbox", { name: "Search divers" });
  await expect(page.getByRole("cell", { name: /Priya Sharma/ })).toBeVisible();

  await search.fill("zzz-no-such-diver");
  await expect(page.getByText("No matching divers.")).toBeVisible();

  await search.fill("Priya");
  await expect(page.getByRole("cell", { name: /Priya Sharma/ })).toBeVisible();
});
