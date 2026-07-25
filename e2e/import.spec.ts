import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, signInAs } from "./helpers";

/**
 * The contact importer (ADR 20260723-contact-importer, ADR
 * 20260724-import-waiver-acceptance, ADR 20260724-import-verified-cards): the
 * intake side of the portability wedge. The happy path proves a bulk import
 * lands cards verified-and-flagged (with a one-tap staff confirm on the diver's
 * record), leaves an unrecognized medical column behind, and trusts a claimed
 * prior waiver acceptance — and the failure path proves the roster can't be
 * written by staff below owner/manager.
 */

// A rival-style export: pre-split name, a "verified" flag, enriched-air with a
// card number, rental sizes, an unrecognized medical column, a claimed prior
// waiver acceptance, and the prior shop it all came from.
const CONTACTS_CSV = [
  "First Name,Last Name,Email,Cell,Cert Agency,Cert Level,Cert Number,Verified,Nitrox,Nitrox Number,Wetsuit,Medical Notes,Waiver Accepted,Waiver Signed At,Waiver Source",
  "Imported,Ingrid,imported.ingrid@example.com,305-555-0177,PADI,Advanced Open Water,AOW-IMP-1,true,yes,NX-IMP-1,3mm/M,none on file,yes,2025-05-01,Old Blue Reef Divers",
].join("\n");

test.describe("contact import", () => {
  signedInAsOwner();

  test("owner imports a CSV: cards land verified-and-flagged with a one-tap confirm, an unrecognized medical column is left behind, and a claimed waiver is trusted and marked imported", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/import");
    await expect(page.getByRole("heading", { name: "Import contacts" })).toBeVisible();
    // The preview runs in the browser, so a file chosen before hydration is lost.
    await expect(page.locator('input[type="file"]')).toHaveAttribute("data-hydrated", "true");

    // The published honesty table is on the page before any file is chosen.
    await expect(page.getByRole("heading", { name: "What comes across" })).toBeVisible();
    await expect(page.getByText("Signed waivers & medical clearance")).toBeVisible();

    await page.setInputFiles('input[type="file"]', {
      name: "contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CONTACTS_CSV, "utf-8"),
    });

    // Preview: one importable row, the verified-and-flagged card note, the
    // medical column called out as deliberately dropped, and the waiver claim
    // called out as trusted.
    await expect(page.getByText("Divers in file")).toBeVisible();
    await expect(page.getByText(/Card imported as verified from your records/)).toBeVisible();
    await expect(page.getByText(/Left behind on purpose/)).toBeVisible();
    await expect(page.getByText(/Medical Notes/)).toBeVisible();
    await expect(
      page.getByText(/trusted from the prior shop, including medical clearance/),
    ).toBeVisible();
    await expect(page.getByText("accepted · imported")).toBeVisible();

    await page.getByRole("button", { name: /Import 1 contact/ }).click();
    await expect(page.getByText(/Imported\. 1 added/)).toBeVisible();
    await expect(
      page.getByText(/imported and flagged imported, with a one-tap confirm on each/),
    ).toBeVisible();
    await expect(page.getByText(/1 waiver imported as accepted/)).toBeVisible();

    // The person is now on the roster, with the soft "to confirm" nudge. The
    // roster renders each diver twice (a mobile list, a desktop table); scope
    // to the desktop row so the assertion doesn't land on the CSS-hidden copy.
    await page.goto("/shop/blue-mantis/divers?q=imported.ingrid@example.com");
    const row = page.getByRole("row").filter({ hasText: "Imported Ingrid" });
    await expect(row).toBeVisible();
    await expect(row.getByText(/to confirm/)).toBeVisible();

    // On the diver's record, the imported cards show verified + imported and a
    // one-tap Confirm card (a level card and a nitrox card); confirming one
    // clears its nudge but keeps the imported flag.
    await page.getByRole("link", { name: /Imported Ingrid/ }).click();
    await expect(page.getByText("Old Blue Reef Divers").first()).toBeVisible();
    const confirmButtons = page.getByRole("button", { name: "Confirm card" });
    await expect(confirmButtons.first()).toBeVisible();
    const before = await confirmButtons.count();
    await confirmButtons.first().click();
    await expect(confirmButtons).toHaveCount(before - 1);
  });
});

/**
 * Imported specialty cards (ADR 20260725-import-specialty-cards). A specialty
 * card comes across verified and flagged like any other, but it is the one card
 * whose *gate* waits on the staff confirm — so this walks the whole arc: import,
 * book the diver onto a specialty-gated trip, see the blocker, tap confirm, see
 * it clear. The card is a specialty row in a certification-style file, which is
 * the shape a rival's cert export actually emits.
 */
// One row per card, the shape a real certification export emits: the same diver
// on two rows, sharing the one PADI number that identifies them, and a US-locale
// refresher date. Row 2 must add its specialty card to row 1's diver rather than
// be discarded as a duplicate person.
const SPECIALTY_CSV = [
  "Full Name,Email,Cert Agency,Cert Level,Cert Number,Refresher Due,DAN Number,Waiver Source",
  "Deep Dana,deep.dana@example.com,PADI,Rescue Diver,PADI-9001,05/04/2031,DAN #4242,Old Blue Reef Divers",
  "Deep Dana,deep.dana@example.com,PADI,Deep Diver,PADI-9001,,,Old Blue Reef Divers",
].join("\n");

test.describe("contact import — specialty cards", () => {
  signedInAsOwner();

  test("an imported specialty card holds its dive until a staffer confirms it, then clears", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/import");
    // The honesty table now says specialty cards come across.
    await expect(page.getByText("Specialty cards (deep, wreck, night, drysuit)")).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveAttribute("data-hydrated", "true");

    await page.setInputFiles('input[type="file"]', {
      name: "specialties.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(SPECIALTY_CSV, "utf-8"),
    });
    await expect(page.getByText(/Specialty card imported as verified/)).toBeVisible();
    // Row 2 is the same diver, and says so rather than reading "skipped".
    await expect(page.getByText(/same diver as row 1/)).toBeVisible();
    await page.getByRole("button", { name: /Import 1 contact/ }).click();
    await expect(page.getByText(/Imported\. 1 added/)).toBeVisible();
    await expect(page.getByText(/1 specialty card/)).toBeVisible();
    await expect(page.getByText(/1 row\(s\) added cards to a diver/)).toBeVisible();
    await expect(
      page.getByText(/A dive that requires one of those specialties waits/),
    ).toBeVisible();

    // A trip that requires the deep specialty, and the imported diver on it.
    const title = `Deep Import Run ${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Date").fill(daysFromNow(5));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("12:00");
    await page.getByLabel("Capacity").fill("4");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toContainText(title);

    await page.goto("/shop/blue-mantis/schedule");
    await page.locator("li").filter({ hasText: title }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await page.getByRole("checkbox", { name: "Deep" }).check();
    await page.getByRole("button", { name: /Save requirements/ }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Guests" })
      .click();
    const addDiver = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Add a diver" }) });
    await addDiver.getByLabel("Name").fill("Deep Dana");
    await addDiver.getByLabel("Email").fill("deep.dana@example.com");
    await addDiver.getByRole("button", { name: "Add to trip" }).click();
    await expect(page.getByRole("status")).toContainText("Diver added to the trip.");

    // The card is on file and verified — and the dive still waits, which is the
    // whole point of the decision. The blocker names the fix, not just the fault.
    await expect(
      page.getByText(/came across in an import — a staffer needs to confirm it/),
    ).toBeVisible();

    // One tap on the diver's record clears it.
    await page.goto("/shop/blue-mantis/divers?q=deep.dana@example.com");
    await page.getByRole("link", { name: /Deep Dana/ }).click();
    await expect(page.getByText("imported · Old Blue Reef Divers").first()).toBeVisible();
    // Both cards came across on one diver — row 2 added to row 1's diver rather
    // than being dropped — and the specialty badge does not read like a
    // hand-verified card while its gate is still shut.
    await expect(page.getByText("PADI · Deep")).toBeVisible();
    await expect(page.getByText("PADI · Rescue Diver")).toBeVisible();
    await expect(page.getByText("certified · confirm to clear")).toBeVisible();
    await page
      .locator("li")
      .filter({ hasText: "PADI · Deep" })
      .getByRole("button", { name: "Confirm card" })
      .click();

    await page.goto("/shop/blue-mantis/schedule");
    await page.locator("li").filter({ hasText: title }).click();
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Guests" })
      .click();
    await expect(page.getByText(/came across in an import/)).toHaveCount(0);
  });
});

test.describe("contact import — explicit bounds (CR-016)", () => {
  signedInAsOwner();

  test("a file with too many columns is rejected client-side with a friendly reason", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/import");
    await expect(page.locator('input[type="file"]')).toHaveAttribute("data-hydrated", "true");
    // MAX_IMPORT_COLUMNS is 40 in src/lib/import.ts — 42 headers trips the
    // limit without needing a slow multi-megabyte fixture.
    const headers = ["full_name", ...Array.from({ length: 41 }, (_, i) => `col${i}`)].join(",");
    const oversizedCsv = `${headers}\nAda,${"x,".repeat(41)}x`;

    await page.setInputFiles('input[type="file"]', {
      name: "too-wide.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(oversizedCsv, "utf-8"),
    });

    await expect(page.getByText(/too many columns/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import/ })).toHaveCount(0);
  });
});

test("import is refused for staff below owner/manager", async ({ page }) => {
  // A captain is staff everywhere else, but the importer writes the whole
  // roster, so the surface doesn't exist for them — bounced to Today rather
  // than shown a read-only/explained page.
  await signInAs(page, DEV_STAFF_LOGINS.captain);
  await page.goto("/shop/blue-mantis/settings/import");
  await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});
