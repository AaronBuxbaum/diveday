import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { signInAs } from "./helpers";

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
    await expect(page.getByText("Will import")).toBeVisible();
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
      page.getByText(/imported as verified — flagged imported, with a one-tap confirm on each/),
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

test.describe("contact import — explicit bounds (CR-016)", () => {
  signedInAsOwner();

  test("a file with too many columns is rejected client-side with a friendly reason", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/import");
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
