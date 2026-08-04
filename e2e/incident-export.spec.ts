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

  // The tamper-evidence code: a full SHA-256 in the footer.
  await expect(page.getByText("Integrity code (SHA-256)")).toBeVisible();
  await expect(page.getByText(/^[0-9a-f]{64}$/)).toBeVisible();
});

test("a trip id that is not this shop's is a 404, not a document", async ({ page }) => {
  const response = await page.goto(
    "/shop/blue-mantis/trips/00000000-0000-0000-0000-0000000000ff/incident-export",
  );
  expect(response?.status()).toBe(404);
});
