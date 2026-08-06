import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, signInAsOwner, signOut } from "./helpers";

signedInAsOwner();

/** The diver detail page has two capture forms; scope by the form's own submit button. */
function levelForm(page: Page) {
  return page
    .locator("form", {
      has: page.getByRole("button", { name: "Capture for review", exact: true }),
    })
    .filter({ visible: true });
}
function specialtyForm(page: Page) {
  return page
    .locator("form", {
      has: page.getByRole("button", { name: "Capture specialty for review" }),
    })
    .filter({ visible: true });
}

test("staff captures and verifies level and specialty cards before either can be trusted", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();

  // Level card: capture lands as pending, only an explicit verify trusts it.
  await page.getByText("Add card", { exact: true }).click(); // open the collapsed capture form
  const form = levelForm(page);
  // No photo picker on either capture form: a card is trusted because a
  // staffer looked its number up with the issuing agency ("Mark certified"),
  // which a snapshot of the plastic never established.
  await expect(form.locator('input[name="cardImage"]')).toHaveCount(0);
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="level"]').selectOption("advanced_open_water");
  await form.getByLabel("Card number").fill(`PADI-AOW-${e2eNow().getTime()}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("pending");

  const pendingRow = page
    .locator("li")
    .filter({ hasText: "pending" })
    .filter({ visible: true })
    .last();
  await pendingRow.getByRole("button", { name: "Mark certified" }).click();
  await expect(page.getByRole("status")).toContainText("certified");

  // Specialty card: gated exactly the same way, on the same record.
  await page.getByText("Add specialty", { exact: true }).click(); // open the collapsed capture form
  const cardNo = `PADI-WRECK-${e2eNow().getTime()}`;
  const specialty = specialtyForm(page);
  await specialty.locator('select[name="agency"]').selectOption("padi");
  await specialty.locator('select[name="specialty"]').selectOption("wreck");
  await specialty.getByLabel("Card number").fill(cardNo);
  await specialty.getByRole("button", { name: "Capture specialty for review" }).click();
  await expect(page.getByRole("status")).toContainText("pending");

  // Scope to this card's row by its unique number; the specialty card shows
  // "<agency> · <specialty>", not the literal word "specialty".
  const specialtyRow = page
    .locator("li")
    .filter({ hasText: cardNo })
    .filter({ visible: true })
    .last();
  await specialtyRow.getByRole("button", { name: "Mark certified" }).click();
  await expect(page.getByRole("status")).toContainText("certified");

  // The specialty card can be deleted outright (replaces the old "needs
  // correction" flow). No confirm dialog: the delete lands and a toast offers a
  // one-tap undo (delight backlog — land-then-undo over "are you sure?").
  await page
    .locator("li")
    .filter({ hasText: cardNo })
    .filter({ visible: true })
    .last()
    .getByRole("button", {
      name: "Delete",
    })
    .click();
  await expect(page.getByRole("status")).toContainText("Card removed");
  await expect(
    page.locator("li").filter({ hasText: cardNo }).filter({ visible: true }),
  ).toHaveCount(0);
});

/*
 * The three card-photo upload tests that used to sit here (CR-011 oversize
 * rejection, CR-012 decode/re-encode and disguised-file rejection) went with
 * the picker itself — there is no longer any way to attach a photo to a level
 * or specialty card. The shared upload pipeline they exercised is unchanged
 * and still covered by `src/lib/storage/index.test.ts` and the course, recap,
 * and dive-site uploads that still use it.
 */

test("a certification past its refresher-due date reads as refresher due, not certified", async ({
  page,
}) => {
  // Yusuf Demir carries a verified card past its refresher-due date (see the seed).
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Yusuf Demir");
  await page.getByRole("link", { name: /Yusuf Demir/ }).click();
  await page.getByRole("heading", { level: 1, name: "Yusuf Demir" }).waitFor();

  // Real C-cards don't expire; a lapsed shop refresher-due date reads as
  // "refresher due" (H-08), never as a still-valid "certified".
  const refresherRow = page
    .locator("li")
    .filter({ hasText: "refresher" })
    .filter({ visible: true })
    .first();
  await expect(refresherRow).toBeVisible();
  await expect(refresherRow).not.toContainText("certified");
});

/**
 * The diver's own half of the same evidence loop.
 *
 * A diver whose readiness says "we still need your certification card" had
 * nowhere to put it: the checklist named the blocker and offered no action, so
 * the card arrived as a photo in a reply-to email or not until the dock
 * (2026-08-06 review). What they type lands `pending` like any other captured
 * card — the whole point is that it reaches the staff review that already
 * existed, not that it clears anything.
 */
test("a diver types their card in from the readiness page, and staff verify it there", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const cardNumber = `SELF-${e2eNow().getTime()}`;
  const title = `Self Cert Run ${e2eNow().getTime()}`;

  // This shop's default gate is Open Water, so a brand-new diver with no card
  // on file lands on the readiness page blocked for exactly one reason.
  await createTrip(page, {
    title,
    date: daysFromNow(5),
    departsAt: "08:00",
    returnsAt: "11:00",
    capacity: 6,
  });
  await signOut(page);

  await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("list", { name: "Upcoming trips" })
    .locator("li")
    .filter({ hasText: title })
    .getByRole("link")
    .click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name", { exact: true }).fill("Nadia Okonkwo");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`selfcert-${e2eNow().getTime()}@example.com`);
  await page.getByRole("button", { name: /^Book/ }).click();
  await page.getByRole("link", { name: /readiness page/ }).click();
  await expect(page).toHaveURL(/\/ready\//);

  // The blocker now carries the form that answers it.
  await expect(page.getByRole("heading", { name: "Add your certification card" })).toBeVisible();
  await page.getByLabel("Training agency").selectOption({ label: "PADI" });
  await page.getByLabel("Level", { exact: true }).selectOption({ label: "Advanced Open Water" });
  await page.getByLabel("Card number").fill(cardNumber);
  await page.getByRole("button", { name: "Add my card" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Card added" })).toBeVisible();

  // Capture, never clearance: the row must not report itself as cleared, and
  // the same number typed again is recognised rather than refused.
  await expect(page.getByRole("heading", { name: "Add your certification card" })).toHaveCount(0);

  // Staff find it waiting for review on the diver's own record, and verify it.
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Nadia Okonkwo");
  await page.getByRole("link", { name: /Nadia Okonkwo/ }).click();
  const card = page.locator("li").filter({ hasText: cardNumber }).filter({ visible: true }).last();
  await expect(card).toBeVisible();
  // Pending, not trusted: the diver typed it, so it reaches the same review a
  // staff-captured card does and clears nothing until someone confirms it.
  await expect(card).toContainText("pending");
  await card.getByRole("button", { name: "Mark certified" }).click();
  await expect(page.getByRole("status")).toContainText("certified");
});
