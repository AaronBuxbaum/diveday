import { expect, signedInAsOwner, test } from "./fixtures";
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
    page.locator("#roll-call-list").getByRole("button", { name: "Boarded ✓" }).first(),
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
  // team (src/db/seed-buddy-pairs.ts), so each names the other.
  const roster = page.getByRole("table").first();
  await expect(roster.getByRole("columnheader", { name: "Buddy" })).toBeVisible();
  await expect(roster.getByRole("row", { name: /Tom Okafor/ })).toContainText("Lena Fischer");
  await expect(roster.getByRole("row", { name: /Lena Fischer/ })).toContainText("Tom Okafor");
  // Priya is deliberately unpaired: an unpaired diver is a normal boat, and the
  // document says so in words rather than leaving the cell blank.
  await expect(roster.getByRole("row", { name: /Priya/ })).toContainText("No buddy recorded");

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
