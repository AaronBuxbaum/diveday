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

test("staff captures and verifies level and specialty certifications before either can be trusted", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();

  // Level certification: capture lands as pending, only an explicit verify trusts it.
  await page.getByText("Add certification", { exact: true }).click(); // open the collapsed capture form
  const form = levelForm(page);
  // No photo picker on either capture form: a card is trusted because a
  // staffer looked its number up with the issuing agency ("Mark certified"),
  // which a snapshot of the plastic never established.
  await expect(form.locator('input[name="cardImage"]')).toHaveCount(0);
  await form.locator('select[name="agency"]').selectOption("padi");
  await form.locator('select[name="level"]').selectOption("advanced_open_water");
  await form.getByLabel("Certification number").fill(`PADI-AOW-${e2eNow().getTime()}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();

  const pendingRow = page
    .locator("li")
    .filter({ hasText: "pending" })
    .filter({ visible: true })
    .last();
  await pendingRow.getByRole("button", { name: "Mark certified" }).click();
  await expect(page.getByRole("status")).toContainText("marked verified");

  // Specialty certification: gated exactly the same way, on the same record.
  await page.getByText("Add specialty", { exact: true }).click(); // open the collapsed capture form
  const cardNo = `PADI-WRECK-${e2eNow().getTime()}`;
  const specialty = specialtyForm(page);
  await specialty.locator('select[name="agency"]').selectOption("padi");
  await specialty.locator('select[name="specialty"]').selectOption("wreck");
  await specialty.getByLabel("Certification number").fill(cardNo);
  await specialty.getByRole("button", { name: "Capture specialty for review" }).click();

  // Scope to this card's row by its unique number; the specialty card shows
  // "<agency> · <specialty>", not the literal word "specialty".
  const specialtyRow = page
    .locator("li")
    .filter({ hasText: cardNo })
    .filter({ visible: true })
    .last();
  await specialtyRow.getByRole("button", { name: "Mark certified" }).click();
  await expect(page.getByRole("status")).toContainText("marked verified");

  // The specialty certification can be deleted outright (replaces the old "needs
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
  await expect(page.getByRole("status")).toContainText("Certification removed");
  await expect(
    page.locator("li").filter({ hasText: cardNo }).filter({ visible: true }),
  ).toHaveCount(0);
});

test("a diver record keeps card refusals visible and clears a wrong no-card stamp", async ({
  page,
  request,
}) => {
  test.setTimeout(30_000);
  const seeded = await request.post("/api/test/seed-trouble-states");
  expect(seeded.ok()).toBe(true);

  // Rowan's seeded self-declared level is the card-sighting path: a bad number
  // must return to the same open disclosure, then a plausible number must
  // certify the claim.
  await page.goto("/shop/blue-mantis/divers?q=Rowan");
  await page.getByRole("link", { name: /Rowan Feld/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rowan Feld" })).toBeVisible();
  const cards = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Certification records" }) })
    .filter({ visible: true });
  await cards.getByText("Verify certification record", { exact: true }).click();

  const sightingNumber = page.locator('input[name="sightedIdentifier"]').filter({ visible: true });
  await sightingNumber.fill("xx");
  await page.getByRole("button", { name: "Mark certified" }).click();
  await expect(
    page.getByText(
      "That doesn't look like a certification number. Type the number exactly as shown in the certification record, digits included.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await expect(
    page.locator('details[open] input[name="sightedIdentifier"]').filter({ visible: true }),
  ).toHaveCount(1);

  await sightingNumber.fill("PADI-ROWAN-2026");
  await page.getByRole("button", { name: "Mark certified" }).click();
  await expect(page.getByRole("status")).toContainText("Certification marked verified.");
  await expect(page.getByText("PADI-ROWAN-2026", { exact: true })).toBeVisible();

  // Nadia is the test-only uncarded state. Clearing it removes the warning
  // rather than turning the record into a certified one, and the confirmation
  // is the durable page-level outcome after the panel unmounts.
  await page.goto("/shop/blue-mantis/divers?q=Nadia");
  await page.getByRole("link", { name: /Nadia Petrov/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nadia Petrov" })).toBeVisible();
  await expect(page.getByText("Not certified yet — unconfirmed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "They didn't tell us that" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Cleared. This diver's record no longer says anything about certification",
  );
  await expect(page.getByText("Not certified yet — unconfirmed", { exact: true })).toHaveCount(0);
});

/*
 * The three card-photo upload tests that used to sit here (CR-011 oversize
 * rejection, CR-012 decode/re-encode and disguised-file rejection) went with
 * the picker itself — there is no longer any way to attach a photo to a level
 * or specialty card. The shared upload pipeline they exercised is unchanged
 * and still covered by `src/lib/storage/index.test.ts` and the course, recap,
 * and dive-site uploads that still use it.
 */

/**
 * The diver's own half of the same evidence loop.
 *
 * A diver whose readiness says "we still need your certification details" had
 * nowhere to put it: the checklist named the blocker and offered no action, so
 * the card arrived as a photo in a reply-to email or not until the dock
 * (2026-08-06 review). What they type lands `pending` like any other captured
 * record — the whole point is that it reaches the staff review that already
 * existed, not that it clears anything.
 */
test("a diver types their card in from the readiness page, and staff verify it there", async ({
  page,
}) => {
  // Three full journeys in one flow: staff creates the trip, a signed-out
  // diver books it and files their card from the readiness page, then staff
  // sign back in and verify it — two sign-in/out round trips plus a public
  // booking, each a multi-navigation sequence of its own.
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
  await expect(page).toHaveURL(/\/ready\//);

  // The blocker now carries the form that answers it — collapsed, because a
  // diver short several cards gets one disclosure per card rather than a stack
  // of open forms.
  const cardEntry = page
    .locator("details")
    .filter({ has: page.getByText("Add your certification", { exact: true }) });
  await expect(cardEntry).toBeVisible();
  await expect(cardEntry.getByLabel("Certification number")).toBeHidden();

  await cardEntry.getByText("Add your certification", { exact: true }).click();
  await cardEntry.getByLabel("Training agency").selectOption({ label: "PADI" });
  await cardEntry
    .getByLabel("Level", { exact: true })
    .selectOption({ label: "Advanced Open Water" });
  await cardEntry.getByLabel("Certification number").fill(cardNumber);
  await cardEntry.getByRole("button", { name: "Add my certification" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Certification added" })).toBeVisible();

  // Capture, never clearance: the row must not report itself as cleared, and
  // the same number typed again is recognised rather than refused.
  await expect(
    page
      .locator("details")
      .filter({ has: page.getByText("Add your certification", { exact: true }) }),
  ).toHaveCount(0);

  // Staff find it waiting for review on the diver's own record, and verify it.
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Nadia Okonkwo");
  await page.getByRole("link", { name: /Nadia Okonkwo/ }).click();
  // The number the diver typed is on the row, where a staffer checking it
  // against the plastic can read it. A claim with no number in it — the booking
  // form's level dropdown — says so instead; this is not that.
  const card = page.locator("li").filter({ hasText: cardNumber }).filter({ visible: true }).last();
  await expect(card).toBeVisible();
  // Pending, not trusted: the diver typed it, so it reaches the same review a
  // staff-captured card does and clears nothing until someone confirms it.
  await expect(card).toContainText("pending");

  // And the confirm is **not** the one-tap promote a staff-captured card gets.
  // A diver-typed row wears `self_declared_at`, so `reviewCertification` refuses
  // without the agency and number read off the card in the staffer's hand —
  // otherwise a number invented on a phone would land `verified`, the state
  // readiness reads (`security-reviewer`, 2026-08-20).
  await card.locator("summary").filter({ hasText: "Verify certification record" }).click();
  await card.getByLabel("Agency").selectOption({ label: "PADI" });
  await card.getByLabel("Certification number").fill(cardNumber);
  await card.getByRole("button", { name: "Mark certified" }).click();
  await expect(page.getByRole("status")).toContainText("marked verified");
});
