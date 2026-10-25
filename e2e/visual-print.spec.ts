/**
 * Visual captures: the printed documents.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed-identifiers";
import { DEMO_MEDICAL_ALERT, DEMO_MEDICAL_ALERT_TRIP } from "../src/db/seed-medical-alert";
import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripFromBoard } from "./helpers";
import {
  capturePrint,
  installVisualBuildGuard,
  openDisputeSheet,
  openReefTrip,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

/**
 * Print / Save-as-PDF surfaces. The complete trip packet, manifest, prep list,
 * and departure log are the documents staff physically print for the dock, and print gets a dedicated
 * rendering (globals.css `@media print`): monochrome, so a shop's black-and-
 * white printer isn't asked for muddy color, and padded, so content doesn't
 * slam into the paper edge. The interactive baselines above never exercise
 * that path. This block lives outside the light/dark loop on purpose — print
 * is scheme-independent — and runs at a US-Letter-ish width so the baseline
 * reflects paper rather than a 1280px browser window.
 *
 * One test per printed surface, same rule as the rest of the file: the manifest
 * failing to render must not cost the prep list its baseline.
 */
test.describe("print", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 816, height: 1056 } });

  // Reach the seeded reef trip the way staff do, then print its dock surfaces.
  // Navigating by link keeps these off any hard-coded trip id.
  test("the dock manifest prints monochrome and padded", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/manifest`);
    await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
    await capturePrint(page, "manifest");
  });

  test("the dock prep list prints monochrome and padded", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/prep`);
    await page.getByRole("heading", { name: "Tanks" }).waitFor();
    await capturePrint(page, "prep");
  });

  // **Not "every staff tab" any more, and that is the point.** The packet used
  // to compose all four, which is how 42 buttons — "Cancel trip" among them —
  // came to be printed beside a roster (issue #814). It composes the dive plan
  // it renders itself, plus the two tabs that were already documents.
  test("the trip packet prints the dive plan, the manifest and the prep list", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/print`);
    await page.getByRole("heading", { name: "Trip packet" }).waitFor();
    await page.emulateMedia({ media: "print" });
    // **Three composed headers, and none of their chrome on paper.** This used
    // to count the two tab strips the composed surfaces brought with them;
    // slice 23c deleted the strip (ADR 20260919-one-idea), and what each
    // header carries now is its way back up — "Schedule" on the packet's own,
    // "Trip" on the manifest's and the prep list's. `TripPageHeader` marks all
    // three `print:hidden` for exactly this reason, and a paper sheet with a
    // link on it is the regression.
    // **The packet's chrome stays off paper.** This used to count the two tab
    // strips the composed surfaces brought with them; slice 23c deleted the
    // strip (ADR 20260919-one-idea), and the packet now composes paper rows
    // with no controls (visual review 2026-10-24, B03), so the rental-ticket
    // door and the composed headers' way back up are gone. What is left is
    // the packet's own "‹ Schedule", and the rule is the assertion: every link
    // in the packet that is not a person's name is off paper. A name prints:
    // it is a fact on the sheet (the prep lists' divers), a link on screen
    // only.
    //
    // A CSS locator, deliberately: `getByRole` reads the accessibility tree,
    // `display:none` is not in it, and a role locator here finds nothing and
    // passes for the wrong reason.
    const chrome = page.locator('.trip-print-bundle a:not([href*="/divers/"])');
    await expect(chrome).not.toHaveCount(0);
    for (const link of await chrome.all()) await expect(link).not.toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await capturePrint(page, "trip-packet");
  });

  // **The packet with the medical alerts' words** (issue #2990): each alert
  // under its diver's row, the note once above them. The owner prints it; the
  // seeded alert is on tomorrow's crewed departure.
  test("the trip packet prints with the medical alerts", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, DEMO_MEDICAL_ALERT_TRIP);
    const tripPath = new URL(page.url()).pathname.replace(/\/(manifest|prep)$/, "");
    await page.goto(`${tripPath}/print/medical-alerts`);
    await page.getByRole("heading", { name: "Trip packet" }).waitFor();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByText(DEMO_MEDICAL_ALERT)).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await capturePrint(page, "trip-packet-medical-alerts");
  });

  // **The whole day on paper** (N-54). The same three sections the trip packet
  // prints, once per departure of the shop's own calendar day, so a dead tablet
  // at 5 am costs a printer rather than the day. Captured because a document
  // built by repeating a block is exactly where the rhythm between blocks goes
  // wrong, and no assertion can see that.
  test("the day packet prints every departure of today", async ({ page }) => {
    await page.goto("/shop/blue-mantis/print");
    await page.getByRole("heading", { level: 1, name: "Day packet" }).waitFor();
    await capturePrint(page, "day-packet");
  });

  // The dispute sheet is handed to a card network, so paper is its artifact.
  test("the dispute sheet prints monochrome and padded", async ({ page }) => {
    await openDisputeSheet(page);
    await capturePrint(page, "order-dispute-sheet");
  });

  // The departure log exists to be printed and handed over, so the print
  // rendering is the primary artifact, not a nice-to-have.
  test("the departure log prints monochrome and padded", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/log`);
    await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
    await capturePrint(page, "departure-log");
  });

  // **A signed waiver on paper** (plan `rental-tracking`, layer 2): the
  // shop's name where the screen's way back stood, whose release it is, the
  // signed time with its zone, the seal, and the text the diver signed. Rowan
  // Pike's, like the screen capture, because it has the most to say.
  test("a signed waiver prints as a document", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, "Afternoon Two-Tank — French Reef");
    const row = page
      .locator("li")
      .filter({ has: page.getByText("Rowan Pike", { exact: true }) })
      .filter({ visible: true });
    await row.getByRole("link", { name: "View signed record" }).click();
    await page.getByRole("heading", { level: 1, name: "Signed waiver" }).waitFor();
    await page.getByRole("heading", { name: "What they signed" }).waitFor();
    await capturePrint(page, "signed-waiver");
  });

  // **The shop's own paper** (ADR 20260908-one-hand, decision 6, lever X). The
  // pass exists only to come out of a printer, so the print rendering *is* the
  // artifact: a fixed box in millimetres, a band in the shop's colour, and a
  // fold line carrying the day it was printed.
  //
  // **The pinned booking, not the counter's first row.** The pass renders a QR
  // of `passCodePayload` — the booking's id and nothing else — and
  // `bookings.id` is `defaultRandom()`, so a capture that reads whichever id
  // the queue happens to hold photographs a different QR on every seed. It
  // reported as changed on the first pull request after it landed, with the
  // diff confined to the code block and no geometry moved. `DEMO_RECAP_BOOKING_ID`
  // exists for exactly this: the canonical demo pins its first reef booking so
  // a visual test can address it deterministically.
  test("the paper pass prints A6 with the booking's own code", async ({ page }) => {
    await page.goto(`/shop/blue-mantis/print/pass/${DEMO_RECAP_BOOKING_ID}`);
    await page.getByText("Show this at the counter, or say your name.").waitFor();
    await capturePrint(page, "paper-pass");
  });

  // **The counter card on paper** — the sign a shop stands on its desk. Its
  // code is the shop's public register address, the same on every seed, so
  // the capture is deterministic without a pinned id.
  test("the counter card prints A6 with the register code", async ({ page }) => {
    await page.goto("/shop/blue-mantis/print/counter-card");
    await page.getByRole("heading", { name: "New here? Scan this" }).waitFor();
    await capturePrint(page, "paper-counter-card");
  });
});
