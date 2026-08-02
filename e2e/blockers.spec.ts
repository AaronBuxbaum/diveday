import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

test("the queue pages instead of rendering every blocked departure on one screen", async ({
  page,
}) => {
  // Regression: the demo shop's full blocked-departure list used to render
  // as one unbroken ~10,700px scroll (26 departures, no pager) — the same
  // shape the orders index was found in before it got one. A page this tall
  // is also why the surface had no visual baseline: nothing could capture it
  // sanely. Bounded here to a page's worth of departure groups instead.
  await page.goto("/shop/blue-mantis/blockers");
  await expect(page.getByRole("heading", { name: "Not ready", level: 1 })).toBeVisible();

  const groups = page.locator("section.overflow-hidden");
  const pageOneCount = await groups.count();
  expect(pageOneCount).toBeGreaterThan(0);
  expect(pageOneCount).toBeLessThanOrEqual(10);

  const pageOneHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(pageOneHeight).toBeLessThan(6_000);

  const nav = page.getByRole("navigation", { name: "Blocker pages" });
  await expect(nav).toBeVisible();
  const pageOneTitles = await groups.evaluateAll((els) => els.map((el) => el.textContent));

  await nav.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/[?&]page=2/);
  // A different set of departures, not the same ten again — proves the link
  // actually changes what's shown rather than reloading the same page.
  const pageTwoTitles = await page
    .locator("section.overflow-hidden")
    .evaluateAll((els) => els.map((el) => el.textContent));
  expect(pageTwoTitles.length).toBeGreaterThan(0);
  expect(pageTwoTitles.some((title) => pageOneTitles.includes(title))).toBe(false);

  await page
    .getByRole("navigation", { name: "Blocker pages" })
    .getByRole("link", { name: "Previous" })
    .click();
  await expect(page).toHaveURL(/\/blockers$/);
  const backOnPageOne = await page
    .locator("section.overflow-hidden")
    .evaluateAll((els) => els.map((el) => el.textContent));
  expect(backOnPageOne).toEqual(pageOneTitles);
});

test("the one-tap waiver send on the blockers queue reports success inline", async ({ page }) => {
  await page.goto("/shop/blue-mantis/blockers");
  await expect(page.getByRole("heading", { name: "Not ready", level: 1 })).toBeVisible();

  // Filtered by the diver's name rather than the send button's label: that
  // label itself changes once a link exists ("Send waiver" → "Nudge
  // waiver"), so a locator keyed on it would stop matching this row right
  // after the click that's being tested. Priya is blocked on two departures
  // ("fix once" — the same tap clears both), so narrow to the first row.
  const row = page
    .locator("li")
    .filter({ hasText: "Priya Sharma" })
    .filter({ visible: true })
    .first();
  await row.getByRole("button", { name: "Send waiver", exact: true }).click();

  // The tap posts the shared server action in place — the outcome renders
  // inline (translated copy from staff.json, not a hardcoded English string)
  // instead of navigating away or leaving the tap looking like a no-op. The
  // demo shop has no email provider configured, so the fallback-link path is
  // what actually renders here — a private link staff copy and hand over.
  const outcome = row.getByRole("status");
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText("This shop has no email provider configured yet");
  await expect(outcome).toContainText("share this private link");
  await expect(outcome.getByRole("button", { name: "Copy link" })).toBeVisible();
});
