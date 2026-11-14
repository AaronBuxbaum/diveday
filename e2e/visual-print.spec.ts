/**
 * Visual captures: the printed documents.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */

import { DEMO_RECAP_BOOKING_ID, DEMO_TODAY_TRIP_ID } from "../src/db/seed-identifiers";
import { DEMO_MEDICAL_ALERT, DEMO_MEDICAL_ALERT_TRIP } from "../src/db/seed-medical-alert";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { MAP_REACHABILITY_PROBES } from "../src/lib/maps";
import { assertCrewPdfPixels } from "./crew-pdf-pixels";
import { expect, signedInAsOwner, test } from "./fixtures";
import { bookASeatAndOpenThread, openTripFromBoard, seededTripId } from "./helpers";
import {
  assertPacketAttributionBelowKit,
  assertWaiverAttributionBelowAcknowledgement,
} from "./print-attribution";
import { capturePrintPdfs, staticPrintPage } from "./print-pdf";
import { seedFacts } from "./shop-facts";
import {
  capturePrint,
  installVisualBuildGuard,
  openDisputeSheet,
  openReefTrip,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

const staff = staffTranslator("en-US");

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

/**
 * Print / Save-as-PDF documents. Every one is a run of sheets (issue #2745):
 * the trip packet, the Boat tab's manifest, the departure log, the day packet
 * and the public pages' sheets. A screen never prints, so nothing here
 * photographs one (`capturePrint` refuses a page with no sheet). This block
 * lives outside the light/dark loop on purpose — print is scheme-independent
 * — and runs at a US-Letter-ish width so the baseline reflects paper rather
 * than a 1280px browser window.
 *
 * One test per printed surface, same rule as the rest of the file: the manifest
 * failing to render must not cost the prep list its baseline.
 */
test.describe("print", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 816, height: 1056 } });

  test("the diver's day prints as its sheet, with the address and no map", async ({ page }) => {
    for (const probe of MAP_REACHABILITY_PROBES) {
      await page.route(probe, (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
        }),
      );
    }
    await openReefTrip(page);
    const publicPath = new URL(page.url()).pathname.replace("/shop/", "/s/");
    await page.goto(publicPath);
    await bookASeatAndOpenThread(page, "Print Map Diver", "print-map@example.com");
    const map = page.getByRole("region", { name: /^Map of / });
    await expect(map).toBeVisible();
    const address = page.locator("address").first();
    await expect(address).not.toBeEmpty();
    const cancel = page.getByRole("button", { name: "Cancel my seat", exact: true });
    await expect(cancel).toBeVisible();
    const late = page.getByRole("button", { name: "Running late", exact: true });
    await expect(late).toBeVisible();
    const addressText = await address.innerText();
    await page.emulateMedia({ media: "print" });
    // On paper the thread is its day sheet alone (#2745): no map, no control.
    await expect(map).not.toBeVisible();
    await expect(cancel).not.toBeVisible();
    await expect(late).not.toBeVisible();
    // The trip page this flow booked on can stay mounted, hidden, beside the
    // thread (cacheComponents): the day sheet is the one that says where to go.
    const sheet = page.locator(".paper-sheet", {
      hasText: diverTranslator("en-US")("trip.arrivalHeading"),
    });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(addressText);
    await page.emulateMedia({ media: "screen" });
    await expect(sheet).not.toBeVisible();
    await capturePrint(page, "ready-arrival-address");
  });

  // **The crew week is a sheet** (issue #2745): the Crew screen's Print door
  // opens the week's rota, the paper on the noticeboard, and the screen itself
  // is never printed.
  test("the crew week prints as a noticeboard rota", async ({ page }) => {
    await page.goto("/shop/blue-mantis/staffing");
    await page.getByRole("heading", { level: 1, name: "Schedule" }).waitFor();
    const range = await page
      .locator("section")
      .filter({ has: page.locator("[data-week-step]") })
      .locator("p.tabular-nums")
      .first()
      .innerText();
    await page.getByRole("link", { name: "Print", exact: true }).click();
    await page.waitForURL(/\/staffing\/print\?week=/);
    const sheet = page.locator(".paper-sheet");
    await expect(sheet).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: range })).toBeVisible();
    const context = sheet.locator("[data-crew-print-context]");
    await expect(context.getByText("Blue Mantis Divers", { exact: true })).toBeVisible();
    await expect(context).toContainText(range);
    await expect(sheet.locator("thead tr > th")).toHaveCount(8);
    await expect(sheet.locator("button, select, textarea, input, a")).toHaveCount(0);
    await capturePrint(page, "crew-week");
  });

  test("every sheet of an expanded crew rota renders context and warning ink", async ({
    page,
    request,
  }, testInfo) => {
    await seedFacts(request, ["troublePanels", "crewGap"]);
    await page.goto("/shop/blue-mantis/staffing/print");
    const sheet = page.locator(".paper-sheet");
    await sheet.locator("[data-crew-print-context]").waitFor();
    await page.emulateMedia({ media: "print" });
    const labels = await sheet.locator("[data-crew-print-context] > span").allTextContents();
    await expect(sheet.locator("tbody")).toContainText("Needs crew");
    await expect(sheet.locator("tbody")).toContainText("No divemaster");
    const original = testInfo.outputPath("crew-original.pdf");
    await page.pdf({
      path: original,
      format: "Letter",
      preferCSSPageSize: true,
      printBackground: true,
    });
    await assertCrewPdfPixels(original, labels, testInfo.outputPath("crew-original-pages"));
    // Stress only a script-free copy; React keeps ownership of the source page.
    const paper = await staticPrintPage(page);
    await paper.locator(".paper-sheet tbody").evaluate((body) => {
      const rows = [...body.children];
      for (let copy = 0; copy < 2; copy++) {
        for (const row of rows) body.append(row.cloneNode(true));
      }
    });
    const pdf = testInfo.outputPath("crew-multipage.pdf");
    await paper.pdf({
      path: pdf,
      format: "Letter",
      preferCSSPageSize: true,
      printBackground: true,
    });
    await paper.close();
    await assertCrewPdfPixels(pdf, labels, testInfo.outputPath("crew-rendered-pages"));
    await testInfo.attach("crew-multipage", { path: pdf, contentType: "application/pdf" });
  });

  // The public trip and its embed print one departure sheet, never the
  // screen (#2745); `capturePrint` audits it for ink.
  for (const [name, path] of [
    ["public-trip-sheet", "trips"],
    ["public-trip-embed-sheet", "embed/trip"],
  ] as const) {
    test(`${name} prints as the departure's sheet`, async ({ page }) => {
      const id = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
      expect(id).toBe(DEMO_TODAY_TRIP_ID);
      await page.goto(`/s/blue-mantis/${path}/${id}`);
      await page.getByRole("heading", { level: 1 }).first().waitFor();
      const sheet = page.locator(".paper-sheet");
      await expect(sheet).not.toBeVisible();
      await page.emulateMedia({ media: "print" });
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(DEMO_TODAY_TRIP_ID);
      await expect(page.locator("#book")).not.toBeVisible();
      await page.emulateMedia({ media: "screen" });
      await capturePrint(page, name);
    });
  }

  // The course prints one sheet with every answer open, never its screen (#2745).
  test("a public course prints as its sheet, with every answer", async ({ page }) => {
    await page.goto("/s/blue-mantis/courses/discover-scuba-diving");
    await page.getByRole("heading", { level: 1, name: "Discover Scuba Diving" }).waitFor();
    const closed = page.locator("#faqs details").first();
    await expect(closed).not.toHaveAttribute("open");
    const answer = (await closed.locator("p").textContent())?.trim() ?? "";
    expect(answer).not.toBe("");
    const dateRequest = page.getByText(diverTranslator("en-US")("course.askAnotherDate"), {
      exact: true,
    });
    await expect(dateRequest).toBeVisible();
    const sheet = page.locator(".paper-sheet");
    await expect(sheet).not.toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(sheet).toBeVisible();
    await expect(dateRequest).not.toBeVisible();
    await expect(page.locator("main img").filter({ visible: true })).toHaveCount(0);
    await expect(sheet.getByRole("heading", { level: 1 })).toHaveText("Discover Scuba Diving");
    await expect(sheet).toContainText(answer);
    await expect(sheet).toContainText("100 Ocean Drive");
    await expect(sheet.locator("a, button, input, select, textarea, details")).toHaveCount(0);
    await page.emulateMedia({ media: "screen" });
    await capturePrint(page, "public-course-sheet");
  });

  // The schedule and its frame print the listed departures as one sheet (#2745).
  for (const [name, path] of [
    ["public-schedule-sheet", "/s/blue-mantis"],
    ["public-calendar-embed-sheet", "/s/blue-mantis/embed/calendar"],
  ] as const) {
    test(`${name} prints the listed departures with their zone`, async ({ page }) => {
      await page.goto(path);
      const firstRow = page.locator("#schedule ul h3").first();
      const title = (await firstRow.textContent())?.trim() ?? "";
      expect(title).not.toBe("");
      const sheet = page.locator(".paper-sheet");
      await expect(sheet).not.toBeVisible();
      await page.emulateMedia({ media: "print" });
      await expect(sheet).toBeVisible();
      await expect(page.locator("#schedule")).not.toBeVisible();
      await expect(sheet).toContainText(title);
      await expect(sheet).toContainText(/\d{4}/);
      await expect(sheet).toContainText(/E[DS]T/);
      await expect(sheet.locator("a, button, input, select, textarea")).toHaveCount(0);
      await page.emulateMedia({ media: "screen" });
      await capturePrint(page, name);
    });
  }

  // Reach the seeded reef trip the way staff do, then print its dock surfaces.
  // Navigating by link keeps these off any hard-coded trip id.
  test("the dock manifest prints as the Boat tab's sheet", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/manifest`);
    await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
    await capturePrint(page, "manifest");
  });

  // **Not "every staff tab" any more, and that is the point.** The packet used
  // to compose all four, which is how 42 buttons — "Cancel trip" among them —
  // came to be printed beside a roster (issue #814). It composes the dive plan
  // it renders itself, plus the two tabs that were already documents.
  test("the trip packet prints the dive plan, the manifest and the prep list", async ({
    page,
  }, info) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}?print=1`);
    await page.getByRole("heading", { name: "Trip packet" }).waitFor();
    await page.emulateMedia({ media: "print" });
    // **The packet's chrome stays off paper.** The packet is sheets (issue
    // #2745) whose only links are people's names (a fact on the sheet, a link
    // on screen only); the way back and the second Print sit above the
    // sheets and never print.
    //
    // A CSS locator, deliberately: `getByRole` reads the accessibility tree,
    // `display:none` is not in it, and a role locator here finds nothing and
    // passes for the wrong reason.
    await expect(
      page.locator('.paper-sheet-frame a:not([href*="/divers/"])').filter({ visible: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Divers" }).first()).not.toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await expect(page.locator(".paper-sheet-fold").first()).toContainText("Printed by");
    for (const pdf of await capturePrintPdfs(page, "trip-attribution", info.outputDir)) {
      assertPacketAttributionBelowKit(pdf);
      await info.attach("packet-attribution", { path: pdf, contentType: "application/pdf" });
    }
    await capturePrint(page, "trip-packet");
  });

  // **The packet with the medical alerts' words** (issue #2990): each alert
  // under its diver's row, the note once above them. The owner prints it; the
  // seeded alert is on tomorrow's crewed departure.
  test("the trip packet prints with the medical alerts", async ({ page }) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, DEMO_MEDICAL_ALERT_TRIP);
    const tripPath = new URL(page.url()).pathname.replace(/\/(manifest|prep)$/, "");
    await page.goto(`${tripPath}?print=medical-alerts`);
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

  // The dispute sheet is handed to a card network, so paper is its artifact:
  // one sheet of the shop's paper (issue #2745).
  test("the dispute sheet prints as a sheet of the shop's paper", async ({ page }) => {
    await openDisputeSheet(page);
    await capturePrint(page, "order-dispute-sheet");
  });

  // The departure log exists to be printed and handed over, so the print
  // rendering is the primary artifact, not a nice-to-have. It is a sheet of
  // the shop's paper (issue #2745), with no control on it.
  test("the departure log prints as a sheet", async ({ page }) => {
    await openReefTrip(page);
    const tripPath = new URL(page.url()).pathname;
    await page.goto(`${tripPath}/log/print`);
    await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
    const sheet = page.locator(".paper-sheet");
    await expect(sheet).toHaveCount(1);
    await expect(sheet.locator("button, select, textarea, input")).toHaveCount(0);
    await expect(sheet.getByText("Integrity code (SHA-256)", { exact: false })).toBeVisible();
    await capturePrint(page, "departure-log");
  });

  // **A signed waiver prints as its own sheet** (issue #4142): whose release
  // it is, when and how it was signed, the seal, the medical line and the text
  // the diver signed, with no control on it. Rowan Pike's, because hers has
  // the most to say (a physician's refusal above the text).
  test("a signed waiver prints as its sheet", async ({ page }, info) => {
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, "Afternoon Two-Tank — French Reef");
    const row = page
      .locator("li")
      .filter({ has: page.getByText("Rowan Pike", { exact: true }) })
      .filter({ visible: true });
    await row.getByRole("link", { name: "View signed record" }).click();
    await page.getByRole("heading", { level: 1, name: "Signed waiver" }).waitFor();
    await page.getByRole("link", { name: staff("waiversStaff.record.print"), exact: true }).click();
    await page.waitForURL(/\/waivers\/[^/]+\/print$/);
    const sheet = page.locator(".paper-sheet");
    await expect(sheet).toHaveCount(1);
    await expect(sheet.getByRole("heading", { level: 1 })).toHaveText(
      staff("waiversStaff.record.title"),
    );
    await expect(sheet).toContainText("Rowan Pike");
    await expect(sheet).toContainText(/E[DS]T/);
    await expect(
      sheet.getByRole("heading", { name: staff("waiversStaff.record.releaseHeading") }),
    ).toBeVisible();
    await expect(sheet.locator("a, button, input, select, textarea")).toHaveCount(0);
    await expect(sheet.locator(".paper-sheet-fold")).toContainText("Printed by");
    for (const pdf of await capturePrintPdfs(page, "waiver-attribution", info.outputDir)) {
      assertWaiverAttributionBelowAcknowledgement(pdf);
      await info.attach("waiver-attribution", { path: pdf, contentType: "application/pdf" });
    }
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
    const reefId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Molasses & French");
    await page.goto(`/shop/blue-mantis/trips/${reefId}?pass=${DEMO_RECAP_BOOKING_ID}`);
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
