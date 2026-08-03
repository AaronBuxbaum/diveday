import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("the ? help lists shortcuts and a g-sequence jumps between surfaces", async ({ page }) => {
  await page.goto("/shop/blue-mantis");
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await page.locator("body").filter({ visible: true }).click();

  // `?` opens the discoverable cheat-sheet.
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  // The sheet, the nav tab, and the palette all read one destination registry
  // (src/lib/staff-destinations.ts), so they name the board identically.
  await expect(dialog.getByText("Go to Board")).toBeVisible();
  // An owner sees every sequence the registry defines, waivers included.
  await expect(dialog.getByText("Go to Waivers")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // `g` then `s` navigates to the staff schedule board without touching the
  // mouse — the same destination as every other staff entry point (nav,
  // command palette) since the schedule route split (Lens 17, task 153).
  await page.keyboard.press("g");
  await page.keyboard.press("s");
  await expect(page).toHaveURL(/\/schedule\/board$/);

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
