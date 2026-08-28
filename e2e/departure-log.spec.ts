import { expect, signedInAs, signedInAsOwner, test } from "./fixtures";
import { offlineCopySaved, openTripFromBoard, openTripTab } from "./helpers";

signedInAsOwner();

/**
 * The departure log: one tap from a departure's own station produces the print-ready
 * document of recorded facts — roster with boarding state, the roll-call
 * timeline, certification evidence, waiver *status*, and the integrity code in
 * the footer. Safety-critical surface, so the flow is exercised end to end:
 * record a real roll-call fact first, then check it appears on the document
 * with its attribution.
 *
 * The door is the evening, not the manifest. Writing the day up is an evening
 * act, and an authority-facing document standing beside "Mark boarded" put it
 * on the surface a crew works at the rail. Since H-62 that evening is a state
 * of the shop home rather than a page of its own (ADR
 * 20260827-clearwater-surface-language, decision 4), so the door moved with
 * it — same one link per departure, on the departure's own station, whether
 * that departure is still ahead of the day or already settled.
 */
test("one tap from a departure's station opens the log with the recorded facts", async ({
  page,
}) => {
  // Board → trip → manifest, one roll-call write, the home, then the log —
  // several full server round trips over a 9-diver manifest.
  test.setTimeout(45_000);
  await page.goto("/shop/blue-mantis/schedule/board");
  await openTripFromBoard(page, "Two-Tank Reef — Molasses & French");
  await openTripTab(page, "Manifest");
  await offlineCopySaved(page);

  // Put one recorded fact on the departure so the document carries a real
  // timeline entry (the per-test DB reset contains the write).
  const markBoarded = page
    .locator("#roll-call-list")
    .getByRole("button", { name: "Mark boarded" })
    .first();
  await markBoarded.evaluate((button) => button.scrollIntoView({ block: "center" }));
  await markBoarded.click();
  // The settled control's accessible name is its undo-bearing aria-label
  // (PR #607 review), which replaces "Boarded ☑️" rather than extending it.
  await expect(
    page
      .locator("#roll-call-list")
      .getByRole("button", { name: "Boarded — tap again to undo" })
      .first(),
  ).toBeVisible();

  // The manifest keeps the printer and nothing else — this door moved.
  await expect(page.getByRole("link", { name: "Generate log" })).toHaveCount(0);

  // **Every departure row, not only the ones that are back** — the ADR's
  // amendment says so in as many words. The seeded demo day is deliberately
  // mid-morning, so the reef trip is a *live* station rather than a settled
  // one, and that is the case worth pinning: an owner whose boat is overdue
  // needs the record of who is on it, and for a while after 6d moved this door
  // onto the evening that was the one state where it did not exist.
  await page.goto("/shop/blue-mantis");
  const reefRow = page.locator("li", {
    has: page.getByText("Two-Tank Reef — Molasses & French"),
  });
  await reefRow.getByRole("link", { name: "Generate log" }).first().click();
  await page.waitForURL(/\/log$/);

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

  // The shop's own pre-departure checklist (ADR 20260824-pre-departure-safety-check):
  // seeded (src/db/seed-pre-departure-checklist.ts) but never tapped on this
  // departure, so every line states its absence rather than rendering blank.
  await expect(page.getByRole("heading", { name: "Pre-departure check" })).toBeVisible();
  const checklistTable = page.getByRole("table").filter({ hasText: "VHF radio checked" });
  await expect(
    checklistTable.getByRole("row").filter({ hasText: "VHF radio checked" }),
  ).toContainText("Not checked");

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

    // The evening is theirs to run; this one door is not on any of its
    // stations.
    await page.goto("/shop/blue-mantis");
    await expect(
      page.getByRole("heading", { name: /Good (morning|afternoon|evening|night)/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Generate log" })).toHaveCount(0);

    // And the route itself refuses, however it was reached — a bookmark, a
    // deep link, or a role that changed under them. It lands back on the home
    // saying why, never silently.
    await page.goto(`${tripUrl.pathname.replace(/\/manifest$/, "")}/log`);
    // Matched without the `?notice=`, deliberately. The refusal redirects with
    // one, but `FlashParams` strips it in a `useEffect` the moment the page
    // hydrates — that is the whole point of a flash param. `page.goto` resolves
    // on `load`, so whether this sees the URL before or after that strip is a
    // race with hydration, and on a CI runner it loses: the log records
    // "navigated to /shop/blue-mantis" and then waits 45s for a query string
    // the app has already, correctly, erased.
    //
    // What is durable is the destination and the banner. The line below is the
    // assertion that the notice arrived at all, and it reads what a staffer
    // reads rather than what the address bar held for one frame.
    await page.waitForURL(/\/shop\/blue-mantis(\?|$)/);
    await expect(page.getByText(/[Oo]nly an owner can generate/)).toBeVisible();
    // Not one fact of the document travels with the refusal.
    await expect(page.getByRole("heading", { name: "Roll-call timeline" })).toHaveCount(0);
    await expect(page.getByText("Integrity code (SHA-256)")).toHaveCount(0);
  });
});
