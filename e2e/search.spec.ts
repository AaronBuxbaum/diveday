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
  await reopened.fill("Not ready");
  await page.getByRole("option", { name: "Not ready" }).click();
  await expect(page).toHaveURL(/\/blockers$/);
});

test("the command palette also finds dive sites, courses, and every gated nav destination", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis");
  await page.getByRole("button", { name: "Search" }).click();
  const box = page.getByRole("combobox", { name: /Search divers/ });

  await box.fill("Spiegel Grove");
  const siteOption = page.getByRole("option", { name: "Spiegel Grove", exact: true });
  await expect(siteOption).toBeVisible();
  await siteOption.click();
  await expect(page).toHaveURL(/\/dive-sites\/[a-f0-9-]+$/);

  await page.keyboard.press("ControlOrMeta+k");
  const reopened = page.getByRole("combobox", { name: /Search divers/ });
  await reopened.fill("Open Water Diver");
  const courseOption = page.getByRole("option", { name: "Open Water Diver", exact: true });
  await expect(courseOption).toBeVisible();
  await courseOption.click();
  await expect(page).toHaveURL(/\/courses\/[^/]+\/edit$/);

  // The owner role sees every gated destination, including the reports/promos
  // pair that's hidden from non-owner/manager staff.
  await page.keyboard.press("ControlOrMeta+k");
  const shortcuts = page.getByRole("combobox", { name: /Search divers/ });
  for (const [query, urlPattern] of [
    ["Check-in", /\/check-in$/],
    ["Staffing", /\/staffing$/],
    ["Dive sites", /\/dive-sites$/],
    ["Courses", /\/courses$/],
    ["Reviews", /\/reviews$/],
    ["Reports", /\/reports$/],
    ["Promo codes", /\/promos$/],
  ] as const) {
    await shortcuts.fill(query);
    await page.getByRole("option", { name: query, exact: true }).click();
    await expect(page).toHaveURL(urlPattern);
    await page.keyboard.press("ControlOrMeta+k");
  }
});

test("the divers list filters live as you type, no submit", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers");
  const search = page.getByRole("searchbox", { name: "Search divers" });
  // The extended roster is well past one default page, sorted alphabetically —
  // Priya isn't on it unsearched. Confirm the unfiltered roster loaded at all
  // (the first alphabetical name is a stable enough proxy), then exercise the
  // live filter that actually finds her.
  await expect(page.getByRole("cell", { name: "Adaeze Nwosu" })).toBeVisible();

  await search.fill("zzz-no-such-diver");
  await expect(page.getByText("No divers match this view.")).toBeVisible();

  await search.fill("Priya");
  await expect(page.getByRole("cell", { name: /Priya Sharma/ })).toBeVisible();
});
