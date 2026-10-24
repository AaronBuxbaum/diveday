import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  e2eNow,
  openTripFromBoard,
  signOut,
} from "./helpers";

/**
 * **The card earns its place only when it says something the first row does
 * not** (visual review 2026-10-24, B17). On the seeded board the week's first
 * row *is* the next boat with space, so a card repeating it is gone and the
 * row leads. The card comes back when the first row is full: then it steps
 * over the full boat and says so (issue #1374).
 *
 * The first test writes: it puts a one-seat boat on this morning, ahead of the
 * seeded first row, and books that seat. The demo reset restores the schedule
 * before the next test (e2e-and-visual/shops.md).
 */
test.describe("a full boat ahead of the board", () => {
  signedInAsOwner();

  test("the shopfront leads with the next boat, and the week still lists it", async ({ page }) => {
    test.setTimeout(60_000);
    const full = `Early Boat ${e2eNow().getTime()}`;
    // 11:00 shop time on the frozen day (13:30Z is 9:30 EDT), so it sails
    // before the seeded 2:30 PM reef boat that otherwise leads the week.
    await createTrip(page, {
      title: full,
      date: daysFromNow(0),
      departsAt: "11:00",
      returnsAt: "12:30",
      capacity: 1,
      price: 90,
    });
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, full);
    const fullId = page.url().match(/\/trips\/([^/?#]+)/)?.[1];
    if (!fullId) throw new Error("could not read the trip id from the URL");
    await signOut(page);
    await page.goto(`/s/blue-mantis/trips/${fullId}`);
    await bookASeatAndOpenThread(page, "Fenna First");

    await page.goto("/s/blue-mantis");
    const rows = page.getByRole("list", { name: "Upcoming trips" }).getByRole("listitem");
    await expect(rows.filter({ hasText: full })).toContainText("Full");

    // **The card is a pin, not a removal** (ADR
    // 20260827-clearwater-surface-language, decision 8): it names the next boat
    // with space, and the week below still lists that boat in its place.
    const card = page.getByRole("region", { name: "Next boat with space" });
    await expect(card).toBeVisible();
    const title = await card.getByRole("heading", { level: 2 }).textContent();
    expect(title?.trim()).toBeTruthy();
    expect(title?.trim()).not.toBe(full);

    // **And it says why it is not the earlier boat** (issue #1374).
    await expect(card.getByText(/boats? (before it are|is) full/)).toBeVisible();

    const list = page.getByRole("list", { name: "Upcoming trips" });
    await expect(list.getByRole("listitem").filter({ hasText: title ?? "" })).not.toHaveCount(0);

    // The page's one primary, and where it goes.
    const book = card.getByRole("link", { name: "Book this boat" });
    await expect(book).toHaveAttribute("href", /^\/s\/blue-mantis\/trips\/[0-9a-f-]{36}#book$/);
    await book.click();
    await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}#book$/);
    await expect(page.getByLabel("Number of divers")).toBeVisible();

    // **A narrowed board says which question it answered** (issue #1391). The
    // early boat is a fun dive, so the fun-dive filter keeps it first and the
    // card's name says the boat is the next one *in this view*.
    await page.goto("/s/blue-mantis?tripType=fun_dive");
    await expect(page.getByRole("region", { name: "Next boat with space" })).toHaveAccessibleName(
      "Next boat with space in this view",
    );
  });
});

test("on the seeded board the first row is the next boat, and no card repeats it", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/s/blue-mantis");
  const first = page.getByRole("list", { name: "Upcoming trips" }).getByRole("listitem").first();
  await expect(first).toContainText(/seats?/);
  await expect(page.getByRole("region", { name: /Next boat with space/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Book this boat" })).toHaveCount(0);
});

test("a week row is a link into its own departure", { tag: READ_ONLY }, async ({ page }) => {
  await page.goto("/s/blue-mantis");

  const firstRow = page.getByRole("list", { name: "Upcoming trips" }).getByRole("listitem").first();
  await expect(firstRow).toContainText(/seat|full/i);
  const link = firstRow.getByRole("link").first();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/s\/blue-mantis\/trips\/[0-9a-f-]{36}$/);

  await link.click();
  await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel("Number of divers")).toBeVisible();
});
