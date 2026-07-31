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
  await page.goto(`/shop/${SHOP}/schedule`);
  const href = await page
    .locator(`a[href^="/shop/${SHOP}/trips/"]:not([href$="/trips/new"])`)
    .filter({ hasText: title })
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
  const header = page.locator("header").last();
  await expect(header.locator('a[href^="mailto:"]')).toBeVisible();
  await expect(header.locator('a[href^="tel:"]')).toBeVisible();
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

// Task 144 (safety-adjacent — this prints on the manifest): Today used to
// tell staff to "ask at the counter" and link to a roster with no field to
// type it into. Covers both entry points, the incomplete-entry failure path,
// and that the diver's own record shares the same value the roster wrote.
test("staff record and correct a diver's emergency contact from the roster and the diver record, and it prints on the manifest", async ({
  page,
}) => {
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
  await expect(card.getByText("Not on file")).toBeVisible();

  // Failure path: a name with no phone is not a reachable contact — the
  // save must say so, not silently claim success or a generic error.
  await card.getByText("Add emergency contact").click();
  await card.getByLabel("Contact name").fill("Robin Diver");
  await card.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /name and a phone number/ }),
  ).toBeVisible();
  // Still reads as missing — a half-entered contact is not "on file".
  await expect(card.getByText("Not on file")).toBeVisible();

  // Complete it.
  await card.getByText("Add emergency contact").click();
  await card.getByLabel("Contact name").fill("Robin Diver");
  await card.getByLabel("Contact phone").fill("+1 305 555 0166");
  await card.getByRole("button", { name: "Save contact" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Emergency contact saved" }),
  ).toBeVisible();
  await expect(card.getByText("Robin Diver · +1 305 555 0166")).toBeVisible();

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
