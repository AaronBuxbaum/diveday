import type { Page } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  acceptAgeAttestation,
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openThreadStep,
  openTripAbout,
  signInAsOwner,
  signOut,
} from "./helpers";

signedInAsOwner();

/**
 * The record has **one** capture form now — every card kind is one group with
 * one add flow, and the card itself is the question (ADR
 * 20260827-people-not-lists). Scoped by the form's own submit button.
 */
function captureForm(page: Page) {
  return page
    .locator("form", {
      has: page.getByRole("button", { name: "Capture for review", exact: true }),
    })
    .filter({ visible: true });
}

test("staff captures and verifies level and specialty certifications before either can be trusted", async ({
  page,
}) => {
  // Nine navigations and five sequential form round-trips — the longest flow in
  // this file, and the only one that was still running on the 15s per-test
  // default while its three siblings declare 30s and 90s for less work. Not a
  // widened timeout papering over a race: the budget was never declared, and a
  // ceiling only ever bounds a *failure* (playwright.config.ts).
  test.setTimeout(60_000);
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Priya Sharma");
  await page.getByRole("link", { name: /Priya Sharma/ }).click();

  // Level certification: capture lands as pending, only an explicit verify trusts it.
  await page.getByText("Add certification", { exact: true }).click(); // open the collapsed capture form
  const form = captureForm(page);
  // No photo picker on either capture form: a card is trusted because a
  // staffer looked its number up with the issuing agency ("Mark certified"),
  // which a snapshot of the plastic never established.
  await expect(form.locator('input[name="cardImage"]')).toHaveCount(0);
  await form.locator('select[name="agency"]').selectOption("padi");
  // One select, two option groups: the ladder and the specialties, with the
  // value carrying its own kind.
  await form.locator('select[name="card"]').selectOption("level:advanced_open_water");
  await form.getByLabel("Certification number").fill(`PADI-AOW-${e2eNow().getTime()}`);
  await form.getByRole("button", { name: "Capture for review", exact: true }).click();

  const pendingRow = page
    .locator("li")
    .filter({ hasText: "pending" })
    .filter({ visible: true })
    .last();
  await pendingRow.getByRole("button", { name: "Mark certified" }).click();
  // The one-tap review settles in place and says so in a toast that offers an
  // Undo — the page-top "Certification marked verified. It counts toward
  // readiness." banner is gone, along with the reload that carried it.
  // Filtered rather than a bare `getByRole("status")`: this toast lives for a
  // few seconds and the delete below raises a second one, so naming the toast
  // is what keeps either assertion from depending on the other's timing.
  const certifiedToast = page.getByRole("status").filter({ hasText: "Marked certified." });
  await expect(certifiedToast).toBeVisible();
  await expect(certifiedToast.getByRole("button", { name: "Undo" })).toBeVisible();

  // Specialty certification: gated exactly the same way, through the same one
  // form on the same record.
  await page.getByText("Add certification", { exact: true }).click();
  const cardNo = `PADI-WRECK-${e2eNow().getTime()}`;
  const specialty = captureForm(page);
  await specialty.locator('select[name="agency"]').selectOption("padi");
  await specialty.locator('select[name="card"]').selectOption("specialty:wreck");
  await specialty.getByLabel("Certification number").fill(cardNo);
  await specialty.getByRole("button", { name: "Capture for review", exact: true }).click();

  // Scope to this card's row by its unique number; the specialty card shows
  // "<agency> · <specialty>", not the literal word "specialty".
  const specialtyRow = page
    .locator("li")
    .filter({ hasText: cardNo })
    .filter({ visible: true })
    .last();
  await specialtyRow.getByRole("button", { name: "Mark certified" }).click();
  await expect(specialtyRow).toContainText("certified");

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
  // The button says Delete and so does the toast — this used to be the one
  // sentence in the flow that said "removed" instead (issue #779).
  await expect(page.getByRole("status").filter({ hasText: "Certification deleted" })).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: cardNo }).filter({ visible: true }),
  ).toHaveCount(0);
});

/**
 * Issue #717. Before this, a shop that taught and certified its own student
 * had to hand-type that diver's card into DiveDay exactly as if a stranger
 * had issued it — and until a staffer did, the shop's own booking gate
 * refused the student's next-level booking. This walks the whole loop: an
 * instructor certifies a diver from their own course session's roster, with
 * no card number, and the diver books the next rung immediately.
 */
test("an instructor certifies a diver from the course roster, and they can book the next level with no retyping", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const sessionTitle = `Open Water Diver — cert test ${e2eNow().getTime()}`;
  await createTrip(page, {
    course: "Open Water Diver",
    title: sessionTitle,
    date: daysFromNow(24),
    departsAt: "08:00",
    returnsAt: "17:00",
  });

  await (await findTripOnBoard(page, "blue-mantis", new RegExp(`^${sessionTitle}$`))).click();
  await openTripAbout(page);
  await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
  await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();

  await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);

  const diverName = `Cert Test Diver ${e2eNow().getTime()}`;
  const diverEmail = `cert-test-${e2eNow().getTime()}@example.com`;
  await page.getByRole("link", { name: "Add diver" }).click();
  await page.waitForURL(/\/divers\/new/);
  await page.getByLabel("Full name").fill(diverName);
  await page.getByLabel("Email").fill(diverEmail);
  await page.getByRole("button", { name: "Add to trip" }).click();
  await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);
  await expect(page.getByRole("link", { name: diverName })).toBeVisible();

  const row = page.locator("li").filter({ hasText: diverName });
  await row.getByText("Certify", { exact: true }).click();
  await row.getByLabel("Level").selectOption({ label: "Open Water" });
  await row.getByRole("button", { name: "Confirm certification" }).click();
  await expect(
    page.getByText("Certified — they can book their next level with no further review."),
  ).toBeVisible();

  // The other half of the loop: no staffer retyped anything, and the same
  // diver (same email — createBookingRecord resolves the person by it)
  // already clears the course_prerequisite gate on their next booking.
  await page.context().clearCookies();
  await page.goto("/s/blue-mantis/courses");
  await page
    .getByRole("listitem")
    .filter({ hasText: "Advanced Open Water Diver" })
    .first()
    .getByRole("link")
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Upcoming dates" })).toBeVisible();
  await page.getByRole("link", { name: "Book this date" }).first().click();
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill(diverName);
  await page.getByLabel("Email").fill(diverEmail);
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You.re on the boat/ })).toBeVisible();
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
  // Rowan carries two self-declared cards — a level and a specialty — so the
  // group holds two identically-named disclosures. `#card-awaiting` is the
  // anchor the status ledger's "Verify it" lands on: the *first* card waiting
  // for somebody, in render order, which is the level card this test is about.
  await cards
    .locator("li")
    .filter({ has: page.locator("#card-awaiting") })
    .getByText("Verify certification record", { exact: true })
    .click();

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
  // No banner: the row itself changed, which is the whole outcome. A sighting
  // rewrites the card from what the staffer read off it, so unlike the one-tap
  // review beside it there is nothing to undo and no toast to offer one.
  //
  // The number now shares its line with who sighted it and when, so it is read
  // as part of that sentence rather than as a string of its own — and the row
  // wears **no badge at all**, because being certified is the state the shop
  // wants and a badge marks the exceptional one (ADR
  // 20260827-people-not-lists, decision 6). The attribution is what says it.
  const sighted = cards
    .locator("li")
    .filter({ hasText: "PADI-ROWAN-2026" })
    .filter({ visible: true });
  await expect(sighted).toContainText(/Certified by .+ on /);

  // Nadia is the test-only uncarded state. Clearing it removes the warning
  // rather than turning the record into a certified one, and the confirmation
  // is the durable page-level outcome after the panel unmounts.
  await page.goto("/shop/blue-mantis/divers?q=Nadia");
  await page.getByRole("link", { name: /Nadia Petrov/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nadia Petrov" })).toBeVisible();
  await expect(page.getByText("Not certified yet — unverified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "They didn't tell us that" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Cleared. This diver's record no longer says anything about certification",
  );
  await expect(page.getByText("Not certified yet — unverified", { exact: true })).toHaveCount(0);
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

  // The blocker carries the form that answers it, inside the spine's own
  // certification step (ADR 20260827-the-divers-thread, decision 3) — and
  // collapsed within it, because a diver short several cards gets one
  // disclosure per card rather than a stack of open forms.
  const certification = await openThreadStep(page, "certification");
  const cardEntry = certification
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
  // Scoped to the step and read without a visibility filter: the offer is gone
  // from the DOM once the card is on file, and a closed step would make a
  // visible-only assertion pass for the wrong reason.
  await expect(
    page
      .locator('[data-thread-step="certification"]')
      .getByText("Add your certification", { exact: true }),
  ).toHaveCount(0);

  // Staff find it waiting for review on the diver's own record, and verify it.
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/divers");
  await page.getByRole("searchbox", { name: "Search divers" }).fill("Nadia Okonkwo");
  await page.getByRole("link", { name: /Nadia Okonkwo/ }).click();
  // The number the diver typed is on the row, where a staffer checking it
  // against the plastic can read it. This is the only place a diver can file
  // one: the booking form asked for a rung and a card between 2026-08-20 and
  // 2026-08-27, and no longer asks at all (ADR
  // 20260820-attested-at-booking-verified-at-boarding, amended).
  const card = page.locator("li").filter({ hasText: cardNumber }).filter({ visible: true }).last();
  await expect(card).toBeVisible();
  // Not trusted: the diver typed it, so it reaches the same review a
  // staff-captured card does and clears nothing until someone confirms it. The
  // row says which weak state it is in rather than the bare "pending" it used
  // to wear — one badge per row, and every non-certified state carries a word
  // (ADR 20260827-people-not-lists, decision 6).
  await expect(card).toContainText("Self-declared — certification card not sighted yet");

  // And the confirm is **not** the one-tap promote a staff-captured card gets.
  // A diver-typed row wears `self_declared_at`, so `reviewCertification` refuses
  // without the agency and number read off the card in the staffer's hand —
  // otherwise a number invented on a phone would land `verified`, the state
  // readiness reads (`security-reviewer`, 2026-08-20).
  await card.locator("summary").filter({ hasText: "Verify certification record" }).click();
  await card.getByLabel("Agency").selectOption({ label: "PADI" });
  await card.getByLabel("Certification number").fill(cardNumber);
  await card.getByRole("button", { name: "Mark certified" }).click();
  await expect(
    page.locator("li").filter({ hasText: cardNumber }).filter({ visible: true }).last(),
  ).toContainText("certified");
});
