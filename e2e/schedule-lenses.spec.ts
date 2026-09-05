import type { Page } from "@playwright/test";
import { expect, READ_ONLY, test } from "./fixtures";

/**
 * **The storefront's lens rail** — ADR 20260904-reef-all-the-way-down,
 * decision 2 (issue #1162): the shop's own words for its kinds of day, as a row
 * of views onto the departures below.
 *
 * READ_ONLY holds throughout: this opens the public schedule and follows links.
 * Nothing here fills a field or submits a form except the shipped filter row,
 * which is a GET.
 */

/** The rail, by its accessible name. `FilterChips` renders it as a `<nav>`. */
const rail = (page: Page) => page.getByRole("navigation", { name: "Kinds of day" });

/**
 * The departures, addressed the way the rest of this suite addresses them — the
 * `ul` immediately after the filter form. The rail sits *above* the form
 * precisely so this locator keeps working.
 */
const list = (page: Page) => page.locator("form + ul");

test("a lens narrows the board, and every row left wears its word", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/s/blue-mantis");

  await expect(rail(page).getByRole("link", { name: "Every departure" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  // The unfiltered board mixes kinds: the reef charter is what "After dark"
  // must remove.
  await expect(
    list(page).getByRole("listitem").filter({ hasText: "Two-Tank Reef — Molasses & French" }),
  ).not.toHaveCount(0);

  await rail(page).getByRole("link", { name: "After dark", exact: true }).click();

  await expect(page).toHaveURL(/[?&]lens=after-dark/);
  await expect(rail(page).getByRole("link", { name: "After dark", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(rail(page).getByRole("link", { name: "Every departure" })).not.toHaveAttribute(
    "aria-current",
    "true",
  );

  const rows = list(page).getByRole("listitem");
  await expect(rows).not.toHaveCount(0);
  // Every row left names the word the reader asked for, on its one meta line.
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i).getByText("After dark")).toBeVisible();
  }
  await expect(
    list(page).getByRole("listitem").filter({ hasText: "Two-Tank Reef — Molasses & French" }),
  ).toHaveCount(0);
});

test("'Every departure' puts the whole board back", { tag: READ_ONLY }, async ({ page }) => {
  await page.goto("/s/blue-mantis?lens=after-dark");
  await expect(
    list(page).getByRole("listitem").filter({ hasText: "Two-Tank Reef — Molasses & French" }),
  ).toHaveCount(0);

  await rail(page).getByRole("link", { name: "Every departure" }).click();

  await expect(page).not.toHaveURL(/lens=/);
  await expect(rail(page).getByRole("link", { name: "Every departure" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(
    list(page).getByRole("listitem").filter({ hasText: "Two-Tank Reef — Molasses & French" }),
  ).not.toHaveCount(0);
});

test("an unknown lens shows the whole board rather than an error", {
  tag: READ_ONLY,
}, async ({ page }) => {
  // A link shared before the shop deleted or renamed a word. Showing everything
  // is the honest answer; falling back to the first lens would narrow the list
  // under a word the diver never asked for.
  await page.goto("/s/blue-mantis?lens=nope");

  await expect(rail(page).getByRole("link", { name: "Every departure" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(
    list(page).getByRole("listitem").filter({ hasText: "Two-Tank Reef — Molasses & French" }),
  ).not.toHaveCount(0);
});

test("the lens survives a month step and a 'Has space' tap", { tag: READ_ONLY }, async ({
  page,
}) => {
  await page.goto("/s/blue-mantis?lens=after-dark");

  // The filter row is a GET form: without the hidden `lens` input, one tap of
  // "Has space" erases the reader's view with nothing saying why.
  await expect(page.getByLabel("Trip type")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Has space").check();
  await expect(page).toHaveURL(/hasSpace=1/);
  await expect(page).toHaveURL(/[?&]lens=after-dark/);
  await expect(rail(page).getByRole("link", { name: "After dark", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );

  // And the month arrows carry it the same way they carry the filters.
  await page.getByRole("link", { name: "Next month" }).click();
  await expect(page).toHaveURL(/month=/);
  await expect(page).toHaveURL(/[?&]lens=after-dark/);
  await expect(rail(page).getByRole("link", { name: "After dark", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
});
