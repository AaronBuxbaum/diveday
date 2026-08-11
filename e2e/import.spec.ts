import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, openTripFromBoard } from "./helpers";

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
    await expect(page.locator('input[type="file"]').filter({ visible: true })).toHaveAttribute(
      "data-hydrated",
      "true",
    );

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
      page.getByText(/trusted from the prior shop, medical clearance included/),
    ).toBeVisible();
    await expect(page.getByText("accepted · imported")).toBeVisible();

    await page.getByRole("button", { name: /Import 1 contact/ }).click();
    await expect(page.getByText(/Imported\. 1 added/)).toBeVisible();
    await expect(
      page.getByText(/imported, flagged imported, with a one-tap confirm on each/),
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
    // A level card's confirm stays one tap: it clears a soft nudge, not a gate —
    // that card already satisfied readiness on arrival (H-24 scopes the
    // attestation to the confirms that open something).
    const levelCard = page.locator("li").filter({ hasText: "PADI · Advanced Open Water" });
    await levelCard.getByRole("button", { name: "Confirm card" }).click();
    await expect(levelCard.getByRole("button", { name: "Confirm card" })).toHaveCount(0);
    await expect(levelCard.getByText(/^imported(?: ·|$)/i).filter({ visible: true })).toBeVisible();
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
    // Six full-page navigations plus a trip/roster setup and a confirm-card
    // flow — same aggregate-cost reasoning as visual.spec.ts's
    // `test.setTimeout` and role-permissions.spec.ts's captain test: many
    // real, sequential steps under 2-worker load add up past the default 15s
    // budget even though no individual step is stuck.
    test.setTimeout(30_000);
    await page.goto("/shop/blue-mantis/settings/import");
    // The honesty table now says specialty cards come across.
    await expect(page.getByText("Specialty cards (deep, wreck, night, drysuit)")).toBeVisible();
    await expect(page.locator('input[type="file"]').filter({ visible: true })).toHaveAttribute(
      "data-hydrated",
      "true",
    );

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
    await createTrip(page, {
      title,
      date: daysFromNow(5),
      departsAt: "08:00",
      returnsAt: "12:00",
      capacity: 4,
    });

    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, title);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    // The requirements form waits behind its Edit disclosure (summary-first
    // Overview).
    await page.getByText("Edit requirements", { exact: true }).click();
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
    await expect(page.getByRole("status")).toContainText(
      "Diver added to the trip — but their waiver wasn’t emailed.",
    );

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
    // The confirm is no longer a bare tap: it states what the staffer asserts,
    // because this is what opens the deep dive (H-24).
    const deepCard = page.locator("li").filter({ hasText: "PADI · Deep" });
    await deepCard.getByText("Confirm card").filter({ visible: true }).first().click();
    await expect(
      deepCard
        .getByText(/I've seen this diver's card, or checked the number/)
        .filter({ visible: true }),
    ).toBeVisible();
    await deepCard.getByRole("checkbox", { name: /I've seen this diver's card/ }).check();
    await deepCard.getByRole("button", { name: "Confirm card" }).click();

    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, title);
    await page
      .getByRole("navigation", { name: "Trip" })
      .getByRole("link", { name: "Guests" })
      .click();
    await expect(page.getByText(/came across in an import/)).toHaveCount(0);
  });
});

/**
 * Imported prior visits (ADR 20260725-import-prior-visits). The file is the
 * shape a booking platform actually exports — one row per booking, the same
 * customer repeated — and the flow proves the two things that make this safe to
 * ship: the history lands on the diver's profile marked as imported, and a
 * second run of the same file does not double it.
 */
const BOOKINGS_CSV = [
  "Customer Name,Email,Booking Date,Tour Name,Booking Status,Total,Booking ID",
  "Regular Rosa,regular.rosa@example.com,2024-06-12,Two-tank Molasses Reef,Completed,$165.00,FH-9001",
  "Regular Rosa,regular.rosa@example.com,2025-01-20,Night dive Benwood,Cancelled,$95.00,FH-9002",
  "Regular Rosa,regular.rosa@example.com,2025-08-03,Drift the Wall,Completed,$180.00,FH-9003",
].join("\n");

test.describe("contact import — prior visits", () => {
  signedInAsOwner();

  test("a bookings export becomes one diver with their visit history, and re-importing it doesn't double that history", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/import");
    // The honesty table says past visits come across, and says what they aren't.
    await expect(page.getByText("Past visits (what they booked, when)")).toBeVisible();
    await expect(page.locator('input[type="file"]').filter({ visible: true })).toHaveAttribute(
      "data-hydrated",
      "true",
    );

    await page.setInputFiles('input[type="file"]', {
      name: "bookings.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(BOOKINGS_CSV, "utf-8"),
    });

    // Three booking rows, one diver: the preview says so before anything is written.
    await expect(page.getByText(/3 rows record a past visit/)).toBeVisible();
    await expect(page.getByText(/See .What comes across. above/)).toBeVisible();
    await page.getByRole("button", { name: /Import 1 contact/ }).click();
    await expect(page.getByText(/Imported\. 1 added/)).toBeVisible();
    await expect(page.getByText(/3 past visits added to divers' shop history/)).toBeVisible();

    // On the diver's record the history reads as history: the old system's own
    // words, marked imported, and never a link to a trip that doesn't exist here.
    await page.goto("/shop/blue-mantis/divers?q=regular.rosa@example.com");
    await page.getByRole("link", { name: /Regular Rosa/ }).click();
    const history = page.locator("section").filter({ has: page.getByText("Shop history") });
    await expect(
      history.getByText(/3 visits came across from your previous system/).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      history.getByText(/booking records, not dive records/).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      history.getByText("Two-tank Molasses Reef").filter({ visible: true }),
    ).toBeVisible();
    await expect(history.getByText("$165.00").filter({ visible: true })).toBeVisible();
    // The cancelled booking is shown as cancelled, not quietly counted as a dive.
    await expect(history.getByText("Cancelled").filter({ visible: true })).toBeVisible();
    await expect(history.getByRole("link", { name: "Drift the Wall" })).toHaveCount(0);

    // Re-running the same export is the normal thing an owner does as their
    // roster grows — it must update, never double.
    await page.goto("/shop/blue-mantis/settings/import");
    await expect(page.locator('input[type="file"]').filter({ visible: true })).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    await page.setInputFiles('input[type="file"]', {
      name: "bookings.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(BOOKINGS_CSV, "utf-8"),
    });
    await page.getByRole("button", { name: /Import 1 contact/ }).click();
    await expect(page.getByText(/were already imported and were left as they are/)).toBeVisible();

    await page.goto("/shop/blue-mantis/divers?q=regular.rosa@example.com");
    await page.getByRole("link", { name: /Regular Rosa/ }).click();
    await expect(
      page
        .locator("section")
        .filter({ has: page.getByText("Shop history") })
        .getByText(/3 visits came across/)
        .filter({ visible: true }),
    ).toBeVisible();
  });
});

test.describe("contact import — explicit bounds (CR-016)", () => {
  signedInAsOwner();

  test("a file with too many columns is rejected client-side with a friendly reason", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/import");
    await expect(page.locator('input[type="file"]').filter({ visible: true })).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    // MAX_IMPORT_COLUMNS is 64 in src/lib/import.ts (raised for the column-heavy
    // bookings exports prior visits read) — 66 headers trips the limit without
    // needing a slow multi-megabyte fixture.
    const headers = ["full_name", ...Array.from({ length: 65 }, (_, i) => `col${i}`)].join(",");
    const oversizedCsv = `${headers}\nAda,${"x,".repeat(65)}x`;

    await page.setInputFiles('input[type="file"]', {
      name: "too-wide.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(oversizedCsv, "utf-8"),
    });

    await expect(page.getByText(/too many columns/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import/ })).toHaveCount(0);
  });
});

test.describe("import ↔ switching guides", () => {
  signedInAsOwner();

  test("the import page links out to a matching switching guide, and a guide's CTA deep-links back to this shop's import page", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/settings/import");
    await expect(page.getByRole("link", { name: "EVE" })).toHaveAttribute("href", "/switching/eve");
    await expect(page.getByRole("link", { name: "DiveShop360" })).toHaveAttribute(
      "href",
      "/switching/diveshop360",
    );
    await expect(page.getByRole("link", { name: "a spreadsheet" })).toHaveAttribute(
      "href",
      "/switching/spreadsheet",
    );

    await page.goto("/switching/eve");
    await page.getByRole("link", { name: "Open Import in your shop" }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/settings\/import$/);
  });
});

test.describe("as captain", () => {
  signedInAs("captain");

  test("import is refused for staff below owner/manager", async ({ page }) => {
    // A captain is staff everywhere else, but the importer writes the whole
    // roster, so the surface doesn't exist for them — bounced with the reason
    // said out loud, the same explained-landing rule every other gate refusal
    // follows. The landing is Today, not Settings: Settings takes the same
    // owner/manager gate now, so landing there would bounce them again and
    // lose the reason. FlashParams strips the query, so assert the banner text
    // rather than the URL param.
    await page.goto("/shop/blue-mantis/settings/import");
    await expect(page).toHaveURL(/\/shop\/blue-mantis(\?.*)?$/);
    await expect(
      page.getByText(
        "Importing writes divers' personal and medical records, so it's limited to owners and managers.",
      ),
    ).toBeVisible();
    await expect(page.locator('input[type="file"]').filter({ visible: true })).toHaveCount(0);
  });
});
