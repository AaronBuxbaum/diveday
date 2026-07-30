import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, signInAs } from "./helpers";

const SHOP = DEMO_SHOP_SLUG;

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

/** The seeded diver the shop is out of a size for — flagged for staff fit. */
const DIVER_WITH_FIT = "Sam Whitfield";
/** A seeded diver with a rental fit on file and no flag raised. */
const DIVER_WITH_UNFLAGGED_FIT = "Priya Sharma";

async function goToDiver(page: import("@playwright/test").Page, name: string) {
  await page.goto(`/shop/${SHOP}/divers?q=${encodeURIComponent(name)}`);
  const href = await page
    .locator(`a[href^="/shop/${SHOP}/divers/"]`)
    .filter({ hasText: name })
    .first()
    .getAttribute("href");
  if (!href) throw new Error(`no diver link for ${name}`);
  await page.goto(href);
}

/**
 * The three user-visible behaviours of ADR 20260724-gear-fit-fallback: H-06's
 * "needs staff fit" fallback and its override gate, and H-08's fail-open
 * minimum-age gate.
 */
test.describe("staff", () => {
  signedInAsOwner();

  test("a flagged diver keeps their count but loses the size, and is named for a check-in fit", async ({
    page,
  }) => {
    // The seed flags one diver on today's reef trip — no XL BCD left. Read the
    // card's href rather than clicking: the schedule list streams in, and
    // reading page.url() after a click races that render.
    const tripPath = await tripPathByTitle(page, "Two-Tank Reef — Molasses & French");
    await page.goto(`${tripPath}/prep`);

    const fitSection = page.getByRole("region", { name: "Fit these divers at check-in" });
    await expect(fitSection).toBeVisible();
    await expect(fitSection).toContainText("No XL BCD left");

    // Their stated XL size must not appear as something to pull — laying out a
    // substitute size is exactly what the flag exists to prevent...
    await expect(page.getByRole("table")).not.toContainText("XL");
    // ...but the BCD line itself stays, because the count is what the packer
    // loads from. Dropping it arrives a BCD short with nothing to fit them from.
    await expect(page.getByRole("table")).toContainText("Fit at check-in");
  });

  test("an owner rewrites a diver's fit, flags them, and clears it when resolved", async ({
    page,
  }) => {
    await goToDiver(page, DIVER_WITH_FIT);

    // This diver starts flagged by the seed; clear it so the test drives the
    // full flag → resolve cycle from a known state.
    await page.getByRole("button", { name: /Fit resolved/ }).click();
    await expect(page.getByRole("status")).toContainText("packs from their stated sizes again");

    // Editing the stated fit is allowed for an owner (canOverrideGearRequest).
    await page.getByLabel("BCD size").fill("M");
    await page.getByRole("button", { name: "Save rental fit" }).click();
    await expect(page.getByRole("status")).toContainText("Rental fit profile saved");

    // Flagging is a separate control, and open to any staff member.
    await page.getByLabel("What’s short").fill("No M BCD today");
    await page.getByRole("button", { name: "Flag for staff fit" }).click();
    await expect(page.getByRole("status")).toContainText("Flagged for hands-on fitting");
    await expect(page.getByText("No M BCD today")).toBeVisible();

    await page.getByRole("button", { name: /Fit resolved/ }).click();
    await expect(page.getByRole("status")).toContainText("packs from their stated sizes again");
  });
});

/**
 * Both layers of ADR-0006 for the H-06 gate: what the deck crew's screen
 * offers, and what the server does when the screen is bypassed. The second is
 * the one that matters — hiding a button is not authorization.
 */
test.describe("deck crew", () => {
  test("a captain may raise the fit flag but not rewrite sizes or clear it", async ({ page }) => {
    await signInAs(page, DEV_STAFF_LOGINS.captain);

    // A diver with a fit on file but no flag: the stated sizes are read-only,
    // and the safe fallback the captain actually needs at the dock is right
    // there — a flag is an escalation, not an override.
    await goToDiver(page, DIVER_WITH_UNFLAGGED_FIT);
    await expect(page.getByRole("button", { name: "Save rental fit" })).toHaveCount(0);
    await expect(page.getByText("limited to owners, managers, instructors, and")).toBeVisible();
    await expect(page.getByRole("button", { name: "Flag for staff fit" })).toBeEnabled();

    // The already-flagged diver: clearing asserts "we can pack their stated
    // size after all", which is the judgement call, so the captain doesn't get
    // it.
    await goToDiver(page, DIVER_WITH_FIT);
    await expect(page.getByRole("button", { name: /Fit resolved/ })).toHaveCount(0);
    await expect(page.getByText("Clearing this is limited to")).toBeVisible();
  });

  test("the server refuses a captain's clear even when the button is bypassed", async ({
    page,
  }) => {
    await signInAs(page, DEV_STAFF_LOGINS.captain);
    await goToDiver(page, DIVER_WITH_FIT);
    const flaggedHeading = page.getByRole("heading", { name: "Flagged for hands-on fitting" });
    await expect(flaggedHeading).toBeVisible();

    // The form is still on the page for a captain — only its submit button is
    // withheld. Submitting it directly sends no `needed` field, which is
    // exactly what a *clear* looks like. If the action trusted the rendered UI
    // this would silently put the diver back on the list at a size the shop
    // already said it was short of, with the attribution wiped in the same
    // statement so nothing recorded that it happened.
    await page.evaluate(() => {
      const form = Array.from(document.querySelectorAll("form")).find((candidate) =>
        candidate.textContent?.includes("Flagged for hands-on fitting"),
      );
      if (!form) throw new Error("the needs-staff-fit form is not on the page");
      form.requestSubmit();
    });

    await expect(page.getByRole("status")).toContainText(
      "Changing a diver's stated rental fit is limited to",
    );
    await expect(flaggedHeading).toBeVisible();
  });
});

test.describe("minimum age (H-08, fail open)", () => {
  signedInAsOwner();

  test("admits a diver with no date of birth and refuses one who is under age", async ({
    page,
  }) => {
    const stamp = e2eNow().getTime();
    // Open Water Diver states a minimum age of 10 in the seeded catalog.
    const sessionTitle = `Age gate session ${stamp}`;
    await page.goto(`/shop/${SHOP}/trips/new`);
    await page.getByLabel("Course").selectOption({ label: "Open Water Diver" });
    await page.getByLabel("Title").fill(sessionTitle);
    await page.getByLabel("Date").fill(daysFromNow(24));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("17:00");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    const tripPath = await tripPathByTitle(page, sessionTitle);
    await page.goto(tripPath);
    await page.getByLabel(/Marcus Webb/).check();
    await page.getByRole("button", { name: "Save crew" }).click();
    await expect(page.getByRole("status")).toContainText("Crew updated");

    // Fail open: a walk-in has no date on file — the same state every diver in
    // a live shop starts from — and books exactly as before.
    await page.goto(`${tripPath}/guests`);
    await page.getByLabel("Name", { exact: true }).fill(`Ageless Diver ${stamp}`);
    await page.getByLabel("Email", { exact: true }).fill(`ageless-${stamp}@example.com`);
    await page.getByRole("button", { name: "Add to trip" }).click();
    await expect(page.getByRole("status")).toContainText("Diver added to the trip");

    // Now a diver who *does* have a date on file, aged 8 on the course date.
    await page.goto(`/shop/${SHOP}/divers`);
    await page.getByText("Add a diver").click(); // the form lives in a collapsed <details>
    await page.getByLabel("Full name").fill(`Young Diver ${stamp}`);
    await page.getByLabel("Email").fill(`young-${stamp}@example.com`);
    await page.getByRole("button", { name: "Add diver" }).click();
    await expect(page).toHaveURL(/\/divers\/[0-9a-f-]+$/);

    await page.getByText("Edit details").click();
    await page.getByLabel("Date of birth").fill(daysFromNow(-365 * 8));
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status")).toContainText("Diver details updated");

    await page.goto(`${tripPath}/guests`);
    // Scope to the add-diver section: the global command palette also has a
    // button named "Search".
    const addDiver = page.locator("#add-diver");
    await addDiver.getByLabel("Find a returning diver").fill(`Young Diver ${stamp}`);
    await addDiver.getByRole("button", { name: "Search" }).click();
    // The picker's button is labelled per diver ("Add <name> to the trip"),
    // unlike the by-hand form's plain "Add to trip" used above.
    await addDiver.getByRole("button", { name: `Add Young Diver ${stamp} to the trip` }).click();
    // Not getByRole("alert"): Next's route announcer is also one.
    await expect(page.getByText("under this course's minimum age")).toBeVisible();
  });

  test("names the real reason on the diver's own checklist once a date on file makes them under age (H-22)", async ({
    page,
  }) => {
    const stamp = e2eNow().getTime();
    const sessionTitle = `Age disclosure session ${stamp}`;
    await page.goto(`/shop/${SHOP}/trips/new`);
    await page.getByLabel("Course").selectOption({ label: "Open Water Diver" });
    await page.getByLabel("Title").fill(sessionTitle);
    await page.getByLabel("Date").fill(daysFromNow(24));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("17:00");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    const tripPath = await tripPathByTitle(page, sessionTitle);
    await page.goto(tripPath);
    await page.getByLabel(/Marcus Webb/).check();
    await page.getByRole("button", { name: "Save crew" }).click();
    await expect(page.getByRole("status")).toContainText("Crew updated");

    // Staff must step aside for the public flow: /schedule/[id] redirects a
    // signed-in staff member of this shop straight to the trip's own staff
    // page, so "Book this date" would never reach the public booking form.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);

    // The PUBLIC form — actor: "public" in bookSpot — never refuses on age.
    // No date is on file yet, so this books exactly like any other walk-in
    // and never even raises the blocker.
    const diverName = `Late Bloomer ${stamp}`;
    await page.goto(`/shop/${SHOP}/courses/open-water-diver`);
    await page.getByRole("link", { name: "Book this date" }).last().click();
    // The booking form is controlled, so wait for hydration before typing —
    // otherwise a fill can land before React attaches and gets silently lost.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name").fill(diverName);
    await page.getByLabel("Email").fill(`late-bloomer-${stamp}@example.com`);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    // The confirmation heading greets by first name only ("...boat, Late! 🤿").
    await expect(
      page.getByRole("heading", {
        name: new RegExp(`You’re on the boat, ${diverName.split(" ")[0]}`),
      }),
    ).toBeVisible();

    await page.getByRole("link", { name: /readiness page/ }).click();
    await expect(page).toHaveURL(/\/ready\//);
    const readyUrl = page.url();
    // Fails open with no date on file: nothing age-related shown yet.
    await expect(page.getByText(/minimum age/)).toHaveCount(0);

    // Staff sign back in to record a date of birth putting them at 8 on the
    // course date — exactly the "recorded after the booking" case the
    // blocker exists to catch, since a booking-time-only gate would be inert
    // for this diver.
    await signInAs(page, DEV_STAFF_LOGINS.owner);
    await goToDiver(page, diverName);
    await page.getByText("Edit details").click();
    await page.getByLabel("Date of birth").fill(daysFromNow(-365 * 8));
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status")).toContainText("Diver details updated");

    // Same link, unchanged: the diver never re-requested it, but their own
    // checklist now names the real reason — no identity mismatch is in play
    // for this diver, so it isn't hidden behind the generic identity line.
    await page.goto(readyUrl);
    // The exact copy — including that it never states the diver's actual age
    // back — is pinned at the unit level (readiness-summary.test.ts); this
    // just confirms the real flow reaches it.
    await expect(page.getByText(/minimum age that the date of birth on file/)).toBeVisible();
  });
});
