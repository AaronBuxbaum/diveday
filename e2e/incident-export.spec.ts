import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard, openTripTab } from "./helpers";

signedInAsOwner();

/**
 * Incident-ready export: one tap on the departure's manifest produces the
 * print-ready document of recorded facts — roster with boarding state, the
 * roll-call timeline, certification evidence, waiver *status*, and the
 * integrity code in the footer. Safety-critical surface, so the flow is
 * exercised end to end: record a real roll-call fact first, then check it
 * appears on the document with its attribution.
 */
test("one tap from the manifest opens the incident-ready document with the recorded facts", async ({
  page,
}) => {
  // Board → trip → manifest, one roll-call write, then the export page —
  // several full server round trips over a 9-diver manifest.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await page.getByRole("link", { name: "Open offline roll call" }).waitFor();

  // Put one recorded fact on the departure so the document carries a real
  // timeline entry (the per-test DB reset contains the write).
  const markBoarded = page
    .locator("#roll-call-list")
    .getByRole("button", { name: "Mark boarded" })
    .first();
  await markBoarded.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await markBoarded.click();
  await expect(
    page.locator("#roll-call-list").getByRole("button", { name: "Boarded ☑️" }).first(),
  ).toBeVisible();

  // The one-tap entry point.
  await page.getByRole("link", { name: "Incident-ready export" }).click();
  await page.waitForURL(/\/incident-export$/);

  // The document header states what this is — and what it is not.
  await expect(page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ })).toBeVisible();
  await expect(
    page.getByText("This document reports recorded facts with their timestamps."),
  ).toBeVisible();

  // The roll-call write just recorded is on the timeline, attributed.
  await expect(page.getByRole("heading", { name: "Roll-call timeline" })).toBeVisible();
  await expect(page.getByText("Recorded by Dana Reyes").first()).toBeVisible();

  // Waiver status renders as status; a diver with none gets a stated absence
  // (Priya is the reef trip's unsigned straggler), never a blank row.
  await expect(
    page.getByRole("heading", { name: "Certification evidence and waiver status" }),
  ).toBeVisible();
  await expect(page.getByText("No current signed waiver on record.").first()).toBeVisible();

  // Who dived with whom is on the document — the pairing staff recorded, not a
  // derived verdict about it. Tom Okafor and Lena Fischer are the seeded reef
  // pair (src/db/seed-buddy-pairs.ts), so each names the other.
  const roster = page.getByRole("table").first();
  await expect(roster.getByRole("columnheader", { name: "Buddy team" })).toBeVisible();
  // Anchored on the numbered Diver cell, not on row text: now that a pairing
  // prints its members' names, "Tom Okafor" appears in *two* rows — his own and
  // Lena's Buddy cell — so a row-level text filter is a strict-mode violation
  // by construction. That two rows name each other is the feature, not a flake.
  const rowFor = (diverCell: string) =>
    roster
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: diverCell, exact: true }) });
  await expect(rowFor("02 Tom Okafor")).toContainText("Lena Fischer");
  await expect(rowFor("03 Lena Fischer")).toContainText("Tom Okafor");
  // Every member of a team carries the same number, so a reader scanning a
  // printed roster finds them without chasing names across a page break.
  await expect(rowFor("02 Tom Okafor")).toContainText("Team 01");
  await expect(rowFor("03 Lena Fischer")).toContainText("Team 01");
  // And the pairing states who made the call — it is never anonymous.
  await expect(rowFor("02 Tom Okafor")).toContainText(/Recorded by \w/);
  // Priya is deliberately unteamed: that is a normal boat, and the document
  // says so in words rather than leaving the cell blank.
  await expect(rowFor("01 Priya Sharma")).toContainText("No buddy team recorded");
  // The seeded trio is a divemaster leading two divers — the case the old
  // two-body model could not record at all, and the reason "accompanied" and
  // "unaccompanied" used to print identically on this page. The crew member is
  // marked as crew, and the crew table names the teams she led.
  await expect(rowFor("04 Diego Alvarez")).toContainText("June Park");
  await expect(rowFor("04 Diego Alvarez")).toContainText("Keiko Tanaka (crew)");
  const crewTable = page.getByRole("table").nth(1);
  await expect(crewTable.getByRole("columnheader", { name: "Buddy teams" })).toBeVisible();
  await expect(
    crewTable.getByRole("row").filter({ hasText: "Keiko Tanaka" }).first(),
  ).toContainText("Team 02");

  // The pairing trail in the timeline — the one fact on this document that used
  // to have no audit entry at all, so a pairing could be rewritten or erased
  // after an incident with no mark.
  const timeline = page.locator("section", {
    has: page.getByRole("heading", { name: "Roll-call timeline" }),
  });
  await expect(timeline.getByText("Buddy team formed").first()).toBeVisible();
  await expect(timeline.getByText(/Members at that moment: .*Tom Okafor/).first()).toBeVisible();

  // The tamper-evidence code: a full SHA-256 in the footer.
  await expect(page.getByText("Integrity code (SHA-256)")).toBeVisible();
  await expect(page.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
});

test("a trip id that is not this shop's renders the not-found refusal, never a document", async ({
  page,
}) => {
  // The rendered refusal, not the HTTP status: this page streams (`instant =
  // true` + a segment `loading.tsx`), so the 200 and the shell are already on
  // the wire before the tenancy check's `notFound()` resolves — the same
  // documented limitation as e2e/tenant-isolation.spec.ts's staff-path sweep
  // and e2e/marketing.spec.ts's cold-slug 404. What a regression here would
  // change is what the person actually gets: the not-found backstop must
  // render, and not one fact of the document may accompany it.
  await page.goto("/shop/blue-mantis/trips/00000000-0000-0000-0000-0000000000ff/incident-export");
  await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
  // Zero document content: no kicker/entry label, no section headings, no
  // integrity code — nothing an authority-facing document is made of.
  await expect(page.getByText("Incident-ready export")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Roll-call timeline" })).toHaveCount(0);
  await expect(page.getByText("Integrity code (SHA-256)")).toHaveCount(0);
  await expect(page.getByText(/^[0-9a-f]{64}$/)).toHaveCount(0);
});

/**
 * Owner-only (`canExportIncidentRecord`, src/lib/authz.ts). The manifest stays
 * open to the whole crew — they run the roll call — but producing the shop's
 * evidentiary account of a departure, stamped with the generator's own name, is
 * the owner's call. The link is hidden and the route refuses; hiding alone is
 * not a control.
 */
test.describe("the export is the owner's to produce", () => {
  signedInAs("instructor");

  test("an instructor gets neither the link nor the document", async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
    await openTripTab(page, "Manifest");
    await page.getByRole("link", { name: "Open offline roll call" }).waitFor();

    // The manifest is theirs to run; this one door is not on it.
    await expect(page.getByRole("link", { name: "Incident-ready export" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Print / save PDF" })).toBeVisible();

    // And the route itself refuses, however it was reached — a bookmark, a
    // deep link, or a role that changed under them. It lands back on the
    // manifest saying why, never silently.
    const tripUrl = new URL(page.url());
    await page.goto(`${tripUrl.pathname.replace(/\/manifest$/, "")}/incident-export`);
    await page.waitForURL(/\/manifest\?notice=incident_export_not_authorized$/);
    await expect(page.getByText("only an owner can produce one")).toBeVisible();
    // Not one fact of the document travels with the refusal.
    await expect(page.getByRole("heading", { name: "Roll-call timeline" })).toHaveCount(0);
    await expect(page.getByText("Integrity code (SHA-256)")).toHaveCount(0);
  });
});
