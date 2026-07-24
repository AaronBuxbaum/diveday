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

/** A seeded diver who definitely has a rental fit on file (seed.ts). */
const DIVER_WITH_FIT = "Sam Whitfield";

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

  test("a flagged diver drops off the packing list and is named for a check-in fit", async ({
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

    // Their stated XL kit must not appear as something to pull — laying out a
    // substitute size is exactly what the flag exists to prevent.
    await expect(page.getByRole("table")).not.toContainText("XL");
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

test("a captain may flag a diver for fitting but not rewrite their stated sizes", async ({
  page,
}) => {
  await signInAs(page, DEV_STAFF_LOGINS.captain);
  await goToDiver(page, DIVER_WITH_FIT);

  // Deck crew get the fit read-only, with the reason...
  await expect(page.getByRole("button", { name: "Save rental fit" })).toHaveCount(0);
  await expect(page.getByText("limited to instructors, divemasters, and managers")).toBeVisible();
  // ...but keep the safe fallback, which is the action they actually need. This
  // diver arrives flagged from the seed, so the control shows its resolve side —
  // either way it is present and usable by a captain.
  await expect(page.getByRole("button", { name: /Fit resolved/ })).toBeVisible();
  await page.getByRole("button", { name: /Fit resolved/ }).click();
  await expect(page.getByRole("status")).toContainText("packs from their stated sizes again");
  await expect(page.getByRole("button", { name: "Flag for staff fit" })).toBeVisible();
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
});
