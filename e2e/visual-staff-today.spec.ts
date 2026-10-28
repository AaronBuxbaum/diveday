/**
 * Visual captures: the staff day: Today, the desk, the counter, the evening and the staffing week.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */

import { clearCourseForms } from "./course-form-only";
import {
  expect,
  signedInAsOwner,
  signedInAsTodayCaptain,
  test,
} from "./fixtures";
import {
  bookOpenWaterSession,
  counterPath,
  createTrip,
  daysFromNow,
  disclosureSettled,
  openBookingActions,
  openCounterFor,
  openPaperWaiverForm,
  openRosterDetails,
  openTodayBoatFolds,
  requireCourseForm,
  STAFF_DAY_HEADING,
  scheduleCrewedOpenWaterSession,
  seatFromRoster,
  seededTripId,
  waitForTodayCatchUpSettled,
  writeCourseForm,
} from "./helpers";
import { todayCatchUpScenario } from "./today-catch-up-helper";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  SAILED_TRIP,
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
      test.beforeAll(async ({ todayCaptainStorageState }) => {
        await todayCaptainStorageState;
      });

      /**
       * **Crew get a dock time of their own** (ux-delight sheet 2026-10-22,
       * item 2; H-149): the demo captain's "Your week" reads "At the dock",
       * 30 minutes before the divers, from the shop's crew time.
       */
      test.describe("as the captain", () => {
        signedInAsTodayCaptain();

        test(`a captain's week names the crew's own dock time (${scheme})`, async ({ page }) => {
          await page.goto("/shop/blue-mantis");
          await waitForTodayCatchUpSettled(page);
          await page.getByRole("heading", { name: "Your week" }).waitFor();
          await page
            .getByText(/At the dock \d{1,2}:\d\d\s[AP]M · leaves/)
            .first()
            .waitFor();
          await capture(page, "today-captain-your-week", scheme);
        });
      });

      test(`Today catches up on a walk-in (${scheme})`, async ({
        browser,
        page,
        workerBaseURL,
        todayCaptainStorageState,
      }) => {
        const { reader, readerContext } = await todayCatchUpScenario(
          browser,
          page,
          workerBaseURL,
          todayCaptainStorageState,
        );
        try {
          await expect(reader.getByRole("region", { name: /Since / })).toContainText(
            "Today Catchup Diver took a seat.",
          );
          await capture(reader, "today-catch-up", scheme, {
            beforeScreenshot: async () => {
              await expect(reader.getByRole("alertdialog", { name: "Session paused" })).toHaveCount(
                0,
              );
              await expect(reader.getByRole("region", { name: /Since / })).toContainText(
                "Today Catchup Diver took a seat.",
              );
            },
          });
        } finally {
          await readerContext.close();
        }
      });

      test(`the day spine renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis");
        await page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING }).waitFor();
        await capture(page, "today", scheme);
      });

      if (scheme === "light") {
        test("grouped departure links have a usable touch target and keyboard focus", async ({
          page,
        }) => {
          for (const width of [390, 1280]) {
            await page.setViewportSize({ width, height: 844 });
            await page.goto("/shop/blue-mantis");
            const link = page.locator('#needs-you h3 a[href*="/trips/"]').first();
            await expect(link).toBeVisible();
            const box = await link.boundingBox();
            expect(box?.height).toBeGreaterThanOrEqual(44);
            await link.focus();
            await page.keyboard.press("Shift+Tab");
            await page.keyboard.press("Tab");
            await expect(link).toBeFocused();
          }
        });
      }

      test(`a course station shows the course total (${scheme})`, async ({ page }) => {
        await createTrip(page, {
          course: "Open Water Diver",
          title: "Course price check",
          date: daysFromNow(1),
          departsAt: "08:00",
          returnsAt: "17:00",
        });
        await page.goto("/shop/blue-mantis");
        await page
          .locator("summary")
          .filter({ hasText: /^Tomorrow · / })
          .first()
          .click();
        const station = page
          .locator("li")
          .filter({ has: page.getByRole("heading", { name: "Course price check" }) });
        await expect(station).toContainText("$709");
        await capture(page, "today-course-price", scheme);
      });

      test(`the help editor opens beneath its person summary (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis");
        await page
          .getByRole("button", { name: staffCopy("today.helpRequest.arrangeHelp"), exact: true })
          .click();
        await expect(page.locator('select[name="helperPersonId"]')).toBeVisible();
        await capture(page, "today-help-request-editor", scheme);
        await page.locator('select[name="helperPersonId"]').press("Escape");
        await expect(
          page.getByRole("button", {
            name: staffCopy("today.helpRequest.arrangeHelp"),
            exact: true,
          }),
        ).toBeFocused();
      });

      // **Which boat is this diver on?** Today's arrival lookup with a match:
      // the desk's first question, answered as one row per booking that opens
      // that boat's Divers tab at the diver's own row.
      test(`the arrival lookup renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis?q=Priya%20Sharma");
        await page
          .getByRole("link", { name: /check-in for Priya Sharma$/ })
          .first()
          .waitFor();
        await capture(page, "today-arrival-lookup", scheme);
      });

      // **"Running late, said 9:18"** (J3): the lookup row of a diver who told
      // the shop, through the opt-in trouble state rather than the demo.
      test(`a running-late diver in the arrival lookup renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?runningLate=1");
        expect((await seeded.json()) as { runningLate?: unknown }).toHaveProperty("runningLate");
        await page.goto("/shop/blue-mantis?q=Priya%20Sharma");
        await page
          .getByText(/^Running late, said /)
          .first()
          .waitFor();
        await capture(page, "today-arrival-lookup-running-late", scheme);
      });

      // The captain's half of the same statement (#2319): a quiet line under
      // the name on the dock roll call, for a diver nobody has called yet.
      test(`a running-late diver on the manifest renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?runningLate=1");
        const { runningLate } = (await seeded.json()) as { runningLate?: { tripId: string } };
        if (!runningLate) throw new Error("seed-trouble-states found no seat to say it on");
        await page.goto(`/shop/blue-mantis/trips/${runningLate.tripId}/manifest`);
        await page.getByRole("heading", { name: "Roll call" }).waitFor();
        await page
          .getByText(/^Running late, said /)
          .first()
          .waitFor();
        await capture(page, "manifest-running-late", scheme);
      });

      /**
       * **The identity menu, open** — the shop's name in the chrome bar opens
       * Settings, the language choices and Sign out (`ShopIdentityMenu` with
       * `LanguageChoices`). Nothing else in this file opens it, so until this
       * capture no baseline and no pixel probe had ever seen the panel: its
       * text edges, and the `rounded-lg` rows inside a `rounded-inset p-2`
       * panel, had only ever been reviewed by people.
       *
       * It closes on a pointerdown outside it, on Escape, or on a navigation
       * (`useMenuDismissal`) — none of which `capture()` does — and the test
       * closes it with Escape so it cannot leak into anything that follows.
       */
      test(`the identity menu, open, renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis");
        await page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING }).waitFor();
        const trigger = page.locator("[data-identity-menu]");
        await trigger.click();
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        // The language rows are what the panel renders once mounted.
        await page.getByRole("button", { name: "Español" }).waitFor();
        await capture(page, "identity-menu-open", scheme);
        await page.keyboard.press("Escape");
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
      });

      /**
       * **The demo banner's "Switch role" menu, open** (issue #2513): the
       * rewritten role descriptions live only here, and no capture opened it.
       * Left open for the shot; the next test starts on a page of its own.
       */
      test(`the demo's role menu, open, renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis");
        await page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING }).waitFor();
        await page.getByRole("button", { name: /^Switch role/ }).click();
        await page.getByRole("button", { name: "Switch to Instructor" }).waitFor();
        await capture(page, "demo-role-menu", scheme);
      });

      /**
       * **A student signing a course form** (ADR 20261008-course-forms).
       *
       * `/ready/[token]/forms` only exists for a booking on a course that asks
       * for a form, so the capture walks the shop's own path to one: write a
       * form, choose it for Open Water, schedule a crewed session, then book it
       * signed out. The body is the shop's text exactly as stored, set in a
       * pre-wrapped block, so its line breaks are the thing to watch.
       */
      test(`the course form signing page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const formTitle = "Safe diving practices";
        await writeCourseForm(
          page,
          formTitle,
          "I will dive within the limits of my training and plan every dive with my buddy.\n\nI will tell the instructor before any session if anything about my health changes.",
        );
        await clearCourseForms(page, "open-water-diver");
        await requireCourseForm(page, "open-water-diver", formTitle);
        // 24 days out, clear of the seeded sessions whose crew would clash.
        await scheduleCrewedOpenWaterSession(page, "Open Water Diver — forms", 24);
        await page.context().clearCookies();
        const readyPath = await bookOpenWaterSession(
          page,
          "Visual Regression Diver",
          `visual-regression-forms-${scheme}@example.com`,
        );
        await page.goto(`${readyPath}/forms`);
        await expect(page.getByRole("heading", { level: 1, name: formTitle })).toBeVisible();
        await capture(page, "course-form-sign", scheme);
      });

      /**
       * **Today once a blocked diver is on the boat.**
       *
       * The diver's Needs you row takes the danger-toned "Aboard" kind and
       * keeps the blocker and its fix (issue #791). It was a sentence on the
       * departure card until 2026-10-05, beside a row that told the same diver's
       * blocker as if they were still on the dock. Nothing had ever photographed
       * it: the seeded shop starts with nobody boarded, so every capture of
       * this surface saw the *ashore* row, and the one a crew reads at the rail
       * with the gate already behind somebody was never looked at.
       *
       * `?blockedAboard=1` boards the first diver the gate clears, by name
       * (Diego Alvarez in the seed), then supersedes the release he signed, so
       * the row reads "Signed waiver lapsed" — a signature that no longer
       * stands, never "not sent yet" (`waiver_lapsed`, which renamed it). The
       * reset restores the schedule before the next test, which is what makes
       * it safe to board him here.
       */
      test(`a station names a blocker aboard (${scheme})`, async ({ page, request }) => {
        // **Through the trouble-states route, because it cannot be clicked.**
        // The departure checkpoint offers a blocked diver no boarding button —
        // that is the app's gate — and the after-dive head count writes a
        // different checkpoint than the station reads. In production the state
        // arises the other way round: a diver boards while clear and *then*
        // becomes blocked, because readiness is evaluated live.
        await request.post("/api/test/seed-trouble-states?blockedAboard=1");
        await page.goto("/shop/blue-mantis");
        // The destination's own words, not a timing guess: this row is what
        // the capture exists for.
        await page
          .getByRole("listitem")
          .filter({ hasText: staffCopy("today.actionKind.blockedAboard") })
          .filter({ hasText: staffCopy("today.blockerRow.waiverLapsed", { count: 1 }) })
          .first()
          .waitFor();
        await capture(page, "today-blocked-aboard", scheme);
      });

      /**
       * **Failed emails to several people are one row** (Aaron, 2026-10-05).
       * Three bounced confirmations on the next boat read "3 confirmation
       * emails didn’t send." with one Resend confirmations button, never
       * three identical rows. The seed sends only successes, so the bounce
       * comes through the trouble-states route.
       */
      test(`failed emails batch into one row (${scheme})`, async ({ page, request }) => {
        await request.post("/api/test/seed-trouble-states?failedEmails=1");
        await page.goto("/shop/blue-mantis");
        // A chore on a long boat: the row sits behind "and N more" (foldBoatRows).
        await openTodayBoatFolds(page);
        await page.getByRole("button", { name: "Resend confirmations" }).waitFor();
        await capture(page, "today-failed-emails", scheme);
      });

      /**
       * **A full boat nobody has counted the crew on.**
       *
       * Every diver-shaped signal on this page says the day is going
       * perfectly, and a named crew member has no result — so somebody may be
       * on the dock, or in the water. The departure card the station replaced
       * used to celebrate here (issue #789); the line it shows instead is
       * warning-toned, and a warning nothing has photographed is one nobody has
       * looked at.
       */
      test(`a station holds back the confetti for an uncounted crew (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?crewUncounted=1");
        await page.goto("/shop/blue-mantis");
        // The destination's own words, not a timing guess.
        await page.getByText(/crew roll call is still open/).waitFor();
        await capture(page, "today-crew-uncounted", scheme);
      });

      /**
       * **A crew member on two of today's boats** (H-80, issue #1776). Each
       * boat shows a full crew list, so the clash is invisible on both until
       * the queue says so. `?crewClash=1` slides a seeded departure onto
       * today's through `moveTrip`, the one door into the state, and the
       * earlier boat's station carries the one row (issue #2211).
       */
      test(`today names a crew member on two boats at once (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?crewClash=1");
        expect(seeded.ok()).toBe(true);
        await page.goto("/shop/blue-mantis");
        // The destination's own words, not a timing guess.
        await page.getByText("Crew on two departures").first().waitFor();
        await capture(page, "today-crew-clash", scheme);
      });

      /**
       * **One hull on two departures at once** (H-80, issue #2135). `?boatClash=1`
       * slides a seeded departure onto another that shares its boat through
       * `moveTrip`; Today says it once, on the earlier departure.
       */
      test(`today names a boat on two departures at once (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?boatClash=1");
        expect(seeded.ok()).toBe(true);
        await page.goto("/shop/blue-mantis");
        await page.getByText("Boat on two departures").first().waitFor();
        await capture(page, "today-boat-clash", scheme);
      });

      /**
       * **The same clash with both boats two hours out** (H-80, issue #1814).
       * Neither is a station any more, so the sailed row files at the desk in
       * Needs you, naming its own boat, rather than into the week's count.
       */
      test(`today names a boat that left with a crew clash (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?crewClashSailed=1");
        expect(seeded.ok()).toBe(true);
        expect(
          ((await seeded.json()) as { crewClashSailed?: unknown }).crewClashSailed,
        ).toBeTruthy();
        await page.goto("/shop/blue-mantis");
        // The destination's own words, not a timing guess.
        await page.getByText("Left with a crew clash").first().waitFor();
        await capture(page, "today-crew-clash-sailed", scheme);
      });

      // The phone's More menu: the sections the tab bar's four leave out (ADR
      // 20261001-logbook). Opened at the phone viewport because it only exists
      // below `lg`; the 1280 image is the plain page with its sidebar.
      test(`the phone's More menu (${scheme})`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/shop/blue-mantis");
        await page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING }).waitFor();
        await page
          .getByRole("navigation", { name: "Main", exact: true })
          .getByRole("button", { name: "More" })
          .click();
        await page.getByRole("link", { name: "Money" }).waitFor();
        await capture(page, "nav-more", scheme);
      });

      // **The `blockers` capture retired with its surface.** It photographed
      // Today's by-departure view, reached through the `/blockers` redirect;
      // the shop home is one chronological spine now and that view no longer
      // exists to shoot (ADR 20260827-clearwater-surface-language, decision 4).
      // Every blocked diver it used to frame is a row on their boat's station
      // in the `today` capture above, and `day-spine.spec.ts` holds the
      // redirect to a single hop.

      // The counter itself: one departure's Divers tab with its arrivals open,
      // reached the way the desk reaches it — Today's arrival lookup, then the
      // diver's own row. Priya Sharma is seeded blocked on a boat inside the
      // arrivals window, so the frame holds the instrument above the roster, a
      // blocked row with its reasons and no tap, cleared rows ending in their
      // check-in taps, and "Add a diver" as one search field.
      test(`the desk on a departure's Divers tab renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openCounterFor(page, "blue-mantis", "Priya Sharma");
        await page.getByText(/^\d+ of \d+ here$/).waitFor();
        await page.getByRole("searchbox", { name: "Find a returning diver" }).waitFor();
        await capture(page, "trip-desk", scheme);
      });

      // The desk's settled state: a departure that is home. Its Divers tab is
      // no longer the desk but the record (UX review 2026-10-10, item 10),
      // every seat filed by the crew's roll call under "Sailed", "Didn't
      // sail", "Not counted at the dock" or "No roll call taken". The seeded
      // dawn boat boarded everyone readiness cleared and turned the rest away
      // at the dock (#2415), so the frame holds "Sailed" and "Didn't sail"
      // and no count, no taps and nothing still to clear: a record never asks
      // for action. Reading the seeded state keeps this capture independent of
      // the mutable roll-call action. The capture keeps its name so the
      // baseline diff reads as this surface changing, not a new one.
      test(`the desk's settled boat renders true to the design (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", SAILED_TRIP);
        await page.goto(counterPath("blue-mantis", tripId));
        await page.getByRole("heading", { level: 1, name: SAILED_TRIP }).waitFor();
        await page.getByRole("heading", { name: /^Sailed · \d+$/ }).waitFor();
        await capture(page, "trip-desk-checked", scheme);
      });

      // The same record with a seat the dock never counted (#2408): the "Not
      // counted at the dock" band had only been checked in jsdom. One seat
      // sailed, one was turned away, one has no dock result at all, so all
      // three bands stand on one finished departure.
      test(`a finished boat's record with an uncounted seat renders true to the design (${scheme})`, async ({
        page,
      }) => {
        const seeded = await page.request.post("/api/test/seed-trouble-states?uncountedSeat=1");
        expect(seeded.ok()).toBe(true);
        const { uncountedSeat } = (await seeded.json()) as {
          uncountedSeat?: { tripId: string; personName: string };
        };
        if (!uncountedSeat) throw new Error("seed-trouble-states left no seat uncounted");
        await page.goto(counterPath("blue-mantis", uncountedSeat.tripId));
        await page.getByRole("heading", { level: 1, name: SAILED_TRIP }).waitFor();
        await page.getByRole("heading", { name: /^Sailed · \d+$/ }).waitFor();
        await page.getByRole("heading", { name: /^Didn’t sail · \d+$/ }).waitFor();
        await page.getByRole("heading", { name: /^Not counted at the dock · 1$/ }).waitFor();
        await capture(page, "trip-record-uncounted", scheme);

        // Remove on that seat (H-133): held as possibly carried, and told how
        // to let it go, never that it sailed.
        const row = page
          .locator('#roster li[id^="booking-"]')
          .filter({ hasText: uncountedSeat.personName })
          .first();
        await openRosterDetails(row);
        await openBookingActions(row);
        await row.locator("summary", { hasText: /^\s*Remove booking\s*$/ }).click();
        await row.getByRole("status").filter({ hasText: "at the dock, so the boat may" }).waitFor();
        await expect(row.getByRole("button", { name: "Yes, remove booking" })).toHaveCount(0);
        await capture(page, "trip-remove-uncounted-refused", scheme);
      });

      // **Remove on a diver marked aboard a boat that has left** (H-133). The
      // dawn boat boarded its sailed seats and is home, so a sailed row's
      // Remove opens on why it will not, with nothing to confirm.
      test(`Remove on a diver marked aboard says why it will not (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", SAILED_TRIP);
        await page.goto(counterPath("blue-mantis", tripId));
        await page.getByRole("heading", { name: /^Sailed · \d+$/ }).waitFor();
        const row = page
          .locator('#roster li[id^="booking-"]')
          .filter({ has: page.locator("summary", { hasText: /^\s*Remove booking\s*$/ }) })
          .first();
        await openRosterDetails(row);
        await openBookingActions(row);
        await row.locator("summary", { hasText: /^\s*Remove booking\s*$/ }).click();
        await row.getByRole("status").filter({ hasText: "sailed on this departure" }).waitFor();
        await expect(row.getByRole("button", { name: "Yes, remove booking" })).toHaveCount(0);
        await capture(page, "trip-remove-aboard-refused", scheme);
      });

      /**
       * **The desk's refused paper release** — the class
       * `.claude/rules/surfaces.md` names outright: a panel that renders only
       * when something has gone wrong, warning-toned and dense, on the one
       * screen a diver is standing in front of. It shipped with no baseline
       * (issue #1580), verified by hand against a browser session that left
       * nothing behind for the next change to fail against.
       *
       * **What the seed has to make, and why the demo has not got it.** The
       * paper control draws the guardian name and relationship fields only for
       * a diver the co-signature rule asks it of. The demo has a blocked adult
       * (Priya Sharma) and a co-signed minor (Lena Fischer) and nobody who is
       * both — so shot against the adult this would photograph a namesake
       * refusal above a form with no name field in it, which is the wrong
       * subject rendered silently. `?blockedMinor=1` supersedes Lena's release
       * and hands back the seat it made.
       *
       * **The refusal is the form's own answer**, made the way a staffer
       * makes it: the roster row's paper control answers in its
       * `useActionState` rather than redirecting (issue #1674), so the words
       * land under the button on the row, with what was typed still in the
       * boxes and the namesake tick the refusal draws (issue #1573). Every
       * assertion below is scoped to that row.
       */
      test(`the desk's refused paper release renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?blockedMinor=1");
        expect(seeded.ok()).toBe(true);
        const { blockedMinor } = (await seeded.json()) as {
          blockedMinor?: { bookingId: string; tripId: string };
        };
        if (!blockedMinor)
          throw new Error("seed-trouble-states found no seat for the demo's minor");

        await page.goto(counterPath("blue-mantis", blockedMinor.tripId));
        const row = page.locator(`#booking-${blockedMinor.bookingId}`);
        await openRosterDetails(row);
        await openPaperWaiverForm(row);
        await row
          .getByLabel("I have this diver’s signed release on file", { exact: false })
          .filter({ visible: true })
          .check();
        await row.getByLabel("Parent or guardian who signed").fill("Lena Fischer");
        await row.getByLabel("Relationship").selectOption("parent");
        await row.getByRole("button", { name: "Record paper signature" }).click();
        await expect(row.getByText("The co-signer’s name is the diver’s own")).toBeVisible();
        // Still open, and carrying the field the message is about — the half
        // that needs the diver to be a minor.
        await expect(row.getByLabel("Parent or guardian who signed")).toBeVisible();
        // ...and the way through the refusal names, which only this refusal
        // draws (issue #1573).
        await expect(
          row.getByLabel("This co-signer and this diver have the same name", { exact: false }),
        ).toBeVisible();
        await capture(page, "trip-desk-waiver-refused", scheme);
      });

      /**
       * **A held seat's identity confirm, armed** (H-13, issue #1696).
       *
       * The desk's second blocking attestation, and the one shape nothing else
       * in this file photographs: `InlineConfirm`'s message mode replaces the
       * trigger with a bordered `role="alert"` block carrying a sentence and
       * two buttons, *inside* a blocked roster row that already holds a badge
       * and a reason. Since issue #1789 (H-79) the armed block also carries
       * the matched diver's last dive day here, or "No dive days here yet",
       * which `e2e/check-in.spec.ts` asserts. The unarmed half is `trip-guests-identity`, so the armed
       * state is the one worth a baseline here.
       *
       * Seeded through `/api/test/seed-trouble-states?identityHeld=1` rather
       * than into blue-mantis: the flag moves readiness, which the nav badges,
       * the close-out and every blocked count read (`.claude/rules/e2e.md`).
       * The route seats the diver through `seatDiver` with `fromNameMatch`, so
       * this is the row the walk-in door's own name prompt makes, on the
       * departure the route seated onto.
       */
      test(`a held seat's identity confirm renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?identityHeld=1");
        expect(seeded.ok()).toBe(true);
        const { identityHeld } = (await seeded.json()) as {
          identityHeld?: { diver: string; tripId: string };
        };
        if (!identityHeld) throw new Error("seed-trouble-states could not hold a seat");

        await page.goto(counterPath("blue-mantis", identityHeld.tripId));
        const row = page
          .locator('#roster li[id^="booking-"]')
          .filter({ visible: true })
          .filter({ has: page.getByRole("link", { name: identityHeld.diver, exact: true }) });
        await row.getByRole("button", { name: `Same person as ${identityHeld.diver}` }).click();
        // Armed, and waited on by the block the tap reveals rather than by the
        // trigger it replaces: the consequence sentence is the frame's subject.
        await expect(
          row.getByText(`Confirm this booking is ${identityHeld.diver}?`, { exact: false }),
        ).toBeVisible();
        await capture(page, "trip-desk-identity-held", scheme);
      });

      /**
       * **"Not here", open** (issue #1209) — the desk's script for the diver
       * who never turned up, under their row on the Divers tab.
       *
       * The one state of this surface no seeded day can hold. The door opens
       * when the boat leaves without the diver (`noShowGate`) and shuts when
       * the arrivals window does, and on the fleet's frozen 09:30 every seeded
       * departure is either hours out or already home — which is the whole
       * reason it went unphotographed when it shipped. So the flow sells the
       * seat on a boat that is still ahead, clears the release at the desk the
       * way a staffer does, and then sends the boat out without her
       * (`/api/test/depart-trip`, which moves the departure because the fleet's
       * clock cannot move).
       *
       * **Two frames, because the tap is two different claims**
       * (`noShowClaim`, src/lib/no-show.ts). Ten minutes out it is about a
       * seat the shop can still sell, and the door is three quiet words.
       * Ninety minutes out the boat is gone, the seat is worth nothing, and the
       * same tap records that the boat left without them — the one nobody
       * comes back to undo, because the diver is at sea or home. The door keeps
       * its two words either side (Aaron, 2026-10-06), and what the second
       * frame shows is the sentence behind it saying what that costs.
       *
       * What both frames are for is the restraint: the door sits *under* a
       * check-in tap that stays the only large target on the row, and behind it
       * one sentence and one button. The desk is used with wet hands on a
       * shared desk tablet, so a second control that grew to look like a peer
       * of that tap is exactly the regression these baselines catch.
       */
      test(`the counter's not-here door renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        // A departure, a sale and a release recorded before anything is shot.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const title = "Dock Call Two-Tank";
        await createTrip(page, {
          title,
          date: daysFromNow(0),
          // 09:45 against the frozen 09:30 (`e2e/servers.ts`): still ahead, so
          // the seat can be sold. The boat is sent out below. One seat, so the
          // frame holds one row rather than a queue.
          departsAt: "09:45",
          returnsAt: "12:00",
          capacity: 1,
        });
        const tripId = await seededTripId(page, "blue-mantis", title);

        // Odile Marchand is seeded carded and booked on nothing
        // (`src/db/seed-cert-gates.ts`), so she clears this trip's Open Water
        // baseline and arrives blocked on the release alone.
        await seatFromRoster(page, tripId, "Odile Marchand");

        // **The boat goes without her**, ten minutes ago: past the departure,
        // inside the hour a late boat is allowed, which is the seat half of
        // the door.
        const depart = async (minutesAgo: number) => {
          const moved = await request.post("/api/test/depart-trip", {
            data: { tripId, minutesAgo },
          });
          expect(moved.ok()).toBe(true);
        };
        await depart(10);

        await page.goto(counterPath("blue-mantis", tripId));
        const deskRow = () =>
          page
            .locator('#roster li[id^="booking-"]')
            .filter({ visible: true })
            .filter({ has: page.getByRole("link", { name: "Odile Marchand", exact: true }) });
        const row = deskRow();
        await openRosterDetails(row);
        await openPaperWaiverForm(row);
        await row
          .getByLabel("I have this diver’s signed release on file", { exact: false })
          .filter({ visible: true })
          .check();
        await row.getByRole("button", { name: "Record paper signature" }).click();
        // Cleared in place, which is what puts the door on the row: it is
        // offered under a ready row's check-in tap and nowhere else.
        await expect(row.getByRole("button", { name: "Check in Odile Marchand" })).toBeVisible();

        const door = row
          .locator("details")
          .filter({ has: page.getByText("Not here", { exact: true }) });
        await door.locator("> summary").click();
        // The body animates in, so `open` flipping is not the frame it is laid
        // out in — waited on the arrival's end state, never a duration.
        await disclosureSettled(door);
        await capture(page, "trip-desk-no-show", scheme);

        // **The same row once the boat is really gone.** Ninety minutes past
        // its departure the seat is worth nothing and the tap has stopped
        // being about one: the door asks the other question and says what it
        // costs the diver. Nothing else about the row moves, which is the
        // comparison this second frame is for.
        await depart(90);
        await page.goto(counterPath("blue-mantis", tripId));
        const sailedRow = deskRow();
        const sailedDoor = sailedRow
          .locator("details")
          .filter({ has: page.getByText("Not here", { exact: true }) });
        // Hydrated before the tap, not after: this frame opens the door
        // straight off a page load, and a summary tapped while the page is
        // still the server's markup did not stay open on CI or locally. The
        // first frame reached its door through the release form, which only
        // answers once the page is live.
        await expect(page.locator("[data-check-in-queue]")).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await sailedDoor.locator("> summary").click();
        await disclosureSettled(sailedDoor);
        await capture(page, "trip-desk-no-show-sailed", scheme);
      });

      /**
       * **"Turned away", open and then recorded** (safety sheet 2026-10-15,
       * item 6; H-135). Open before the boat leaves, so no departure move:
       * Odile arrives blocked on the release, the door offers that reason
       * alone, and the recorded row says it in its own group with the move and
       * refund doors under it.
       */
      test(`the counter's turned-away door renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const title = "Turned Away Two-Tank";
        await createTrip(page, {
          title,
          date: daysFromNow(0),
          departsAt: "09:45",
          returnsAt: "12:00",
          capacity: 1,
        });
        const tripId = await seededTripId(page, "blue-mantis", title);
        await seatFromRoster(page, tripId, "Odile Marchand");

        await page.goto(counterPath("blue-mantis", tripId));
        await expect(page.locator("[data-check-in-queue]")).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        const row = page
          .locator('#roster li[id^="booking-"]')
          .filter({ visible: true })
          .filter({ has: page.getByRole("link", { name: "Odile Marchand", exact: true }) });
        await row.getByRole("button", { name: "Turn away", exact: true }).click();
        await expect(row.getByRole("button", { name: "Turn Odile Marchand away" })).toBeVisible();
        await capture(page, "trip-desk-turn-away", scheme);

        await row.getByRole("button", { name: "Turn Odile Marchand away" }).click();
        await expect(page.getByRole("heading", { name: "Turned away · 1" })).toBeVisible();
        await capture(page, "trip-desk-turned-away", scheme);
      });

      // **The home's evening reading** (ADR
      // 20260827-clearwater-surface-language, decision 4). The surface to
      // photograph is the shop home once every station has settled: the
      // closing stations with their marks and head counts, and the day's
      // takings beneath them.
      //
      // `seed-evening` moves the demo day's departures behind the frozen clock
      // rather than moving the clock, which is one process-wide value shared
      // by the server, the seed and the browser (`e2e/servers.ts`).
      test(`the home's evening renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        // A seed write and a full-page shot.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await request.post("/api/test/seed-evening");
        await page.goto("/shop/blue-mantis");
        await page.getByRole("region", { name: "What today made" }).waitFor();
        await capture(page, "today-evening", scheme);
      });

      // **The evening after the counting** — the same page one act further on,
      // and the only surface in the product that reaches `spine.allHome`.
      //
      // The spine spends one coral element a day (ADR
      // 20260901-diveday-reimagined, decision 1) and the evening's own moment
      // outranks the morning's, so this line is what that budget is *for*: a
      // shop sees it once, when every boat is back and every head count is
      // closed. `assembleEveningClose` refuses to say it on arithmetic —
      // every station's status has to be `all_home` — so the seed has to do
      // the counting, which is what `?heads=closed` added (issue #1122).
      //
      // A second capture rather than a change to `today-evening`, because the
      // uncounted evening above is a real state a shop meets every day at six
      // and photographing only the resolved one would lose it. The two differ
      // by exactly one line, which is the point: this is the only baseline
      // that can catch the coral moment moving.
      test(`the evening's all-home moment renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        // A seed write that closes every count on the day, then a full-page shot.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await request.post("/api/test/seed-evening?heads=closed");
        await page.goto("/shop/blue-mantis");
        // The moment itself, waited on by its own words: a shot taken before
        // it renders would be `today-evening` under a second name, and the
        // baseline would agree with it forever.
        await page.getByText(/^All boats are home:/).waitFor();
        await capture(page, "today-all-home", scheme);
      });

      // Staffing as a week (ADR 20260827-the-shops-shelves, decision 3):
      // people down the side, seven shop-local days across the top, shifts as
      // quiet chips, credentials as a ledger beneath. The demo's own week,
      // which carries no gap row: the DOM-M3 charter (`seed-trips.ts`) sails
      // the week after, and the gap is photographed below on purpose.
      // Its 390 image is the day list, which is what the week collapses to
      // below `lg` (the same call H-63 made for the board).
      test(`the staffing week renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/staffing");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await capture(page, "staffing", scheme);
      });

      // The pager off the current week, which is the only state that draws
      // "This week" beside the arrows (#1982): at 390 the row wraps and the
      // link takes a line of its own at `md`. The board photographs its own
      // pager in this state (`schedule-builder-asked`); nothing photographed
      // the staffing week's until this.
      test(`the staffing week pages off the current week (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/staffing?week=2026-07-27");
        await page.getByRole("link", { name: "This week" }).waitFor();
        await capture(page, "staffing-week-next", scheme);
      });

      // **Lost and found** (batch 4, J2): one item the crew wrote down on the
      // dawn boat's Boat tab, on the shop's open list with its departure and
      // its three doors. Recorded through the form, as a crew would.
      test(`lost and found lists what crews found aboard (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", SAILED_TRIP);
        await page.goto(`/shop/blue-mantis/trips/${tripId}/manifest`);
        const form = page.getByTestId("lost-item-form");
        await form.getByLabel("What was found").fill("Blue mask in a black case");
        await form.getByRole("button", { name: "Record" }).click();
        await page.getByTestId("lost-item").first().waitFor();
        await page.goto("/shop/blue-mantis/lost-found");
        await page.getByTestId("lost-item").first().waitFor();
        await capture(page, "lost-found", scheme);
      });

      /**
       * A second, louder day: a departure the shop *had* crewed and no longer
       * has, rendering in its own day cell with the warning word and the
       * Assign door beside it. It is not seeded into blue-mantis — a demo
       * permanently short-handed is a worse demo, the same call
       * `seed-front-desk.ts` makes about its `succeeded` payment — so it comes
       * from `/api/test/seed-trouble-states?crewGap=1`, opt-in because pulling
       * a crew off a boat moves Today's queue and every crew count in the
       * fleet.
       */
      test(`the staffing week carries a crew gap in its day (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?crewGap=1");
        await page.goto("/shop/blue-mantis/staffing");
        // The destination's own words, not a timing guess.
        await page.getByText("No divemaster").first().waitFor();
        await capture(page, "staffing-week-gap", scheme);
      });

      /**
       * **A crew clash standing in the week** (issue #1695): one divemaster on
       * two hulls at the same hours, drawn on the day it falls, naming the
       * other boat.
       *
       * The state is not seeded into blue-mantis and cannot be: `setTripCrew`
       * and `changeTripCrew` both refuse to write an overlap, so the only door
       * into it is `moveTrip` — `?crewClash=1` slides one seeded departure onto
       * another through that very mutation and hands back the day it landed on.
       * Opt-in because moving a departure moves the board, Today's queue and
       * every subscribed calendar with it.
       *
       * A baseline of its own rather than a change to `staffing` above: the
       * healthy week is the state a shop sees every day, and photographing only
       * the broken one would lose it.
       */
      test(`the staffing week carries a standing crew clash (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?crewClash=1");
        expect(seeded.ok()).toBe(true);
        const { crewClash } = (await seeded.json()) as {
          crewClash?: { tripId: string; otherTitle: string; date: string };
        };
        if (!crewClash) throw new Error("seed-trouble-states found no two departures to clash");

        // `?week=` snaps any date to its own Monday (`resolveWeekStart`), so
        // the day the boat landed on is enough to ask for the week holding it.
        await page.goto(`/shop/blue-mantis/staffing?week=${crewClash.date}`);
        // The destination's own words, not a timing guess.
        await page
          .getByText(/^Also rostered on /)
          .first()
          .waitFor();
        await capture(page, "staffing-week-crew-clash", scheme);
      });
    });
  });
}
