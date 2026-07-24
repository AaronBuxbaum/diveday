import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { signInAs } from "./helpers";

/**
 * The contact importer (ADR 20260723-contact-importer): the intake side of the
 * portability wedge. The happy path proves the safety spine survives a bulk
 * import — a card the source calls "verified" lands claimed, and a medical
 * column is visibly left behind — and the failure path proves the roster can't
 * be written by staff below owner/manager.
 */

// A rival-style export: pre-split name, a "verified" flag we must not trust,
// enriched-air with a card number, rental sizes, and a medical column.
const CONTACTS_CSV = [
  "First Name,Last Name,Email,Cell,Cert Agency,Cert Level,Cert Number,Verified,Nitrox,Nitrox Number,Wetsuit,Medical Notes",
  "Imported,Ingrid,imported.ingrid@example.com,305-555-0177,PADI,Advanced Open Water,AOW-IMP-1,true,yes,NX-IMP-1,3mm/M,none on file",
].join("\n");

test.describe("contact import", () => {
  signedInAsOwner();

  test("owner imports a CSV, cards land claimed, medical is left behind", async ({ page }) => {
    await page.goto("/shop/blue-mantis/settings/import");
    await expect(page.getByRole("heading", { name: "Import contacts" })).toBeVisible();

    // The published honesty table is on the page before any file is chosen.
    await expect(page.getByRole("heading", { name: "What comes across" })).toBeVisible();
    await expect(page.getByText("Medical & health history")).toBeVisible();

    await page.setInputFiles('input[type="file"]', {
      name: "contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(CONTACTS_CSV, "utf-8"),
    });

    // Preview: one importable row, the claimed-card note, and the medical column
    // called out as deliberately dropped.
    await expect(page.getByText("Will import")).toBeVisible();
    await expect(page.getByText(/Card imported as claimed/)).toBeVisible();
    await expect(page.getByText(/Left behind on purpose/)).toBeVisible();
    await expect(page.getByText(/Medical Notes/)).toBeVisible();

    await page.getByRole("button", { name: /Import 1 contact/ }).click();
    await expect(page.getByText(/Imported\. 1 added/)).toBeVisible();
    await expect(page.getByText(/added as claimed — verify each at first contact/)).toBeVisible();

    // The person is now on the roster.
    await page.goto("/shop/blue-mantis/divers?q=imported.ingrid@example.com");
    await expect(page.getByRole("link", { name: /Imported Ingrid/ })).toBeVisible();
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
  // roster, so they're told why they can't and get no upload control.
  await signInAs(page, DEV_STAFF_LOGINS.captain);
  await page.goto("/shop/blue-mantis/settings/import");
  await expect(page.getByText(/limited to the shop's owner or manager/)).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});
