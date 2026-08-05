import type { Page } from "@playwright/test";
import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow } from "./helpers";

const SHOP = DEMO_SHOP_SLUG;

signedInAsOwner();

/**
 * A staff trip's path, read from the schedule card's own href. Clicking and
 * then reading `page.url()` races the streaming list — the card can still be
 * re-rendering, and the URL read lands on the wrong route.
 */
async function tripPathByTitle(page: Page, title: string | RegExp) {
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

  await createTrip(page, {
    shopSlug: SHOP,
    title,
    date: daysFromNow(5),
    departsAt: "09:00",
    returnsAt: "12:00",
  });

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

/**
 * **Remove → find → restore.**
 *
 * Removal has always been reversible in the data, and until the Removed view
 * existed it was not reversible in the product: the roster's undo toast was
 * twelve seconds long, and after that the diver matched no search, sat in no
 * view, and their record 404'd. A shop owner who removed the wrong person on
 * Tuesday had no way to put them back on Wednesday — which is the round trip
 * this spec walks, deliberately *without* touching the toast.
 */
test("staff remove a diver, find them again in the Removed view, and restore them", async ({
  page,
}) => {
  // Three navigations, a removal, a filtered search, and a restore — past the
  // suite's 15s default, which is sized for a single flow.
  test.setTimeout(30_000);
  const stamp = e2eNow().getTime();
  const diverName = `Removable Diver ${stamp}`;

  await page.goto(`/shop/${SHOP}/divers`);
  await page.getByText("Add a diver").click(); // the form lives in a collapsed <details>
  await page.getByLabel("Full name").fill(diverName);
  await page.getByLabel("Email").fill(`removable-${stamp}@example.com`);
  await page.getByRole("button", { name: "Add diver" }).click();
  await expect(page).toHaveURL(/\/divers\/[0-9a-f-]+(\?edit=1)?$/);
  await expect(page.getByRole("heading", { level: 1, name: diverName })).toBeVisible();
  const recordUrl = page.url().split("?")[0] ?? "";

  // Remove them from their own record.
  await page.getByText(`Remove ${diverName}`).click();
  await page.getByRole("button", { name: "Remove diver" }).click();
  // The land-then-undo toast, the app's one undo affordance — deliberately
  // left alone from here: the point of this spec is the path that still works
  // once it is gone.
  await expect(page.getByText("Diver removed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  // Gone from the active roster, and not findable by searching it.
  await page.goto(`/shop/${SHOP}/divers`);
  await page.getByRole("searchbox", { name: "Search divers" }).fill(diverName);
  await expect(page.getByText("No divers match this view.")).toBeVisible();

  // The Removed view is where they are, and search works inside it.
  await page.getByRole("link", { name: "Removed", exact: true }).click();
  await expect(page).toHaveURL(/filter=removed/);
  const row = page.getByRole("row").filter({ hasText: diverName });
  await expect(row).toBeVisible();

  // Their record still opens — the restore has to have somewhere to live.
  await page.goto(recordUrl);
  await expect(page.getByRole("heading", { level: 1, name: diverName })).toBeVisible();
  await expect(page.getByText("This diver is off your active lists")).toBeVisible();

  // Restore from the record, and they are back on the active roster.
  await page.getByRole("button", { name: "Restore diver" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Diver restored" })).toBeVisible();
  await page.goto(`/shop/${SHOP}/divers`);
  await page.getByRole("searchbox", { name: "Search divers" }).fill(diverName);
  await expect(page.getByRole("row").filter({ hasText: diverName })).toBeVisible();
});

/**
 * **An outcome belongs beside the control that earned it.**
 *
 * The diver record is eight independent forms on one ~6,400px scroll, and every
 * one of their outcomes used to resolve into a single banner under the `<h1>`:
 * you saved a rental fit halfway down the page and the confirmation appeared
 * off-screen above you. Each section now renders its own (`resolveDiverNotice`
 * + `FormStatus`), which is a claim about *where* the text is, so the assertion
 * has to be about containment rather than mere presence.
 */
test("a section's outcome renders inside that section, not in a banner at the top", async ({
  page,
}) => {
  test.setTimeout(30_000);

  await page.goto(`/shop/${SHOP}/divers?q=Priya`);
  await page.getByRole("row").filter({ hasText: "Priya Sharma" }).getByText("PS").click();
  await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();

  const rentalFit = page.getByRole("region", { name: "Rental fit" });
  await rentalFit.scrollIntoViewIfNeeded();
  await rentalFit.getByLabel("BCD size").fill("M");
  await rentalFit.getByRole("button", { name: "Save rental fit" }).click();

  // Scoped to the region: the same text anywhere else on the page would not
  // satisfy this, which is the whole point of the change.
  await expect(rentalFit.getByText("Rental fit profile saved.")).toBeVisible();
  // And it is genuinely where the staffer is looking, not merely inside the
  // right DOM subtree.
  await expect(rentalFit.getByText("Rental fit profile saved.")).toBeInViewport();

  // A refusal lands on the box it is about, not beside the button and not at
  // the top: this email belongs to another active diver in the demo shop.
  await page.getByText("Edit details").click();
  const detailsForm = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Save details" }) });
  await detailsForm.getByLabel("Email").fill("tom.okafor@example.com");
  await detailsForm.getByRole("button", { name: "Save details" }).click();

  // On the control (`Field`'s `error` wires `aria-invalid`/`aria-describedby`),
  // and inside the form — not in a banner two screens up.
  await expect(detailsForm.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(detailsForm.getByRole("alert")).toContainText(
    "Another diver already uses that email",
  );
  // The disclosure this form lives in is reopened by its own refusal: rendering
  // it inside a shut `<details>` would be worse than the banner it replaced.
  await expect(detailsForm.getByLabel("Email")).toBeVisible();
});
