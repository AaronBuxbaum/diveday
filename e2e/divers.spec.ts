import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow } from "./helpers";

const SHOP = DEMO_SHOP_SLUG;

signedInAsOwner();

/**
 * A staff trip's path, read from the schedule card's own href. Clicking and
 * then reading `page.url()` races the streaming list — the card can still be
 * re-rendering, and the URL read lands on the wrong route.
 */
async function tripPathByTitle(page: import("@playwright/test").Page, title: string | RegExp) {
  await page.goto(`/shop/${SHOP}/schedule/board`);
  const href = await page
    .locator(`a[href^="/shop/${SHOP}/trips/"]:not([href$="/trips/new"])`)
    .filter({ hasText: title })
    .filter({ visible: true })
    .first()
    .getAttribute("href");
  if (!href) throw new Error(`no trip card found for ${title}`);
  return href;
}

test("staff opens a diver from their avatar and can reach them from the header", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  // The extended roster is well past one default page, sorted alphabetically —
  // search for her rather than assume she's on the unfiltered first page.
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

  // The whole person cell is one link, so the initials avatar opens the diver
  // just like the name does.
  const row = page.getByRole("row").filter({ hasText: "Priya Sharma" });
  await row.getByText("PS", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  // Contact details are one tap from the front desk: mail the diver or call them.
  const header = page.locator("header").filter({ visible: true }).last();
  await expect(header.locator('a[href^="mailto:"]').filter({ visible: true })).toBeVisible();
  await expect(header.locator('a[href^="tel:"]').filter({ visible: true })).toBeVisible();
});

test("a diver's record shows their still-scheduled trips, linked straight to the manifest", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await page.getByRole("row").filter({ hasText: "Priya Sharma" }).getByText("PS").click();

  const upcoming = page.getByRole("region", { name: "Upcoming trips" });
  await expect(upcoming).toBeVisible();
  const firstRow = upcoming.getByRole("link").first();
  await firstRow.click();
  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+\/manifest$/);
});

/**
 * The diver record is one ~6,400px scroll on a phone. Payments — the section a
 * staffer opens this page for when somebody is standing at the counter with a
 * bill — used to sit seventh, below "Book an activity", reachable only by
 * flicking. The sub-nav is the way down, and it is a plain hash jump: no route
 * change, no refetch, the whole record stays loaded behind it.
 */
test("the diver record's sub-nav jumps to a section without leaving the page", async ({ page }) => {
  await page.goto("/shop/blue-mantis/divers?q=Talia");
  await page.getByRole("row").filter({ hasText: "Talia Rosen" }).getByText("TR").click();
  await expect(page.getByRole("heading", { level: 1, name: "Talia Rosen" })).toBeVisible();

  const subNav = page.getByRole("navigation", { name: "Diver record" });
  await expect(subNav).toBeVisible();

  const payments = page.getByRole("heading", { name: "Payments" });
  // Seventh of eleven sections: far below the fold on arrival.
  await expect(payments).not.toBeInViewport();

  await subNav.getByRole("link", { name: "Payments" }).click();
  await expect(page).toHaveURL(/\/divers\/[a-f0-9-]+#payments$/);
  await expect(payments).toBeInViewport();
  // Same document, not a navigation — the header never re-rendered away.
  await expect(page.getByRole("heading", { level: 1, name: "Talia Rosen" })).toBeAttached();

  // And back up, so the bar is a spine rather than a one-way trip.
  await subNav.getByRole("link", { name: "Cards" }).click();
  await expect(page).toHaveURL(/#cards$/);
  await expect(page.getByRole("heading", { name: "Certification cards" })).toBeInViewport();

  // The destructive tail is deliberately not a sub-nav target: removing a diver
  // and erasing their personal data cost a scroll, on purpose.
  await expect(subNav.getByRole("link")).toHaveCount(5);
  await expect(subNav.getByRole("link", { name: /Erase|Remove/ })).toHaveCount(0);
});

// Task 144 (safety-adjacent — this prints on the manifest): Today used to
// tell staff to "ask at the counter" and link to a roster with no field to
// type it into. Covers both entry points, the incomplete-entry failure path,
// and that the diver's own record shares the same value the roster wrote.
test("staff record and correct a diver's emergency contact from the roster and the diver record, and it prints on the manifest", async ({
  page,
}) => {
  // Three real navigations (create, schedule, guests) plus a two-round
  // contact save and a diver-record round trip — past the suite's 15s
  // default, which is sized for a single flow, not this many.
  test.setTimeout(30_000);
  const stamp = e2eNow().getTime();
  const title = `Contact Capture Run ${stamp}`;
  const diverName = `Contact Diver ${stamp}`;

  await page.goto(`/shop/${SHOP}/trips/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(5));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("12:00");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toBeVisible();

  const tripPath = await tripPathByTitle(page, title);
  await page.goto(`${tripPath}/guests`);
  await page.getByLabel("Name", { exact: true }).fill(diverName);
  await page.getByLabel("Email", { exact: true }).fill(`contact-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await expect(page.getByRole("status")).toContainText("Diver added to the trip");

  const card = page.locator("li").filter({ hasText: diverName });
  await expect(card.getByText("Not on file").filter({ visible: true })).toBeVisible();

  // Failure path: a name with no phone is not a reachable contact — the
  // save must say so, not silently claim success or a generic error.
  await card.getByText("Add emergency contact").filter({ visible: true }).click();
  await card.getByLabel("Contact name").fill("Robin Diver");
  await card.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /name and a phone number/ }),
  ).toBeVisible();
  // Still reads as missing — a half-entered contact is not "on file".
  await expect(card.getByText("Not on file").filter({ visible: true })).toBeVisible();

  // Complete it.
  await card.getByText("Add emergency contact").filter({ visible: true }).click();
  await card.getByLabel("Contact name").fill("Robin Diver");
  await card.getByLabel("Contact phone").fill("+1 305 555 0166");
  await card.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Emergency contact saved" }),
  ).toBeVisible();
  await expect(
    card.getByText("Robin Diver · +1 305 555 0166").filter({ visible: true }),
  ).toBeVisible();

  // The diver's own record reads the same value straight through
  // `updateDiver`/`saveBookingEmergencyContact` sharing the same columns —
  // one write path regardless of who fills it in.
  await card.getByRole("link", { name: diverName }).click();
  await page.getByText("Edit details").click();
  await expect(page.getByLabel("Emergency contact name")).toHaveValue("Robin Diver");
  await expect(page.getByLabel("Emergency contact phone")).toHaveValue("+1 305 555 0166");

  // Staff correct a wrong entry directly on the diver record.
  await page.getByLabel("Emergency contact name").fill("Casey Diver");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toContainText("Diver details updated");

  // Prints on the manifest.
  await page.goto(`${tripPath}/manifest`);
  await expect(page.getByText("Casey Diver · +1 305 555 0166")).toBeVisible();
});

/**
 * The roster paged forward-only by cursor: "Show more divers" and, once you
 * had moved, "Back to the top of the list" — so a staffer three pages into the
 * roster could only start over, and was never told how much roster was left.
 * It wears the shared pager now (ADR 20260803-one-pagination-model), and the
 * thing that spec must prove is the thing that was missing: going *back* one
 * page lands on the page you came from, not at the top.
 */
test("the roster pages both ways, and back one page is the page you came from", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  const pager = page.getByRole("navigation", { name: "Pages" });
  // Not "skip when there's nothing to page": the demo roster is well past one
  // page, so a missing pager is the regression, not a reason to pass.
  await expect(pager).toBeVisible();
  await expect(pager).toContainText(/Page 1 of \d+/);

  const firstName = await page.getByRole("row").nth(1).getByRole("link").first().textContent();

  await pager.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
  const secondName = await page.getByRole("row").nth(1).getByRole("link").first().textContent();
  expect(secondName).not.toBe(firstName);

  // Forward once more, then back one — page 2 again, not page 1 and not the top.
  await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Next" }).click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 3 of");
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Previous" })
    .click();
  await expect(page.getByRole("navigation", { name: "Pages" })).toContainText("Page 2 of");
  expect(await page.getByRole("row").nth(1).getByRole("link").first().textContent()).toBe(
    secondName,
  );

  // A search resets to the first page rather than stranding the reader on a
  // page the narrowed result set does not have.
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await expect(page.getByRole("row").filter({ hasText: "Priya Sharma" })).toBeVisible();
  await expect(page).not.toHaveURL(/page=/);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // The table hides sideways columns behind a scroll on a 390px screen, so
  // the list swaps to stacked cards there — everything readable, no scroll.
  test("the divers list stacks into cards and still opens the diver", async ({ page }) => {
    await page.goto("/shop/blue-mantis/divers");
    await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");

    const card = page.getByRole("link", { name: /Priya Sharma/ });
    await expect(card).toBeVisible();
    await expect(card.getByText(/card/)).toBeVisible();
    await expect(page.getByRole("table")).toBeHidden();

    await card.click();
    await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();
  });
});
