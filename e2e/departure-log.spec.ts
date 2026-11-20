import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import {
  offlineCopySaved,
  openDeckPerson,
  openIfClosed,
  openTripFromBoard,
  openTripTab,
} from "./helpers";

signedInAsOwner();

/**
 * The departure log: one tap from a departure's own station produces the print-ready
 * document of recorded facts — roster with boarding state, the roll-call
 * timeline, certification evidence, waiver *status*, and the integrity code in
 * the footer. Safety-critical surface, so the flow is exercised end to end:
 * record a real roll-call fact first, then check it appears on the document
 * with its attribution.
 *
 * The door lives under Wrapped up's More (ADR 20261117-trip-page-clock): an
 * authority-facing document standing beside "Mark boarded" put it on the
 * surface a crew works at the rail. It is reachable on every departure, live or
 * back, by opening Wrapped up, and the settled
 * station on the shop home once the boat is back (ADR
 * 20260804-incident-export-owner-gate, amendment 2026-10-07). The live Today
 * card is the day's briefing and no longer carries it.
 */
test("Wrapped up opens the log with the recorded facts", async ({ page }) => {
  // Board → trip → manifest, one roll-call write, the home, then the log —
  // several full server round trips over a 9-diver manifest.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await offlineCopySaved(page);
  const tripPath = new URL(page.url()).pathname.replace(/\/manifest$/, "");

  // Put one recorded fact on the departure so the document carries a real
  // timeline entry (the per-test DB reset contains the write).
  await openDeckPerson(page, "Tom Okafor");
  await page.getByRole("button", { name: "Record Tom Okafor aboard", exact: true }).click();
  await expect(page.locator('[data-deck-screen="receipt"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tom Okafor", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Aboard recorded" })).toBeVisible();

  // The manifest keeps the printer and nothing else — this door moved.
  await expect(page.getByRole("link", { name: "Departure log" })).toHaveCount(0);

  // **A live departure, not only one that is back.** The seeded demo day is
  // mid-morning, so the reef trip is still live; an owner whose boat is
  // overdue needs the record of who is on it, and Record is where it is.
  // Wrapped up keeps the trip's links under its closed More.
  await page.goto(`${tripPath}?phase=wrapped`);
  await openIfClosed(page.locator("details#wrapped-more"));
  await page.getByRole("link", { name: "Departure log" }).click();
  await page.waitForURL(/\/log$/);

  // On a phone each row stacks into labelled lines, so the table fits the screen with nothing
  // clipped or scrolled sideways; the sheet keeps the full table.
  await page.setViewportSize({ width: 390, height: 844 });
  const rosterTable = page.getByRole("table").first();
  expect(
    await rosterTable.evaluate((table) => table.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });

  // The document header states what this is — and what it is not.
  await expect(page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ })).toBeVisible();
  await expect(
    // One preamble paragraph now (B52), the disclaimer inside it.
    page.getByText(/It reports recorded facts with their timestamps and does not assess/),
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
  // pair (src/db/seed-buddy-teams.ts), so each names the other.
  const roster = page.getByRole("table").first();
  await expect(roster.getByRole("columnheader", { name: "Buddy team" })).toBeVisible();
  // Anchored on the numbered Diver cell, not row text: a pairing prints both
  // names, so "Tom Okafor" appears in two rows and a row-level text filter
  // would be a strict-mode violation by construction.
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
  // The seeded trio is a divemaster leading two divers. The crew member is
  // marked as crew, and the crew table names the teams she led.
  await expect(rowFor("04 Diego Alvarez")).toContainText("June Park");
  await expect(rowFor("04 Diego Alvarez")).toContainText("Keiko Tanaka (crew)");
  const crewTable = page.getByRole("table").nth(1);
  await expect(crewTable.getByRole("columnheader", { name: "Buddy teams" })).toBeVisible();
  await expect(
    crewTable.getByRole("row").filter({ hasText: "Keiko Tanaka" }).first(),
  ).toContainText("Team 02");

  // The pairing trail in the timeline: a pairing cannot be rewritten or erased
  // after an incident without a mark.
  const timeline = page.locator("section", {
    has: page.getByRole("heading", { name: "Roll-call timeline" }),
  });
  await expect(timeline.getByText("Buddy team formed").first()).toBeVisible();
  await expect(timeline.getByText(/Members at that moment: .*Tom Okafor/).first()).toBeVisible();

  // The shop's own pre-departure checklist (ADR 20260824-pre-departure-safety-check):
  // seeded (src/db/seed-pre-departure-checklist.ts) but never tapped on this
  // departure, so every line states its absence rather than rendering blank.
  await expect(page.getByRole("heading", { name: "Pre-departure check" })).toBeVisible();
  const checklistTable = page.getByRole("table").filter({ hasText: "VHF radio checked" });
  await expect(
    checklistTable.getByRole("row").filter({ hasText: "VHF radio checked" }),
  ).toContainText("Not checked");

  // The departure's incident reports end the document, and none is stated, not left blank.
  await expect(page.getByRole("heading", { name: "Incident reports" })).toBeVisible();
  await expect(page.getByText(/^No incident report has been started/)).toBeVisible();

  // The tamper-evidence code: a full SHA-256 in the footer, with its recipe's version.
  await expect(page.getByText("Integrity code (SHA-256) · version 4")).toBeVisible();
  await expect(page.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
  const screenPrintNotice = page.locator("[data-paper-print-only] .paper-sheet");
  await expect(
    page.locator(".paper-sheet-frame:not([data-paper-print-only]) .paper-sheet"),
  ).toHaveCount(0);
  await expect(screenPrintNotice).toHaveCount(1);
  await expect(screenPrintNotice).toBeHidden();
  const keikoPhoto = crewTable.getByRole("row").filter({ hasText: "Keiko Tanaka" }).locator("img");
  await expect(keikoPhoto).toBeVisible();
  await expect(keikoPhoto).toHaveAttribute("src", /keiko-tanaka\.webp/);
  await page.emulateMedia({ media: "print" });
  await expect(screenPrintNotice).toBeVisible();
  await expect(page.locator("[data-departure-log]")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("link", { name: "Print", exact: true }).click();
  await page.waitForURL(/\/log\/print$/);
  await expect(
    page.locator(".paper-sheet-frame:not([data-paper-print-only]) .paper-sheet"),
  ).toHaveCount(1);
  await expect(
    page.locator(
      '.paper-sheet-frame:not([data-paper-print-only]) section[aria-labelledby="incident-crew-heading"] img',
    ),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Roll-call timeline" })).toBeVisible();
});

test("a trip id that is not this shop's renders the not-found refusal, never a document", async ({
  page,
}) => {
  // The rendered refusal, not the HTTP status: this page streams (`instant =
  // true` + a segment `loading.tsx`), so the 200 and shell are on the wire
  // before the tenancy check's `notFound()` resolves (as in
  // e2e/tenant-isolation.spec.ts). The not-found backstop must render, and
  // not one fact of the document may accompany it.
  await page.goto("/shop/blue-mantis/trips/00000000-0000-0000-0000-0000000000ff/log");
  await expect(page.getByRole("heading", { name: "We couldn’t find that page" })).toBeVisible();
  // Zero document content: no kicker/entry label, no section headings, no
  // integrity code — nothing an authority-facing document is made of.
  await expect(page.getByText("Departure log")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Roll-call timeline" })).toHaveCount(0);
  await expect(page.getByText("Integrity code (SHA-256)")).toHaveCount(0);
  await expect(page.getByText(/^[0-9a-f]{64}$/)).toHaveCount(0);
});

/**
 * Owner-only (`canExportIncidentRecord`, src/lib/authz.ts). The home and the
 * manifest both stay open to the whole crew — they run the roll call and they
 * close the day — but producing the shop's evidentiary account of a departure,
 * stamped with the generator's own name, is the owner's call. The link is
 * hidden and the route refuses; hiding alone is not a control.
 */
test.describe("the log is the owner's to produce", () => {
  signedInAs("instructor");

  test("an instructor gets neither the link nor the document", async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
    await openTripTab(page, "Manifest");
    await offlineCopySaved(page);
    const tripUrl = new URL(page.url());

    // Wrapped up's More is theirs to read; this one door is not in it.
    await page.goto(`${tripUrl.pathname.replace(/\/manifest$/, "")}?phase=wrapped`);
    await openIfClosed(page.locator("details#wrapped-more"));
    await expect(page.getByRole("link", { name: "View public page" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Departure log" })).toHaveCount(0);

    // And the route itself refuses, however it was reached — a bookmark, a
    // deep link, or a role that changed under them. It lands back on the home
    // saying why, never silently.
    await page.goto(`${tripUrl.pathname.replace(/\/manifest$/, "")}/log`);
    // Matched without the `?notice=`, deliberately: `FlashParams` strips it on
    // hydration, so whether the URL assertion sees it is a race. What is durable
    // is the destination and the banner; the line below asserts the notice
    // arrived, reading what a staffer reads.
    await page.waitForURL(/\/shop\/blue-mantis(\?|$)/);
    await expect(page.getByText(/[Oo]nly an owner can generate/)).toBeVisible();
    // Not one fact of the document travels with the refusal.
    await expect(page.getByRole("heading", { name: "Roll-call timeline" })).toHaveCount(0);
    await expect(page.getByText("Integrity code (SHA-256)")).toHaveCount(0);
  });
});
