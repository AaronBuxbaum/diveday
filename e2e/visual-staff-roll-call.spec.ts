/**
 * Visual captures: the roster gate and the manifest at sea: roll call, buddy teams and roster refusals.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { AT_SEA_DAY_TITLE } from "../src/db/seed/identifiers";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  addFoundGuest,
  manifestRow,
  offlineCopySaved,
  openDeckDetails,
  openDeckPerson,
  openDiveLog,
  openManifestPerson,
  openRosterDetails,
  openRosterNotes,
  openTripAboutRow,
  openTripFromBoard,
  openTripPhase,
  openTripTab,
  rosterRow,
  seededTripId,
} from "./helpers";
import { seedFacts } from "./shop-facts";
import {
  ADVANCED_CHARTER,
  AOW_COURSE,
  capture,
  DEEP_CHARTER,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  liveRosterConfirmation,
  openReefTrip,
  openSailedTrip,
  SURFACE_TIMEOUT_MS,
  staffCopy,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test.describe("staff", () => {
      signedInAsOwner();

      // H-20260724-one-person-per-email: a Night-trip seat booked through a shared inbox under a name that
      // doesn't match the person on file shows the fail-closed "Confirm
      // identity" affordance and blocker until staff vouch for it — a
      // safety-critical state worth a baseline.
      test(`the roster identity gate renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, "Night Dive — City of Washington");
        await openTripTab(page, "Trip");
        // The held seat leads the list, and opened says why.
        await rosterRow(page, "June Park");
        await page
          .getByText("Booked as Hana Park, then matched to June Park from the name list.")
          .first()
          .waitFor();
        await capture(page, "trip-guests-identity", scheme);
      });

      /**
       * **The same seat with its reference panel open** (issue #1700).
       *
       * The capture above shoots every row collapsed, and the thing worth
       * watching is in the open half: the flag gates *disclosure* as well as
       * boarding, so while it stands the panel prints none of the matched
       * person's flagged medical prompts, date of birth, emergency contact or
       * sizes (only their email and phone stand out, to ask with), and one substitute line stands where they would be
       * (`RosterSection.tsx`'s `showsPersonDetail`). A later hand putting a
       * stranger's medical answers back on that row would move no pixels in the
       * collapsed frame at all.
       *
       * A second capture rather than an expand on the one above, because that
       * one is the baseline for the collapsed reading of this state and moving
       * it would trade one blind spot for another.
       *
       * `openRosterDetails` rather than a bare click: the disclosure is
       * uncontrolled native DOM state, so a click on an already-open row closes
       * it.
       */
      test(`the roster's held seat withholds its particulars (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, "Night Dive — City of Washington");
        await openTripTab(page, "Trip");
        const row = await rosterRow(page, "June Park");
        await row.getByText("Booked as Hana Park", { exact: false }).waitFor();
        await openRosterDetails(row);
        // The line that stands in for the withheld fields — waited on rather
        // than the panel, because the panel is open either way and it is this
        // sentence the baseline exists for.
        await expect(
          row.getByText(staffCopy("trips.roster.identityWithheldDetails"), { exact: true }),
        ).toBeVisible();
        // The record's own email and phone, which stay out to ask with
        // (Aaron, 2026-10-06).
        await expect(row.getByTestId("identity-contact")).toBeVisible();
        // And the control that clears it, in the frame beside them.
        await expect(row.getByRole("button", { name: "Same person as June Park" })).toBeVisible();
        await expect(row.getByText("Different person")).toBeVisible();
        await capture(page, "trip-guests-identity-open", scheme);
      });

      /**
       * DOM-H3. After a dive, the only control that isn't "Boarded" means
       * **did not return to the boat** — a different state from the dock's
       * "never left", with its own wording, its own danger-toned row, and a
       * checkpoint that stays open. Nothing in the seed reaches it, and the
       * departure capture above cannot show it, so it gets its own baseline:
       * this is the screen a captain reads when someone is still in the water,
       * and it used to be pixel-identical to a settled "Not boarded ☑️" row.
       * Its own test so the roll-call write is contained — the per-test DB
       * reset (e2e/fixtures.ts) puts it back.
       */
      test(`the manifest's after-dive missing-diver state renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest, a checkpoint switch, and a roll-call write
        // before the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await openDeckDetails(page);
        // Same background-save settle the departure capture waits on, so this
        // isn't racing that async write either.
        await offlineCopySaved(page);
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        await openDeckDetails(page);
        // Scoped to the diver list: the crew section above it carries controls
        // with the same words, for a crew member rather than a diver.
        // Two deliberate steps, the way a crew records it (ADR
        // 20260827-the-departure-is-two-working-surfaces, decision 3): the
        // claim lives in the person's own panel, never on the row.
        const missingRow = await manifestRow(page, "Diego Alvarez");
        await openManifestPerson(missingRow);
        const markNotBack = page
          .getByRole("dialog")
          .getByRole("button", { name: "Mark not back aboard" });
        await markNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await markNotBack.click();
        await expect(page.locator('[data-deck-screen="receipt"]')).toContainText(
          staffCopy("manifest.deck.savedMissing"),
        );
        await openManifestPerson(await manifestRow(page, "Diego Alvarez"));
        // The panel the alarm leaves open, with the report's door in it (safety
        // sheet 2026-10-15, item 2): "Start a missing diver report" under "Mark
        // back aboard", for the owner signed in here.
        const startReport = page
          .getByRole("dialog")
          .getByRole("button", { name: /^Start a missing diver report — / });
        await startReport.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await page.mouse.move(0, 0);
        await capture(page, "manifest-not-back-aboard-panel", scheme);
        // Closed again for the shot: the alarm this capture is about is what
        // the *list* shows — the pinned danger line and the one red row — and a
        // panel left open would photograph a person's contact card instead.
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Close person details" })
          .click();
        await page
          .getByRole("button", { name: staffCopy("manifest.deck.attention"), exact: true })
          .click();
        await expect(page.locator('[data-deck-screen="attention"]')).toBeVisible();
        await page.mouse.move(0, 0);
        await capture(page, "manifest-not-back-aboard", scheme);
      });

      /**
       * **The boat at sea, mid roll call** (market sheet 2026-10-22, item 1):
       * the demo always has one underway, dive 1 counted and dive 2's count
       * at "9 of 11 back aboard" with one buddy pair still to surface. Read
       * only, so it needs no reset of its own.
       */
      test(`the boat at sea's open after-dive count renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        // The day's spine carries the departure's title as its door, like the
        // dawn boat's (`openSailedTrip`).
        await page.goto("/shop/blue-mantis");
        await page.getByRole("link", { name: AT_SEA_DAY_TITLE, exact: true }).first().click();
        await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
        await openTripTab(page, "Manifest");
        await openDeckDetails(page);
        await offlineCopySaved(page);
        const confirmed = liveRosterConfirmation(page, {
          tripId: new URL(page.url()).pathname.split("/")[4],
          checkpoint: "after_dive_2",
        });
        await page
          .getByRole("link", { name: "After dive 2" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_2/);
        await openDeckDetails(page);
        await page.locator("#deck-flow > div > details[open] > summary").click();
        await page.mouse.move(0, 0);
        await confirmed;
        await capture(page, "manifest-at-sea-mid-roll-call", scheme);
      });

      /**
       * **The plan-change door, open** (issue #1184, delight report D24; ADR
       * 20260904-reef-all-the-way-down slice 16d). The two fields it adds — a
       * coded reason a diver will read on their own record, and a note only the
       * shop sees — live inside the dive log's collapsed disclosure, so no
       * existing capture can reach them: `manifest-not-back-aboard` stands at
       * this same checkpoint with the log shut.
       *
       * The catch-up strip deliberately has no capture of its own. The seeded
       * demo leaves the owner a read mark and the desk's morning acts after it,
       * so the plain `manifest` shot above already carries the strip at the top
       * of the page — a second full-page shot of the same screen would cost two
       * baselines to photograph one block twice.
       */
      test.describe("isolated operational fixture", () => {
        test.use({
          storageState: { cookies: [], origins: [] },
          privateShopSlug: "manifest-plan-change",
        });
        test(`the manifest's plan-change fields render true to the design (${scheme})`, async ({
          page,
          request,
          privateShop,
        }) => {
          // The dive log lives on the Trip page, On the water (ADR
          // 20261117-trip-page-clock): a boat out with dive 1 counted.
          test.setTimeout(FLOW_TIMEOUT_MS);
          const { boatOnTheWater } = (await seedFacts(
            request,
            [{ name: "boatOnTheWater", state: "outstanding" }],
            { slug: privateShop.slug },
          )) as { boatOnTheWater: { tripId: string } };
          await page.goto(`/shop/${privateShop.slug}/trips/${boatOnTheWater.tripId}`);
          const log = await openDiveLog(page, boatOnTheWater.tripId, 1);
          // Waits on a control the open form renders and the closed one does not.
          await log.getByLabel("Actual site").fill("French Reef");
          await log.getByLabel("Why the plan changed").waitFor();
          await page.mouse.move(0, 0);
          await capture(page, "manifest-plan-change", scheme);
        });
      });

      /**
       * **The Seen group, with something in it** (slice 20r, the living reef).
       *
       * The chips themselves ride every after-dive capture above, because they
       * render at rest. What no existing baseline can reach is the *tally* —
       * the list under the chips that says the count, which exists only once a
       * crew has tapped, and which the per-test reset clears again. That list
       * is the only feedback a tap gets, so it is the half of this surface most
       * worth pinning.
       *
       * Its own test so the write is contained (e2e/fixtures.ts puts it back),
       * and one tap twice rather than two taps once: the second tap on one chip
       * is the behaviour a crew relies on and the one a regression would break
       * silently, by writing a second row that reads as a second turtle.
       */
      test(`the manifest's Seen tally renders true to the design (${scheme})`, async ({ page }) => {
        // Board → trip → Manifest, a checkpoint switch, and two taps. The
        // first-light boat rather than today's headline charter, because the
        // group only exists once a departure has sailed and the reef trip is
        // still five hours out on the frozen clock.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openSailedTrip(page);
        await openTripTab(page, "Manifest");
        await openDeckDetails(page);
        await offlineCopySaved(page);
        const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\/manifest/)?.[1];
        if (!tripId) throw new Error("The sailed trip manifest must identify its trip");
        const confirmed = liveRosterConfirmation(page, { tripId, checkpoint: "after_dive_1" });
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        await openDeckDetails(page);
        await confirmed;
        const seen = page.getByRole("region", { name: "Seen" });
        const chip = seen.getByRole("button", { name: "Southern stingray", exact: true });
        await chip.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await chip.click();
        // Waits on what the write renders, never on the click: the click
        // resolves when the request leaves, not when the row lands.
        const tally = seen.getByRole("listitem").filter({ hasText: "Southern stingray" });
        await expect(tally).toContainText("1");
        await chip.click();
        await expect(tally).toContainText("2");
        const grouper = seen.getByRole("button", { name: "Goliath grouper", exact: true });
        await expect(grouper).toBeEnabled();
        await grouper.click();
        await expect(seen.getByRole("listitem")).toHaveCount(2);
        await expect(grouper).toBeEnabled();
        // Sighting writes can supersede the current roster proof. Photograph
        // the persisted tally after a fresh read, retaining the immediate
        // feedback assertions above as well as the current-roster check.
        const persisted = liveRosterConfirmation(page, { tripId, checkpoint: "after_dive_1" });
        await page.reload();
        await openDeckDetails(page);
        await persisted;
        await expect(tally).toContainText("2");
        await expect(seen.getByRole("listitem")).toHaveCount(2);
        await page.mouse.move(0, 0);
        await capture(page, "manifest-seen", scheme, {
          beforeScreenshot: async () => {
            await expect(
              page.getByText(staffCopy("manifest.rosterUnconfirmed"), { exact: true }),
            ).toHaveCount(0);
          },
        });
      });

      /**
       * **One person's panel, open** — the "one tap away" tier of ADR
       * 20260827-the-departure-is-two-working-surfaces, decision 2. The
       * `manifest` capture above photographs ten rows at rest, which proves
       * nothing about what the tap reveals, and everything the row now tucks
       * away is in here: the emergency contact as reference text, the rental
       * line, the buddy team, the note field, and — the reason the panel
       * exists at all — the deliberate second step that records "not back
       * aboard" (decision 3).
       *
       * It replaced a capture of two side-by-side disclosures ("Contact &
       * gear" / "Add a note") that the row no longer has.
       */
      test(`a diver row's person panel renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await openDeckDetails(page);
        await offlineCopySaved(page);
        const row = await manifestRow(page, "Tom Okafor");
        await openManifestPerson(row);
        // Painted before the shot: the facts grid renders its emergency-contact
        // heading and the note field its input. Scoped to the disclosure — the
        // print-only copy of the same facts is in the DOM on every row,
        // carrying the identical heading.
        await expect(page.getByRole("dialog").getByText("Emergency contact")).toBeVisible();
        await expect(page.getByRole("dialog").getByRole("textbox", { name: "Note" })).toBeVisible();
        // The pointer is left on the summary by the click above, which would
        // bank a hover-underlined name into the baseline.
        await page.mouse.move(0, 0);
        await capture(page, "manifest-person-panel", scheme);
      });

      /**
       * A split buddy team after a dive (ADR 20260804-buddy-teams): Tom is
       * recorded back aboard and a human has recorded his seeded teammate Lena
       * **not back**, so his row carries the danger capsule and the count panel
       * adds the "1 buddy team is split" line. Both halves are needed now —
       * Tom aboard while Lena is merely uncalled is the ordinary mid-count
       * state and is deliberately calm (ADR
       * 20260827-the-departure-is-two-working-surfaces, decision 4). The seed
       * carries the teams but no roll-call events (they would open head-count
       * gaps on Today), so the divergent state is driven here and the per-test
       * DB reset puts it back — the same pattern as the missing-diver capture
       * above.
       */
      test(`the manifest's split buddy team renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest, a checkpoint switch, and a roll-call
        // write before the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await openDeckDetails(page);
        await offlineCopySaved(page);
        const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/]+)\/manifest/)?.[1];
        if (!tripId) throw new Error("The reef trip manifest must identify its trip");
        // Capture the intended fresh roster, confirmed by the real scoped 204 response after
        // checkpoint navigation and each write, rather than a transient withdrawal.
        const checkpointConfirmed = liveRosterConfirmation(page, {
          tripId,
          checkpoint: "after_dive_1",
        });
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        await openDeckDetails(page);
        await checkpointConfirmed;
        await openDeckPerson(page, "Tom Okafor");
        const tomConfirmed = liveRosterConfirmation(page, { tripId, checkpoint: "after_dive_1" });
        await page
          .getByRole("button", {
            name: staffCopy("manifest.deck.record", { name: "Tom Okafor" }),
            exact: true,
          })
          .click();
        await expect(page.locator('[data-deck-screen="receipt"]')).toContainText(
          staffCopy("manifest.deck.savedAboard"),
        );
        await tomConfirmed;
        await openManifestPerson(await manifestRow(page, "Lena Fischer"));
        const lenaConfirmed = liveRosterConfirmation(page, { tripId, checkpoint: "after_dive_1" });
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Mark not back aboard", exact: true })
          .click();
        await expect(page.locator('[data-deck-screen="receipt"]')).toContainText(
          staffCopy("manifest.deck.savedMissing"),
        );
        await lenaConfirmed;
        const tomRow = await manifestRow(page, "Tom Okafor");
        await expect(tomRow.getByText("Lena not back aboard", { exact: true })).toBeVisible();
        await page.mouse.move(0, 0);
        await capture(page, "manifest-buddy-divergence", scheme, {
          beforeScreenshot: async () => {
            await expect(
              page.getByText(staffCopy("manifest.rosterUnconfirmed"), { exact: true }),
            ).toHaveCount(0);
            await expect(tomRow.getByText("Lena not back aboard", { exact: true })).toBeVisible();
          },
        });
      });

      test(`the manifest stage controls keep keyboard focus visible at both track edges (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/shop/blue-mantis");
        await page.getByRole("link", { name: AT_SEA_DAY_TITLE, exact: true }).first().click();
        await expect(page).toHaveURL(/\/trips\/[a-f0-9-]+$/);
        // The roster's live check lands after the offline copy is saved, and
        // until it does the deck carries "Guest list may be out of date": a
        // shutter inside that window drew the line, or measured the page with
        // it and painted without it (#4748).
        const confirmed = liveRosterConfirmation(page);
        await openTripTab(page, "Manifest");
        await openDeckDetails(page);
        await offlineCopySaved(page);
        await confirmed;
        const boarding = page.getByRole("button", { name: "Boarding", exact: true });
        const home = page
          .locator('form:has(input[name="stage"][value="home"])')
          .getByRole("button", { name: "Home", exact: true });
        await expect(boarding).toBeVisible();
        await expect(home).toBeVisible();

        const focusByTab = async (label: "Boarding" | "Home") => {
          const target = label === "Home" ? home : boarding;
          await target.evaluate((button) => {
            if (!(button instanceof HTMLElement)) {
              throw new Error(`The ${label} stage control is not an HTML element`);
            }
            const focusable = Array.from(
              document.querySelectorAll<HTMLElement>(
                'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
              ),
            ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
            const index = focusable.indexOf(button);
            const previous = focusable[index - 1];
            if (!previous) throw new Error(`No preceding keyboard stop before the ${label} stage`);
            previous.focus();
          });
          await page.keyboard.press("Tab");
          await expect(target).toBeFocused();
          await expect(target).toHaveCSS("outline-offset", "-3px");
        };

        await capture(page, "manifest-stage-boarding-focus", scheme, {
          beforeShot: async () => {
            await focusByTab("Boarding");
            await expect(boarding).toBeFocused();
          },
        });
        await capture(page, "manifest-stage-home-focus", scheme, {
          beforeShot: async () => {
            await focusByTab("Home");
            await expect(home).toBeFocused();
          },
        });
      });

      if (scheme === "light") {
        test("the manifest keeps both capacity warnings distinct", async ({ page, request }) => {
          const seeded = await seedFacts(request, ["troublePanels", "manifestOverCapacity"]);
          const { manifestOverCapacity } = seeded as {
            manifestOverCapacity?: { tripId: string };
          };
          if (!manifestOverCapacity) {
            throw new Error("the fact could not create both manifest capacity warnings");
          }

          await page.goto(`/shop/blue-mantis/trips/${manifestOverCapacity.tripId}/manifest`);
          await page
            .getByRole("button", { name: staffCopy("manifest.deck.attention"), exact: true })
            .click();
          await expect(
            page.getByText(/beyond the passenger capacity set for this trip/),
          ).toBeVisible();
          await expect(
            page.getByText(/beyond the total capacity set for this boat, crew included/),
          ).toBeVisible();
          await capture(page, "manifest-over-capacity-warnings", scheme);
        });
      }

      /**
       * The buddy-teams panel itself — the team builder (ADR
       * 20260804-buddy-teams). Worth its own capture because it is where the
       * model became visible: a team of any size, a crew member marked as crew
       * on the divemaster-led trio, per-member removal, and a checkbox builder
       * in place of the two dropdowns that could only ever express a pair. The
       * Boat tab's sheet carries no panel, so no other capture covers it.
       */
      test(`the manifest's buddy-team builder renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripPhase(page, "ready");
        const panel = page.locator("section", {
          has: page.getByRole("heading", { name: "Buddy teams" }),
        });
        // The panel rests collapsed behind its summary line — the capture is
        // of the panel itself, so open it the way a staffer would.
        await panel.locator("summary").first().click();
        await expect(panel.getByText("Keiko Tanaka (crew)", { exact: true })).toBeVisible();
        await panel.scrollIntoViewIfNeeded();
        await capture(page, "manifest-buddy-teams-panel", scheme);
      });

      // H-20260724-certification-levels-agency-rules: a site deeper than the seeded 12 m reaches 105 ft. The seeded
      // cards do not establish junior/full status, so the roster asks the crew
      // to verify each diver's applicable limit before planning; it stays an
      // advisory outside the red blocker list.
      //
      // **No revert, and none needed.** A dive site is schedule data, not shop
      // configuration: `resetDemoSchedule` deletes `dive_sites` and re-seeds it
      // before every test, so the next one reads Molasses Reef back at the
      // seeded 12m whatever this test did or how it died. The `finally` that
      // used to set it back was restoring a value the harness restores anyway,
      // and it was not free — it put a second full form round-trip inside the
      // same ceiling the capture had already spent, which is precisely how the
      // nitrox capture at the foot of this file used to fail: the renderer
      // wedged, the paint waits and the screenshot burned the budget, and the
      // timeout landed on the revert. A revert that cannot run when it matters
      // and is not needed when it can is only a way to run out of clock.
      test(`the roster's depth warning renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // One briefing save, then board → trip → Guests before the shot.
        // Measured failing at HEAD *and* on `main` at one worker, so it was
        // never a contention problem: the budget was simply never sized for
        // what the test does. A flat 60s when it was written, which stopped
        // tracking the budgets the moment they were derived — and by now
        // *lowered* this test below the plain-capture ceiling it was raised
        // above. Same allowance as every other flow capture here.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/shop/blue-mantis/dive-sites");
        const siteHref = await page
          .getByRole("link", { name: "Molasses Reef", exact: true })
          .first()
          .getAttribute("href");
        if (!siteHref) throw new Error("no dive-site link for Molasses Reef");
        // A full navigation lets the site editor hydrate before the first
        // field interaction; the SPA click path can lose that initial fill.
        await page.goto(siteHref);
        await page.getByLabel(/Maximum depth/).fill("105");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByText("Dive site saved")).toBeVisible();
        await page.goto(siteHref);
        await expect(page.getByLabel(/Maximum depth/)).toHaveValue("105");

        await openReefTrip(page);
        await openTripTab(page, "Trip");
        // At Check-in the depth check rides each guest's own row among their
        // other reasons; the whole sentence is on the guest opened from it.
        await expect(
          page
            .locator('[data-fix-group="toCome"] li')
            .filter({ hasText: staffCopy("trips.fixList.reason.depth") })
            .first(),
        ).toBeVisible();
        const june = await rosterRow(page, "June Park");
        await expect(
          june.getByText(staffCopy("trips.roster.depthVerificationCard"), { exact: false }),
        ).toBeVisible();
        await capture(page, "trip-guests-depth-warning", scheme);
      });

      // Land-then-undo (docs/design/principles.md §7): deleting a private
      // staff note is a purely reversible edit, so it lands immediately
      // behind a toast instead of a blocking confirm. Its own test so the
      // roster note this adds and removes doesn't leak into another
      // surface's capture.
      test(`the roster's note-delete undo toast renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Guests, then an add and a delete round-trip.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Trip");
        const row = await rosterRow(page, "Priya Sharma");
        const noteBody = "Visual regression seed note for the undo toast.";
        await openRosterNotes(row);
        await row.getByLabel("Add a note only staff can see").fill(noteBody);
        await row.getByRole("button", { name: "Add private note" }).click();
        // Adding a note no longer navigates, so there is no longer a toast
        // saying it worked — the note appearing in the list above the box *is*
        // the confirmation, which is the point of the change. Wait for that.
        await row.getByText(noteBody).waitFor();

        // And because nothing navigated, the disclosure is still open — hence
        // the helper, which would otherwise close it and hide the Delete
        // button it is about to press.
        await openRosterNotes(row);
        await row.getByRole("button", { name: "Delete" }).click();
        await page.getByText("Private note deleted").waitFor();
        await capture(page, "trip-guests-note-undo", scheme);
      });

      /**
       * **The boat's own cert gate, refused, on the surface staff work from**
       * (ADR 20260803-trip-admission-at-booking; the flow itself is
       * e2e/trip-admission.spec.ts).
       *
       * Two captures because the banner says two structurally different things,
       * and until now neither had a baseline — a refusal is a *state*, not a
       * route, so `trip-guests` could never show it. A level refusal names the
       * rung the charter wants and the rung the diver stands on, and offers no
       * card to add; a card refusal names the missing specialty and says there
       * is none on the record. One sentence pattern regressing into the other
       * is exactly the kind of change that reads as fine in a diff and wrong on
       * the screen.
       *
       * The seeded scenarios come from `src/db/seed/cert-gates.ts`, whose whole
       * point is that each of these boats can be refused for exactly one reason.
       */
      test(`the roster's level refusal renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // A board crawl to a day-31 departure, then a real seating attempt.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", ADVANCED_CHARTER);
        // Diego Alvarez is on file with a verified Open Water card and nothing
        // above it, so the refusal can only be about the rung.
        await page.goto(`/shop/blue-mantis/trips/${tripId}?diverq=Diego+Alvarez`);
        await addFoundGuest(page, "Diego Alvarez");
        await page.getByText("This charter requires Advanced Open Water.").waitFor();
        await capture(page, "trip-guests-refusal-level", scheme);
      });

      test(`the roster's missing-card refusal renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", DEEP_CHARTER);
        // Odile Marchand holds a verified Instructor card — the top rung — and
        // no specialty card at all, so nothing about her level can explain it.
        await page.goto(`/shop/blue-mantis/trips/${tripId}?diverq=Odile+Marchand`);
        await addFoundGuest(page, "Odile Marchand");
        await page.getByText("This charter requires a Deep certification.").waitFor();
        await capture(page, "trip-guests-refusal-card", scheme);
      });

      /**
       * A course session's Readiness requirements, stating the gate its *dive
       * site* carries and saying out loud that it never blocks enrolment (the
       * carve-out in ADR 20260803-trip-admission-at-booking, amended after the
       * dive-domain-expert review). `trip-manage` above is a plain charter with
       * an editable requirements form; this is the frozen variant, where the
       * rules come from the course and the site and there is no form at all —
       * a different section, on a page whose baseline could never show it.
       */
      test(`a course session's requirements render true to the design (${scheme})`, async ({
        page,
      }) => {
        // A board crawl out to the day-29 session, then the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", AOW_COURSE);
        await page.goto(`/shop/blue-mantis/trips/${tripId}?phase=filling`);
        const courseAdmission = staffCopy("trips.clock.filling.courseCard", {
          level: staffCopy("shared.readiness.certificationLevels.openWater"),
        });
        await expect(page.getByText(courseAdmission).first()).toBeVisible();
        await capture(page, "trip-filling-course-admission", scheme);
        await openTripAboutRow(page, "Who can book");
        await expect(page.locator("details#requirements")).toContainText(courseAdmission);
        await page
          .locator("details#requirements")
          .getByText(/never blocks? enrollment/)
          .first()
          .waitFor();
        await capture(page, "trip-manage-course-requirements", scheme);
      });
    });
  });
}
