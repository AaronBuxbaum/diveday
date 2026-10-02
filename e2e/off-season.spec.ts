import { expect, test } from "./fixtures";

/**
 * **The off-season as a designed state** (N-45).
 *
 * A shop with nothing on the board for the next thirty days is the one
 * storefront state the seeded fixture can never be — `blue-mantis` exists to
 * have a full board — so each test here empties it through
 * `/api/test/seed-off-season` and reads what a stranger is then handed.
 *
 * Mutating the shared fixture is safe: each Playwright worker owns its own
 * database and `/api/test/reset` restores the schedule before every test
 * (e2e/servers.ts), which is also why nothing here puts the board back.
 */

test("an empty board says when the shop is next doing something, and opens the composer", async ({
  page,
  request,
}) => {
  const seeded = await request.post("/api/test/seed-off-season");
  expect(seeded.ok()).toBe(true);

  await page.goto("/s/blue-mantis");

  await expect(
    page.getByRole("heading", { name: "Nothing on the water for a while" }),
  ).toBeVisible();
  // Nothing scheduled at all, so there is no date to name: the card is its
  // heading and nothing invented under it.
  await expect(page.getByText(/We’re back out /)).toHaveCount(0);

  // The sentence this state exists to remove. It read as a shop that had
  // stopped, on the page that decides whether a stranger books anywhere.
  await expect(page.getByText("No trips on the books yet")).toHaveCount(0);
  // And no section heading standing over nothing.
  await expect(page.getByRole("heading", { level: 2, name: "Schedule" })).toHaveCount(0);

  // The composer is the page's one primary and it is already open — no
  // disclosure to find, no chevron to guess at. The row's own summary, by the
  // child combinator: the composer inside it carries a "More details"
  // disclosure of its own now, and this claim is about the row, not about it.
  const dateRequest = page.locator("#request-a-date");
  await expect(dateRequest.getByRole("heading", { name: "Ask us for a day" })).toBeVisible();
  await expect(page.locator("details#request-a-date > summary")).toHaveCount(0);

  // Exactly one composer on the page: the collapsed row in "Other ways we can
  // help" stands down while this one is up, or the same id would render twice.
  await expect(page.locator("#request-a-date")).toHaveCount(1);

  // And it still sends. This is the one conversion a shop between seasons has.
  await dateRequest.getByLabel("What would you like to dive?").fill("A reef morning in April");
  await dateRequest.getByLabel("Your email").fill("off.season.e2e@example.com");
  await dateRequest.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
});

test("a departure beyond the quiet window is named as the day the shop is back", async ({
  page,
  request,
}) => {
  const seeded = await request.post("/api/test/seed-off-season?opensInDays=45");
  expect(seeded.ok()).toBe(true);

  await page.goto("/s/blue-mantis");

  await expect(
    page.getByRole("heading", { name: "Nothing on the water for a while" }),
  ).toBeVisible();
  // The date is the departure's own.
  await expect(page.getByText(/We’re back out /)).toBeVisible();

  // The board is not hidden — that departure is still bookable, and its row is
  // still there under the schedule heading.
  await expect(page.getByRole("heading", { level: 2, name: "Schedule" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Season Opener Two-Tank/ }).first()).toBeVisible();
});

test("a board with departures this week says nothing about the off-season", async ({ page }) => {
  await page.goto("/s/blue-mantis");

  await expect(page.getByText("Nothing on the water for a while")).toHaveCount(0);
  // And the ask is back where it belongs: one collapsed row among three. The
  // row's own summary, by the child combinator: the composer inside it carries
  // a "More details" disclosure of its own now.
  await expect(page.locator("details#request-a-date > summary")).toBeVisible();
});
