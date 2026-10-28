/**
 * Visual captures: a departure: the Trip surface, the deal panel, the manifest, the departure log, incidents and the prep list.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  counterPath,
  createTrip,
  daysFromNow,
  manifestRow,
  offlineCopySaved,
  openBoatCheck,
  openPaperWaiverForm,
  openRosterDetails,
  openTripAbout,
  openTripAboutRow,
  openTripFromBoard,
  openTripTab,
  seatFromRoster,
  seededTripId,
} from "./helpers";
import {
  capture,
  deepDiverLogPath,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  MINIMUM_SEATS_TRIP,
  openReefTrip,
  REEF_TRIP,
  SURFACE_TIMEOUT_MS,
  staffCopy,
  VISUAL_STEP_BOUNDS,
  waitForHashLanding,
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

      // The seeded reef trip's three surfaces — Trip (what the departure is and
      // who is coming), Manifest (the day-of boarding + roll call), and Prep
      // (the morning packing list). They share a layout that streams a
      // skeleton while the page's data loads, so every capture waits for real
      // content — never the loading fallback — before shooting. One test each:
      // they used to be four consecutive stops on one tour, which meant a
      // renamed heading on Trip cost the manifest its baseline too.
      test(`a trip's Trip surface renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
        await capture(page, "trip-manage", scheme);
      });

      test(`the plan editor stays with the dive plan (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        const plan = await openTripAboutRow(page, "The plan");
        await expect(plan.getByLabel("Number of dives")).toBeVisible();
        await capture(page, "departure-plan-editor", scheme);
      });

      test(`meeting point keeps optional arrival guidance disclosed (${scheme})`, async ({
        page,
      }) => {
        await openReefTrip(page);
        const meeting = await openTripAboutRow(page, "Where we meet");
        await expect(meeting.locator('[name="meetingPointLabel"]')).toBeVisible();
        await capture(page, "departure-meeting-editor", scheme);
      });

      test(`timing has its own explicit save (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        const timing = await openTripAboutRow(page, "Timing");
        await expect(timing.getByLabel("Departs")).toBeVisible();
        await capture(page, "departure-timing-editor", scheme);
      });

      test(`booking and payment has its own explicit save (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        const booking = await openTripAboutRow(page, "Booking and payment");
        await expect(booking.locator('[name="capacity"]')).toBeVisible();
        await capture(page, "departure-booking-editor", scheme);
      });

      test(`departure details keeps title description and tag together (${scheme})`, async ({
        page,
      }) => {
        await openReefTrip(page);
        const details = await openTripAboutRow(page, "Departure details");
        await expect(details.getByLabel("Title", { exact: true })).toBeVisible();
        await capture(page, "departure-details-editor", scheme);
      });

      test(`boat assignment edits beside its crew (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        const crew = await openTripAboutRow(page, "Boat & crew");
        await crew.getByText("Edit boat", { exact: true }).click();
        await expect(crew.locator('[name="boatId"]')).toBeVisible();
        await capture(page, "departure-boat-editor", scheme);
      });

      /**
       * **The Crew panel with a clash on one of its rows** (issue #1695) — a
       * warning line inside a roster row, which is the one place on this
       * surface a sentence has to sit under a name without pushing the row's
       * own controls off the end of it.
       *
       * Photographed through `?crewClash=1` rather than seeded: the overlap is
       * a state the roster refuses to write, so the seed reaches it the way a
       * shop does, by moving one departure onto another. The About disclosure
       * holds the Crew panel, so it is opened before the shot the way every
       * other panel inside it is.
       */
      test(`a departure's crew panel carries a standing clash (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?crewClash=1");
        expect(seeded.ok()).toBe(true);
        const { crewClash } = (await seeded.json()) as {
          crewClash?: { tripId: string; otherTitle: string; date: string };
        };
        if (!crewClash) throw new Error("seed-trouble-states found no two departures to clash");

        await page.goto(`/shop/blue-mantis/trips/${crewClash.tripId}`);
        await openTripAbout(page);
        await page
          .locator("#crew")
          .getByText(/^Also rostered on /)
          .first()
          .waitFor();
        await capture(page, "trip-crew-clash", scheme);
      });

      /**
       * The other Overview: a departure that only runs with enough people and
       * has not got them yet (ADR 20260813-minimum-head-count-departures). The
       * reef trip above names no minimum, so its baseline can never show this
       * band — and the band is the one surface in the feature a shop reads
       * every day, in the window where ringing round the regulars still saves
       * the departure. The fixture is seeded four days out with a 48-hour
       * window (src/db/seed-minimum-seats.ts), so against the fleet's frozen
       * clock it photographs the *short* state, not the red about-to-cancel
       * one — deliberately, since short is the state staff can act on.
       */
      test(`a short departure shows its minimum head count (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, MINIMUM_SEATS_TRIP);
        await page.getByRole("heading", { name: /divers short of the/ }).waitFor();
        await capture(page, "trip-minimum-seats", scheme);
      });

      /**
       * **A cancelled departure, from the staff side.** The band that says so
       * and offers Reinstate and the cascade is a tone panel on the card's
       * geometry (`TONE_PANEL_CLASS`), and nothing had ever photographed it:
       * no seeded departure is cancelled, so neither the visual run nor the
       * pixel probe had looked at it. Reached the way a shop reaches it, by
       * calling a blow-out on the seeded reef trip (safe: the per-test reset
       * restores it), then opening the departure.
       */
      test(`a canceled departure shows its reinstate band (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/schedule/blowout/${tripId}`);
        await page.getByRole("button", { name: "Call the blow-out" }).click();
        await page.getByRole("heading", { level: 1, name: "Cancellation record" }).waitFor();
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await page.getByRole("button", { name: "Reinstate trip" }).waitFor();
        await page
          .getByRole("link", {
            name: staffTranslator("en-US")("trips.detail.viewBlowout", { cause: "weather" }),
            exact: true,
          })
          .waitFor();
        // Nobody can be offered a seat on a cancelled departure.
        await expect(page.getByRole("heading", { name: /Who wants in/ })).toHaveCount(0);
        await capture(page, "trip-cancelled", scheme);
      });

      test(`a trip's Trip roster renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Trip");
        await page.locator("#roster").waitFor();
        await page.locator("#add-diver").waitFor();
        await capture(page, "trip-guests", scheme);
      });

      /**
       * **The list, before the send** (FU-20260813,
       * ADR 20260814-self-declared-cards).
       *
       * `trip-guests` above can never show this: the "Who wants in" panel renders nothing at all until somebody is
       * on the shop's last-minute list. What it photographs is the one thing
       * standing between a shop and a discount emailed to a diver who cannot
       * board — the recipient's level, marked self-declared, in the row above
       * the send button. If that mark ever stops reading as weaker than a
       * certified card, this is the baseline that catches it; nothing else in
       * the suite looks at the two treatments side by side.
       *
       * Seeded through the real public form rather than a fixture, because the
       * claim's whole journey — anonymous post to staff panel — is the thing
       * under test. Safe to mutate: each worker owns its own database and
       * resets before every test (e2e/servers.ts).
       */
      test(`the deal panel shows who it would reach (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/s/blue-mantis");
        const dealList = page.locator("#last-minute-list");
        await dealList.locator("summary").click();
        await dealList.getByLabel("Name").fill("Tess Alvarez");
        await dealList.getByLabel("Email").fill("tess.visual@example.com");
        await dealList.getByLabel("Certification level").selectOption("open_water");
        await expect(dealList.getByLabel("I’m certified for nitrox (enriched air)")).toHaveCount(0);
        await page
          .locator('input[name="availableFrom"]')
          .filter({ visible: true })
          .fill("2020-01-01");
        await page.getByRole("button", { name: "Notify me" }).click();
        await page.getByRole("heading", { name: "You’re on the list" }).waitFor();

        // Already signed in: `signedInAsOwner()` is describe-scoped over this
        // block, which is also why the public form above renders with the staff
        // preview bar. Neither affects the surface being photographed.
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        // The Divers tab's "Who wants in" panel is where the list is offered a seat.
        await page.goto(`/shop/blue-mantis/trips/${tripId}#who-wants-in`);
        await page.getByText("Open Water — unverified").waitFor();
        await waitForHashLanding(page);
        await capture(page, "trip-guests-deal-recipients", scheme);
      });

      /**
       * **The same panel when nobody is eligible.**
       *
       * The reef departure is raised to Rescue first — the highest rung a trip
       * may demand since #630 capped requirements at the recreational ladder
       * (`REQUIRABLE_CERTIFICATION_LEVELS`, src/lib/readiness.ts). The newly
       * added no-certification and Open Water joiners are then filtered out of
       * the send list instead of being shown with a warning that could be
       * overlooked.
       */
      test(`the deal panel weighs the list against the bar (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const join = async (name: string, email: string, level?: string) => {
          await page.goto("/s/blue-mantis");
          const dealList = page.locator("#last-minute-list");
          await dealList.locator("summary").click();
          await dealList.getByLabel("Name").fill(name);
          await dealList.getByLabel("Email").fill(email);
          if (level) await dealList.getByLabel("Certification level").selectOption(level);
          await page
            .locator('input[name="availableFrom"]')
            .filter({ visible: true })
            .fill("2020-01-01");
          await page.getByRole("button", { name: "Notify me" }).click();
          await page.getByRole("heading", { name: "You’re on the list" }).waitFor();
        };
        // The optional question, skipped — the common answer on a marketing
        // opt-in, and the one a shop can weigh least.
        await join("Wes Toledo", "wes.visual@example.com");
        await join("Tess Alvarez", "tess.visual@example.com", "open_water");

        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await openTripAbout(page);
        await openTripAboutRow(page, "Who can book");
        await page.getByLabel("Minimum certification").selectOption("rescue");
        await page.getByRole("button", { name: "Save requirements" }).click();
        // Raising the bar mid-season strands the divers already booked under
        // the old one, so the save answers with its warning variant ("8 booked
        // divers no longer meet them") rather than the plain confirmation.
        // Matching the stem keeps this test about the deal panel.
        await expect(page.getByRole("status")).toContainText("Requirements updated.");

        // The save lands on Details; the deal panel and the wait list are on Divers.
        await openTripTab(page, "Trip");
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        // Nobody on the list clears the Rescue bar, so the panel is not drawn at all.
        await page.locator("#roster").waitFor();
        await expect(page.locator("#who-wants-in")).toHaveCount(0);
        await capture(page, "trip-guests-deal-below-requirement", scheme);
      });

      /**
       * **The same panel with nobody's help — the demo shop exactly as it is
       * seeded** (FU-20260815-no-seeded-diver-ever-declared-anything).
       *
       * The two captures above each drive the public form first, so what they
       * photograph is a claim this test just made. Until 2026-08-15 that was the
       * *only* way any of these marks had ever been rendered outside jsdom: no
       * seeded diver had declared anything, so every name on blue-mantis's
       * last-minute list read "Level not said" — the one branch that carries no
       * mark and no tone — and a shop clicking through the demo saw a clean list
       * where a real one has two rows worth pausing over.
       *
       * `src/db/seed-self-declared.ts` puts them there, and this is the baseline
       * that proves the eligible declaration arrives: Rowan Feld's level and
       * enriched-air claims each carry their own unconfirmed mark. Selah Mbeki,
       * who has no certification declaration, is correctly absent from the
       * send list.
       *
       * The deal is sent from the Divers tab's Who wants in panel now (H-145
       * D-3), whose "Around these dates" group lists only who fits the
       * departure (dive-domain review of #2656, m1). The night charter asks for
       * a Night card nobody on the list holds, so this pins the shallow
       * Christ of the Abyss reef a week out: an Open Water bar and no specialty,
       * inside Rowan's window, so her claim arrives with its mark.
       */
      test(`the deal panel carries the demo's own declarations (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(
          page,
          "blue-mantis",
          "Two-Tank Reef — Christ of the Abyss",
        );
        await page.goto(`/shop/blue-mantis/trips/${tripId}#who-wants-in`);
        // Both seeded joiners now read unverified (#2428: a staff-typed card
        // nobody checked is not vouched for), so wait on the first of them.
        await page
          .getByText(/Open Water — unverified/)
          .first()
          .waitFor();
        await waitForHashLanding(page);
        await capture(page, "trip-guests-deal-seeded", scheme);
      });

      /**
       * **The other list on the same page, and the first baseline it has ever
       * had** (ADR 20260814-self-declared-cards, the 2026-08-15 amendment).
       *
       * The wait list renders only when somebody is on it, so `trip-guests`
       * above — pinned to the reef morning — can never show it. The seeded
       * wait-lister is on the Pickles Reef charter and holds a **verified** Open
       * Water card, which is exactly the row worth photographing once the
       * departure is raised to Advanced Open Water: calm, muted, nobody's claim
       * in doubt, and under the bar. The tone is the deal panel's answer to "has
       * anybody seen this card?" and must stay that; if it ever warms here, this
       * is the baseline that catches it.
       *
       * The tick beside the name is in the frame deliberately. Nothing
       * about this mark filters the list, reorders it, or disables the tick —
       * a wait list is interests in the order they asked (ADR
       * 20260813-wait-list-is-a-lead-list) and informing the staffer is the whole
       * design.
       */
      test(`the wait list weighs a lead against the bar (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Pickles Reef");
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await openTripAbout(page);
        await openTripAboutRow(page, "Who can book");
        await page.getByLabel("Minimum certification").selectOption("advanced_open_water");
        await page.getByRole("button", { name: "Save requirements" }).click();
        // Raising the bar on a seated charter answers with the warning variant
        // ("… booked divers no longer meet them"); matching the stem keeps this
        // test about the wait list.
        await expect(page.getByRole("status")).toContainText("Requirements updated.");

        // The save lands on Details; the deal panel and the wait list are on Divers.
        await openTripTab(page, "Trip");
        await page.goto(`/shop/blue-mantis/trips/${tripId}#who-wants-in`);
        // Scoped to the ledger: the deal panel further down the same page
        // renders the identical phrase for its own recipients, and this test is
        // about the list that was still silent until now. (`#who-wants-in` is the
        // panel that holds the rows, so the roster is still the narrowest honest scope.)
        await page
          .locator("#roster")
          .getByText("Open Water · below this departure’s minimum")
          .waitFor();
        await waitForHashLanding(page);
        await capture(page, "trip-guests-waitlist", scheme);
      });

      test(`a trip's manifest renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
        // The offline safety copy now saves itself in the background on
        // mount; wait for that to settle (the offline-roll-call link only
        // renders once saved) so the capture isn't racing that async write.
        await offlineCopySaved(page);
        // The push opt-in and the boat-mode control both decide what to render
        // *after* mount, and both now live inside the collapsed "On this phone"
        // group (ADR 20260827-the-departure-is-two-working-surfaces, decision
        // 2) — so neither can change this capture's picture, and waiting on
        // them would only be waiting. The freshness pill above is the one piece
        // of that group's state on the summary line, and it is what this shot
        // must not race.
        await capture(page, "manifest", scheme);
      });

      /**
       * **A snag carried to the boat's next crew** (fifth-loop ideas, item 1):
       * the reef boat's crew notes a problem against an item, and the night
       * dive, that hull's next departure, opens with it above the boat check,
       * with Fixed and Still there.
       */
      test(`a manifest carries an earlier crew's snag (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await openBoatCheck(page);
        const radio = page
          .getByRole("listitem")
          .filter({ has: page.getByRole("button", { name: "VHF radio checked" }) });
        // One "Note a problem" for the list, with an item picker (B07).
        await page.getByText("Note a problem").click();
        await page.getByLabel("Which item?").selectOption({ label: "VHF radio checked" });
        await page.getByLabel("What’s wrong?").fill("VHF crackles on 16");
        await page.getByRole("button", { name: "Save note" }).click();
        await radio.getByText("VHF crackles on 16").waitFor();
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, "Night Dive — City of Washington");
        await openTripTab(page, "Manifest");
        await page.getByRole("region", { name: "Open on this boat" }).waitFor();
        await offlineCopySaved(page);
        await capture(page, "manifest-snag-carried", scheme);
      });

      /**
       * **What the boat carries, and what it holds** (roadmap N-08, N-10): the
       * reef boat with one passenger past its certificate, its insurance three
       * weeks out, flares expired, AED pads twelve days from expiry and the
       * shop's O2 kit left ashore —
       * through the opt-in `?boatSafety=1` trouble state, never seeded into
       * blue-mantis. The panel above the boat check is the one surface that
       * says all of it.
       */
      test(`a manifest names the boat's lapsing kit and papers (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?boatSafety=1");
        expect(seeded.ok()).toBe(true);
        const { boatSafety } = (await seeded.json()) as { boatSafety?: { tripId: string } };
        if (!boatSafety) throw new Error("seed-trouble-states found no reef departure on a boat");
        await page.goto(`/shop/blue-mantis/trips/${boatSafety.tripId}/manifest`);
        await page
          .getByRole("heading", { level: 2, name: "Mantis I: papers and safety kit" })
          .waitFor();
        await offlineCopySaved(page);
        await capture(page, "manifest-boat-safety", scheme);
      });

      /**
       * **A rehearsal says so above the departure** (ADR
       * 20261012-rehearsal-departures), through the opt-in `?rehearsal=1`
       * state: a training-day departure with one test diver.
       */
      test(`a rehearsal's trip page carries its banner (${scheme})`, async ({ page, request }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?rehearsal=1");
        expect(seeded.ok()).toBe(true);
        const { rehearsal } = (await seeded.json()) as { rehearsal?: { tripId: string } };
        if (!rehearsal) throw new Error("seed-trouble-states could not put a rehearsal on");
        await page.goto(`/shop/blue-mantis/trips/${rehearsal.tripId}`);
        await page.locator("[data-rehearsal-banner]").waitFor();
        await page.getByRole("navigation", { name: "Departure" }).waitFor();
        await capture(page, "trip-rehearsal", scheme);
      });

      /**
       * **A rehearsal on the week board and on Today** (issue #2570, #2395):
       * the same opt-in `?rehearsal=1` departure, tomorrow, wearing its
       * "Rehearsal" badge where the week reads it. Today keeps tomorrow behind
       * a fold, opened before the shot.
       */
      test(`the week board carries a rehearsal's badge (${scheme})`, async ({ page, request }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?rehearsal=1");
        expect(seeded.ok()).toBe(true);
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await page.getByText("Training day drill").filter({ visible: true }).first().waitFor();
        await page
          .getByText("Rehearsal", { exact: true })
          .filter({ visible: true })
          .first()
          .waitFor();
        await capture(page, "schedule-builder-rehearsal", scheme);
      });

      test(`Today lists a rehearsal tomorrow with its badge (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?rehearsal=1");
        expect(seeded.ok()).toBe(true);
        await page.goto("/shop/blue-mantis");
        await page
          .locator("summary")
          .filter({ hasText: /^Tomorrow · / })
          .first()
          .click();
        await page.getByText("Training day drill").filter({ visible: true }).first().waitFor();
        await page
          .getByText("Rehearsal", { exact: true })
          .filter({ visible: true })
          .first()
          .waitFor();
        await capture(page, "today-rehearsal", scheme);
      });

      /**
       * **A crew member another boat also claims, said once** (issue #2217,
       * PR #2202). At the dock the Boat tab says the instruction once above
       * the crew list and each clashing row reads only "Also rostered on …
       * at these hours." Through `?crewClash=1`, the one door into the state
       * the roster refuses to write.
       */
      test(`a manifest names a crew member rostered on another boat (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?crewClash=1");
        expect(seeded.ok()).toBe(true);
        const { crewClash } = (await seeded.json()) as { crewClash?: { tripId: string } };
        if (!crewClash) throw new Error("seed-trouble-states found no two departures to clash");
        await page.goto(`/shop/blue-mantis/trips/${crewClash.tripId}/manifest`);
        // The destination's own words, not a timing guess.
        await page
          .getByText(/^Also rostered on /)
          .first()
          .waitFor();
        await offlineCopySaved(page);
        await capture(page, "manifest-crew-clash", scheme);
      });

      /**
       * **A blocked diver the crew marked aboard** (issue #2217, PR #2202):
       * the head count's "1 blocked person aboard" line at the dock. Through
       * `?blockedAboard=1`, which boards a diver the app was happy to board
       * and then supersedes their release — the order it happens in a shop,
       * since the boarding gate refuses the other.
       */
      test(`a manifest counts a blocked diver aboard (${scheme})`, async ({ page, request }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?blockedAboard=1");
        expect(seeded.ok()).toBe(true);
        const { blockedAboard } = (await seeded.json()) as { blockedAboard?: { tripId: string } };
        if (!blockedAboard) throw new Error("seed-trouble-states boarded nobody to block");
        await page.goto(`/shop/blue-mantis/trips/${blockedAboard.tripId}/manifest`);
        await page.getByText("1 blocked person aboard").first().waitFor();
        await offlineCopySaved(page);
        await capture(page, "manifest-blocked-aboard", scheme);
      });

      /**
       * **The same manifest with one seat released** (#1209,
       * `dive-domain-expert` review 20260911).
       *
       * The capture above is a boat nobody has written anybody off on, which
       * is every seeded departure: the counter's door only opens once a boat
       * has left without the diver, so the state that needs photographing
       * cannot be reached without making a departure whose time has just
       * passed. The flow is the desk's own — seat the diver, clear their
       * release, tap the door on the Divers tab —
       * and then walks to the rail, which is where the pixels under test are.
       *
       * What the frame is for is the restraint. A released seat is the absence
       * of an exception, not one, so the row wears a plain neutral chip beside
       * the name and keeps its boarding tap: nothing here refuses a body the
       * crew can see. A future session that reaches for a warning tone, or
       * moves the word into the person sheet where it costs a tap, has a
       * baseline to argue with. The count above it is in frame for the other
       * half of the same fix — the head count's denominator drops the seat,
       * so the figure is bodies to expect rather than rows on paper.
       */
      test(`a manifest with a released seat renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // A departure, a sale and a release recorded before anything is shot.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const title = "Dock Call Reef Manifest";
        await createTrip(page, {
          title,
          date: daysFromNow(0),
          // 09:00 against the frozen 09:30 (`e2e/servers.ts`): half an hour
          // past its departure, which is the window the door opens in, and
          // still inside the hour a late boat is allowed, so the walk-in can
          // seat these two. Two seats, because the frame is about the *contrast*: a boat
          // of one released diver photographs the chip and a head count with
          // nobody left to expect, which is not the row a crew reads.
          departsAt: "09:00",
          returnsAt: "12:00",
          capacity: 2,
        });
        const tripId = await seededTripId(page, "blue-mantis", title);

        // Odile Marchand and Hana Kobayashi are both seeded booked on nothing
        // (`src/db/seed-cert-gates.ts`, `src/db/seed-cast.ts`), so seating
        // them here flips no other departure's manifest, readiness or queue.
        const seat = async (name: string) => {
          await seatFromRoster(page, tripId, name);
        };
        await seat("Odile Marchand");
        await seat("Hana Kobayashi");

        // Both cleared the same way a staffer does, so neither row wears a
        // blocker that would compete with the one chip under test.
        await page.goto(counterPath("blue-mantis", tripId));
        const counterRow = (name: string) =>
          page
            .locator('#roster li[id^="booking-"]')
            .filter({ visible: true })
            .filter({ has: page.getByRole("link", { name, exact: true }) });
        for (const name of ["Odile Marchand", "Hana Kobayashi"]) {
          const row = counterRow(name);
          await openRosterDetails(row);
          await openPaperWaiverForm(row);
          await row
            .getByLabel("I have this diver’s signed release on file", { exact: false })
            .filter({ visible: true })
            .check();
          await row.getByRole("button", { name: "Record paper signature" }).click();
          await expect(row.getByRole("button", { name: `Check in ${name}` })).toBeVisible();
        }

        const odile = counterRow("Odile Marchand");
        await openRosterDetails(odile);
        await odile.getByText("Not here", { exact: true }).click();
        await expect(odile.getByText(staffCopy("checkIn.noShow.consequence"))).toBeVisible();
        await odile.getByRole("button", { name: "Mark Odile Marchand as not here" }).click();
        await expect(page.getByRole("heading", { name: "Not here · 1" })).toBeVisible();

        await page.goto(`/shop/blue-mantis/trips/${tripId}/manifest`);
        await page.getByRole("heading", { level: 1, name: new RegExp(title) }).waitFor();
        // The chip itself, waited on rather than assumed: this capture is
        // worthless if it photographs the manifest a moment before the row
        // says anything.
        await expect(manifestRow(page, "Odile Marchand").getByText("Not here")).toBeVisible();
        // The same background save the capture above waits out.
        await offlineCopySaved(page);
        await capture(page, "manifest-not-here", scheme);
      });

      // The departure log: the hand-to-authorities document of the
      // departure's recorded facts (roster with roll-call state, evidence and
      // waiver status, timeline, integrity code). Captured on the seeded reef
      // trip before any roll call, so the baseline shows the stated-absence
      // rendering — "Awaiting" cells, an explicitly empty timeline — which is
      // exactly the state that must never read as a blank on this document.
      test(`a trip's departure log renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        const tripPath = new URL(page.url()).pathname;
        await page.goto(`${tripPath}/log`);
        await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
        await capture(page, "departure-log", scheme);
      });

      // A fresh incident report, opened from the departure's Details tab (ADR
      // 20261012-incident-reports): the draft's three cards, every yes/no
      // unanswered rather than defaulted to "no", the people list, and the
      // filing card naming what a report needs before it can be filed.
      test(`a new incident report renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripAbout(page);
        await page
          .getByRole("region", { name: "Incident reports" })
          .getByRole("button", { name: "Report an incident" })
          .click();
        await page.waitForURL(/\/incidents\/[0-9a-f-]+$/);
        await page.getByRole("region", { name: "File the report" }).waitFor();
        await capture(page, "incident-report-draft", scheme);
      });

      // The one Today line an unfiled report leaves for owners and managers
      // (safety sheet 2026-10-15, item 3): how many, who started the oldest,
      // and when, opening the draft. Started here, so the seed stays clean.
      test(`an unfiled incident report is one line on Today (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripAbout(page);
        await page
          .getByRole("region", { name: "Incident reports" })
          .getByRole("button", { name: "Report an incident" })
          .click();
        await page.waitForURL(/\/incidents\/[0-9a-f-]+$/);
        await page.goto("/shop/blue-mantis");
        await page.getByText(/1 incident report not filed, started today by /).waitFor();
        await capture(page, "today-incident-unfiled", scheme);
      });

      // The log's last section with a report on it (safety sheet 2026-10-15,
      // item 5): an unfiled draft says so and who started it, and links to it.
      test(`the departure log lists its incident reports (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        const tripPath = new URL(page.url()).pathname;
        await openTripAbout(page);
        await page
          .getByRole("region", { name: "Incident reports" })
          .getByRole("button", { name: "Report an incident" })
          .click();
        await page.waitForURL(/\/incidents\/[0-9a-f-]+$/);
        await page.goto(`${tripPath}/log`);
        const section = page.locator("section", {
          has: page.getByRole("heading", { name: "Incident reports" }),
        });
        await section.getByText(/^Draft not filed, started by /).waitFor();
        await section.scrollIntoViewIfNeeded();
        await capture(page, "departure-log-incident-reports", scheme);
      });

      // The month's Safety page, its own destination: roll calls, dock marks, card
      // checks written past, crew credentials and the month's incident
      // reports, read from what the shop already records.
      test(`the Safety tab renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/safety");
        await page.getByRole("heading", { level: 1, name: "Safety" }).waitFor();
        await page.getByRole("region", { name: "This month’s safety record" }).waitFor();
        await capture(page, "reports-safety", scheme);
      });

      // The year the insurer renews on (fifth loop, item 33): the same figures
      // over the whole year, one printable page for the broker.
      test(`the Safety year renders true to the design (${scheme})`, async ({ page }) => {
        // Reached by its own link, so the year is the server clock's, not the runner's.
        await page.goto("/shop/blue-mantis/safety");
        await page.getByRole("link", { name: "Year view", exact: true }).click();
        await page.waitForURL(/\?year=\d{4}$/);
        await page.getByRole("button", { name: "Print the year" }).waitFor();
        await capture(page, "reports-safety-year", scheme);
      });

      // The same document at its widest. The roster and crew tables are three
      // columns plus one per roll-call checkpoint, and a checkpoint is a dive,
      // so the reef trip's two dives photograph six columns and nothing in this
      // suite had ever looked at more. Four dives is the ceiling the schedule
      // form and the `trips_planned_dives_range` check constraint both enforce,
      // and it is eight columns — the case issue #1052 widened the floor for.
      // Captured at the portrait tablet as well (`TABLET_SURFACES`), because
      // that width is where issue #1035 found the crush this inherits.
      test(`a departure log at every checkpoint renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto(await deepDiverLogPath(page));
        await page.getByRole("heading", { name: "Roll-call timeline" }).waitFor();
        await capture(page, "departure-log-every-checkpoint", scheme);
      });

      // Blue Mantis fills nitrox, so the Tanks tile grid is at its full
      // Total/Air/Nitrox width; the collapsed single-tile layout for a shop that
      // doesn't is its own test below.
      test(`a trip's prep list renders true to the design (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Prep");
        await page.getByRole("heading", { name: "Tanks" }).waitFor();
        await capture(page, "prep", scheme);
      });

      // The same packing list read down the roster instead of down the rack:
      // one row per diver with their pieces, including the divers who have
      // nothing to pull. Reached through the switch itself rather than a typed
      // `?group=diver`, so the capture also proves the control sits where a
      // packer would look for it and that the flip keeps the page in place.
      test(`a trip's prep list groups by diver (${scheme})`, async ({ page }) => {
        await openReefTrip(page);
        await openTripTab(page, "Prep");
        await page.getByRole("link", { name: "By diver" }).click();
        // The by-item grouping has no Diver column, so this cannot resolve
        // against the view that was on screen a moment ago.
        await page.getByRole("columnheader", { name: "Diver" }).waitFor();
        await capture(page, "prep-by-diver", scheme);
      });

      /**
       * **The one state of a packing line neither capture above may hold**
       * (issue #1805): a piece the diver's stored fit asks for that the shop's
       * catalog no longer offers. It is kept and marked rather than dropped —
       * a stored `rents_*` flag survives the shop dropping that item (#1755),
       * and a silent drop would hide a fit nobody can fill — so the Size cell
       * reads "You no longer rent this" in warning tone, appended to whatever
       * it already held.
       *
       * Beside the calm captures rather than folded into them, which is the
       * rule for a panel that only renders when something looks wrong
       * (`.claude/rules/e2e.md`). The reach is why it matters here:
       * `rentalFitLine` feeds the roll call, the offline manifest and the
       * diver record from these same pieces, so a demo carrying this standing
       * would print an oddity nobody can clear on the boat manifest.
       *
       * One capture, both groupings, because the marker is the whole of what
       * moved and the by-diver cell is the narrower of the two Size columns.
       */
      test(`a trip's prep list marks a piece the shop stopped renting (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?droppedRental=1");
        expect(seeded.ok()).toBe(true);
        const { droppedRental } = (await seeded.json()) as { droppedRental?: { fullName: string } };
        if (!droppedRental) throw new Error("seed-trouble-states found no fit to contradict");

        await openReefTrip(page);
        await openTripTab(page, "Prep");
        await page.getByRole("link", { name: "By diver" }).click();
        await page.getByRole("columnheader", { name: "Diver" }).waitFor();
        // The marker itself, not the row: a capture on the right route in the
        // wrong state catches nothing.
        await expect(page.getByText("You no longer rent this")).toBeVisible();
        await capture(page, "prep-dropped-rental", scheme);
      });

      // The prep page's rental-assignments panel in its lived-in state: the
      // wreck trip ships with seeded units already assigned (seed-gear.ts),
      // so the frame holds assigned chips with their Release taps beside
      // open pickers — the grammar the reef trip's all-unassigned capture
      // above can't show (ADR 20260815-minimal-gear-register).
      test(`the prep page's rental assignments render true to the design (${scheme})`, async ({
        page,
      }) => {
        const tripId = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
        await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
        await page.getByRole("heading", { name: "Rental assignments" }).waitFor();
        await capture(page, "prep-assignments", scheme);
      });

      /**
       * **Each reason an assigned unit needs a look** (issue #2221, PR
       * #2209): "Needs service" with its note, a service clock run out, a
       * return flagged as a concern, and a clock coming due — one unit each,
       * assigned to four divers on today's reef boat. Through
       * `?unitsNeedingCare=1`, never the demo seed: the calm capture above is
       * what the demo shows.
       */
      test(`the prep page says why an assigned unit needs a look (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?unitsNeedingCare=1");
        expect(seeded.ok()).toBe(true);
        const { unitsNeedingCare } = (await seeded.json()) as {
          unitsNeedingCare?: { tripId: string };
        };
        if (!unitsNeedingCare) throw new Error("seed-trouble-states assigned no units to flag");
        await page.goto(`/shop/blue-mantis/trips/${unitsNeedingCare.tripId}/prep`);
        await page.getByRole("heading", { name: "Rental assignments" }).waitFor();
        // The labels themselves, not the heading: a capture on the right route
        // in the calm state catches nothing.
        await expect(
          page
            .getByText(/Inflator sticks/)
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
        await expect(
          page
            .getByText(/service overdue/)
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
        await capture(page, "prep-assignments-need-care", scheme);
      });

      /**
       * **The load-out, after one diver's set has been handed across** (issue
       * #1185, delight report D25). The calm capture above shows the cart line
       * and its pickers; this one shows the state a counter reaches by 7am —
       * one set out, its Hand over gone, the return pane in its place.
       *
       * **Named for the departure, not for `/prep`, because that is where it
       * lands.** It starts on `/prep` like its siblings, but it is the only
       * one here that *acts* — and slice 23c re-pointed the Gear tab's
       * redirecting forms at the departure, since after the fold `/prep`
       * is a page with no roster and no way back. The capture followed the
       * redirect and its baseline more than doubled (4053 → 8605 at 1280),
       * which is how the drift was found: a name that says `prep-` over a
       * picture of the departure would mislead the next triage.
       */
      test(`the load-out reads as handed over on the departure (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
        await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
        const assignments = page.locator('section[aria-labelledby="assignments-heading"]');
        await assignments.getByRole("heading", { name: "Rental assignments" }).waitFor();
        const diverRow = assignments.locator("li").filter({ hasText: "Priya Sharma" });
        await expect(diverRow.getByRole("button", { name: "All good" })).toHaveCount(0);
        await diverRow.getByRole("button", { name: "Hand over" }).click();
        const acknowledgement = page
          .getByRole("status")
          .filter({ hasText: staffCopy("gear.prep.notice.handedOver") });
        await expect(acknowledgement).toBeVisible();
        // Wait for the same diver's set, then photograph its saved state after
        // the acknowledgement leaves, rather than racing its four-second life.
        await expect(diverRow.getByRole("button", { name: "All good" })).toBeVisible();
        await expect(diverRow.getByRole("button", { name: "Hand over" })).toHaveCount(0);
        await page.mouse.move(0, 0);
        await expect(acknowledgement).toBeHidden();
        await expect(diverRow.getByRole("button", { name: "All good" })).toBeVisible();
        await capture(page, "departure-load-out-handed-over", scheme);
      });

      // The slip the counter prints and hands over. Reached the way a staffer      // The slip the counter prints and hands over. Reached the way a staffer
      // reaches it — through the assignment row's own door, not a typed URL —
      // so the capture also proves the door appears for a diver who has units
      // on them.
      test(`a diver's rental ticket renders true to the design (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", "Wreck Trip — Spiegel Grove");
        await page.goto(`/shop/blue-mantis/trips/${tripId}/prep`);
        await page.getByRole("link", { name: "Rental ticket" }).first().click();
        await page.getByRole("heading", { name: "What you have" }).waitFor();
        await capture(page, "rental-ticket", scheme);
      });
    });
  });
}
