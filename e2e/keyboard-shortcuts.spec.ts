import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("the ? help lists shortcuts and a g-sequence jumps between surfaces", async ({ page }) => {
  await page.goto("/shop/blue-mantis");

  // `?` opens the discoverable cheat-sheet.
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Go to Schedule")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // `g` then `s` navigates to the schedule without touching the mouse.
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page).toHaveURL(/\/schedule$/);

  // `g` then `d` jumps to the diver roster.
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/divers$/);
});

test("shortcuts stay dormant while typing in a field", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  const search = page.getByRole("searchbox", { name: "Search divers" });
  await search.fill("gs");
  // Typing "gs" filters the list; it must not have navigated away.
  await expect(page).toHaveURL(/\/divers/);
  await expect(search).toHaveValue("gs");
});
