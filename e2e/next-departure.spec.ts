// READ_ONLY holds here: this opens the public schedule and follows one link to a
// booking page. It fills nothing and submits nothing.
import { expect, READ_ONLY, test } from "./fixtures";

test("the shopfront leads with the next boat, and the week still lists it", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/s/blue-mantis");

  // **The card is a pin, not a removal** (ADR
  // 20260827-clearwater-surface-language, decision 8). Its predecessor,
  // `pinnedNextDeparture`, stood down whenever the week's own first row already
  // had room; the storefront makes the next boat the page's subject instead, so
  // the card renders and the week below stays a complete, honest sequence.
  // Both branches of the reader are unit-tested in src/lib/trips.test.ts.
  const card = page.getByRole("region", { name: "Next boat out" });
  await expect(card).toBeVisible();
  const title = await card.getByRole("heading", { level: 2 }).textContent();
  expect(title).toBeTruthy();

  const list = page.getByRole("list", { name: "Upcoming trips" });
  await expect(list.getByRole("listitem").filter({ hasText: title ?? "" })).not.toHaveCount(0);

  // The page's one primary, and where it goes.
  const book = card.getByRole("link", { name: "Book this boat" });
  await expect(book).toHaveAttribute("href", /^\/s\/blue-mantis\/trips\/[0-9a-f-]{36}#book$/);
  await book.click();
  await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}#book$/);
  await expect(page.getByLabel("Number of divers")).toBeVisible();
});

test("a week row is a link into its own departure", { tag: READ_ONLY }, async ({ page }) => {
  await page.goto("/s/blue-mantis");

  const firstRow = page.getByRole("list", { name: "Upcoming trips" }).getByRole("listitem").first();
  await expect(firstRow).toContainText(/spot|full/i);
  const link = firstRow.getByRole("link").first();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/s\/blue-mantis\/trips\/[0-9a-f-]{36}$/);

  await link.click();
  await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Number of divers")).toBeVisible();
});
