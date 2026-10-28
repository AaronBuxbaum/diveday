/**
 * Visual captures: a shop's public pages: the schedule, embeds, trip, course and dive-site pages.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { bookASeatAndOpenThread } from "./helpers";
import {
  ADVANCED_CHARTER,
  capture,
  diverCopy,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  MINIMUM_SEATS_TRIP,
  PHONE_VIEWPORT,
  publicReefCard,
  REEF_TRIP,
  SURFACE_TIMEOUT_MS,
  tripIdWithoutSigningIn,
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

    test.describe("public", () => {
      // Wait for a real departure card, not the loading skeleton: this capture
      // used to `goto` and shoot immediately, so it raced the schedule's
      // suspense fallback and whichever side of that race each run landed on
      // decided the baseline. Two runs catching *different* skeleton frames is
      // what produced the schedule-dark diffs on builds with no code change.
      test(`the public schedule renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link").waitFor();
        await capture(page, "schedule", scheme);
      });

      /**
       * **"What you might see in July"** (batch 4, K4): the shopfront's shelf of
       * what the shop's crews logged this month in earlier seasons, which stays
       * silent below eight recorded departures. The demo has one season, so
       * the opt-in `?monthSightings=1` state logs eight past ones.
       */
      test(`the shopfront says what the crews have seen this month (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?monthSightings=1");
        expect(seeded.ok()).toBe(true);
        await page.goto("/s/blue-mantis");
        await page.getByRole("heading", { name: /^What you might see in / }).waitFor();
        await capture(page, "shopfront-month-sightings", scheme);
      });

      /**
       * **The off-season** (N-45) — the storefront a shop between seasons shows
       * a stranger, which no existing capture can be: `blue-mantis` exists to
       * have a full board, so this one empties it first.
       *
       * Its own baseline because the whole change is what the page becomes
       * when there is nothing to list: the card where the next boat would be,
       * no schedule heading standing over nothing, and the date-request
       * composer open as the page's one primary rather than collapsed into a
       * row three sections down. A diff on this one is a diff on the shape of
       * an empty page, which is exactly the thing a passing e2e assertion
       * cannot see.
       */
      test(`the off-season storefront renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-off-season");
        await page.goto("/s/blue-mantis");
        // The card itself, not a timing guess: it is server-rendered, so its
        // heading being on the page is the page having rendered as a quiet
        // shop rather than as its own skeleton.
        await page.getByRole("heading", { name: "Nothing on the water for a while" }).waitFor();
        await capture(page, "schedule-off-season", scheme);
      });

      /**
       * The same board read by someone who has said what they can dive.
       *
       * The whole design decision is visual and lives nowhere else: the
       * departures above the stated level are **dimmed and marked**, not
       * removed, with a two-word chip on each card (issue #696). A capture is
       * the only thing that can tell a dimmed-and-still-there card from a
       * missing one.
       *
       * The counted sentence that used to sit in the filter row beside it was
       * deleted on 2026-09-17; a URL carrying `canDive` still paints the
       * "More filters" disclosure open, so the row itself is in this shot.
       */
      test(`the public schedule marks what a diver cannot dive (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis?canDive=open_water");
        await publicReefCard(page).getByRole("link").waitFor();
        await page.getByText("Above your level").first().waitFor();
        await capture(page, "schedule-above-level", scheme);
      });

      /**
       * **The board read through one of the shop's own words** — ADR
       * 20260904-reef-all-the-way-down, decision 2 (issue #1162).
       *
       * Its own baseline because no existing capture can tell a current chip
       * from a plain one, and the current chip beside a narrowed list is the
       * whole drawn state. Waits on a real departure card, not the skeleton,
       * exactly as its two neighbours do.
       */
      test(`the public schedule read through a lens renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/s/blue-mantis?lens=after-dark");
        // The reef charter its two neighbours wait on wears a different word
        // and is not on this board at all, so this waits on the earliest live
        // "After dark" departure the seed puts there.
        await page
          .locator("li")
          .filter({ hasText: "Sunset Two-Tank — French Reef" })
          .getByRole("link")
          .first()
          .waitFor();
        await capture(page, "schedule-lens", scheme);
      });

      // A departure that no longer exists, which is what a link on a flyer or
      // in last season's Instagram post resolves to. It is a *shop* surface
      // rather than DiveDay's app-wide 404 (issue #765), so the thing to look
      // at is that the shop's header, nav and footer frame it and that one
      // action leads back to the board.
      //
      // The frame is composed in `src/app/not-found.tsx` now, not by the
      // segment layout: `src/proxy.ts` refuses this URL above the streaming
      // boundary so it answers a real 404 (ADR
      // 20260912-the-public-namespace-refuses-at-the-edge), and a rewrite to
      // `/_not-found` renders under the root layout. The components are the
      // same four, moved verbatim, so the picture is the same picture — which
      // is exactly what this baseline is here to say.
      //
      // The heading by name rather than `h1` first: the shell this route
      // streams from is DiveDay's own 404, which has an `<h1>` of its own, so
      // a wait on the tag can be satisfied by the page this capture exists to
      // prove is gone.
      test(`a dead link inside a shop renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/trips/00000000-0000-4000-8000-000000000000");
        await page.getByRole("heading", { name: "That page isn’t here" }).waitFor();
        await capture(page, "shop-not-found", scheme);
      });

      // The unsupported-language band (I18N-L1). Every other capture in this
      // file runs under the fleet's default locale, so nothing here has ever
      // rendered this surface — and a shop cannot reproduce it on its own
      // machine either, which is exactly why it wants a baseline. `de-DE` is a
      // language DiveDay carries no bundle for, so `unsupportedLanguage()`
      // answers and the band appears under the shop header.
      test.describe("unsupported language", () => {
        test.use({ locale: "de-DE" });

        test(`the schedule's language-fallback band renders true to the design (${scheme})`, async ({
          page,
        }) => {
          await page.goto("/s/blue-mantis");
          await publicReefCard(page).getByRole("link").waitFor();
          await capture(page, "schedule-language-fallback", scheme);
        });
      });

      // The embed widget's compact surface (docs ADR 20260726-schedule-embed):
      // no ShopPageHeader chrome, tighter padding — what a shop's own website
      // actually shows inside the iframe.
      // Same settle wait as the standalone schedule above, and for a sharper
      // reason: with no wait this capture sometimes shot an empty document, so
      // `fullPage` measured the viewport (844px tall) instead of the real page
      // (11802px). A baseline that is a blank viewport asserts nothing.
      test(`the embedded schedule renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis?embed=1");
        await publicReefCard(page).getByRole("link").waitFor();
        await capture(page, "schedule-embed", scheme);
      });

      /**
       * The embed catalogue's framed widgets (ADR
       * 20260901-diveday-reimagined, slice 13d): what a shop's own website
       * shows once the loader has mounted them. Photographed at their own
       * routes, which are embeds by path — no chrome, the credit line, and
       * the demo shop's brand through the same `BrandStyle` the storefront
       * reads. The departure card takes the next public departure off the
       * grid rather than a literal id, so the capture survives a re-seed.
       */
      test(`the embed grid renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/embed/grid");
        await page.getByRole("link", { name: "Book", exact: true }).first().waitFor();
        await capture(page, "embed-grid", scheme);
      });

      test(`the embed departure card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/embed/grid");
        const href = await page
          .getByRole("link", { name: "Book", exact: true })
          .first()
          .getAttribute("href");
        const tripId = /\/trips\/([^/#?]+)/.exec(href ?? "")?.[1];
        expect(tripId).toBeTruthy();
        await page.goto(`/s/blue-mantis/embed/departure?show=${tripId}`);
        await page.getByRole("link", { name: "Book", exact: true }).waitFor();
        await capture(page, "embed-departure", scheme);
      });

      test(`the embed course list renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/embed/courses");
        await page.getByRole("link", { name: "Enroll" }).first().waitFor();
        await capture(page, "embed-courses", scheme);
      });

      // The reviews widget (K3): the demo shop's published reviews, quoted
      // under its rating, with the archive one tap away.
      test(`the embed reviews widget renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/embed/reviews");
        await page.getByRole("link", { name: "All reviews" }).waitFor();
        await capture(page, "embed-reviews", scheme);
      });

      /**
       * **The one place a booking does not end on `/ready`** (ADR
       * 20260820-one-page-after-booking). Inside the iframe the frame stays put
       * — `/ready/**` is outside the framing allowlist, so redirecting there
       * would hand a shop's own visitor a CSP-blocked frame — and
       * `EmbedBookedNotice` says the seat is taken and offers one `target="_top"`
       * way out.
       *
       * It gets its own baseline because it is a *different surface* from the
       * `booking-confirmed` capture above, not a narrower rendering of it: short
       * where that page is long, and the only diver-facing screen in the product
       * whose whole job is to hand off to another window.
       */
      test(`the embedded booking confirmation renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/s/blue-mantis?embed=1");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        // Fixed per scheme, like `bookAVisualRegressionSeat`: the name renders,
        // so a random one would be a permanent diff rather than a regression.
        await page.getByLabel("Name", { exact: true }).fill("Embed Regression Diver");
        await page.getByLabel("Email", { exact: true }).fill(`embed-visual-${scheme}@example.com`);
        await page.getByRole("button", { name: /^Book/ }).click();
        await page.getByRole("heading", { name: /You’ve got a seat/ }).waitFor();
        // Still framed, and still on the trip page — the assertion that this
        // capture is of the embed branch and not a `/ready` that leaked in.
        await expect(page).toHaveURL(/embed=1/);
        await capture(page, "booking-confirmed-embed", scheme);
      });

      test(`the embedded trip keeps booking before the full day plan (${scheme})`, async ({
        page,
      }) => {
        await page.setViewportSize(PHONE_VIEWPORT);
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await page
          .getByRole("heading", { name: diverTranslator("en-US")("trip.theDay") })
          .waitFor();
        await expect(page.getByTestId("trip-site-reviews")).toHaveCount(1);
        await expect(page.getByTestId("trip-site-reviews").locator("li")).toHaveCount(2);
        const embeddedTrip = new URL(page.url());
        embeddedTrip.searchParams.set("embed", "1");
        await page.goto(embeddedTrip.href);
        await expect(page).toHaveURL(embeddedTrip.href);
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        const t = diverTranslator("en-US");
        const day = page.getByRole("heading", { name: t("trip.theDay"), exact: true });
        await expect(day).toHaveCount(1);
        await expect(day).toBeVisible();
        await expect(page.locator("#book form")).toBeVisible();
        expect(
          await day.evaluate((heading) => {
            const booking = document.querySelector("#book form");
            return Boolean(
              booking &&
                booking.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
            );
          }),
        ).toBe(true);
        // Molasses and French retain one sightings beat each. The existing
        // page reader excludes reviews in embeds, including these two quotes.
        await expect(page.getByText(t("trip.seen.heading"), { exact: true })).toHaveCount(2);
        await expect(page.getByTestId("trip-site-reviews")).toHaveCount(0);
        await capture(page, "booking-trip-embed", scheme);
      });

      // The seeded reef trip's public page: hero, "The day", the pitch — a fact
      // chip, three field-guide tiles and one closed door — the conditions
      // line, two alternates, the one-line requirement, and the form last (ADR
      // 20260827-the-divers-thread decision 2, bounded by ADR
      // 20260904-reef-all-the-way-down decision 1). This is the *closed* state,
      // which is what a diver meets; `booking-pitch-open` below photographs
      // what the door holds. The page measured 5,782px at 390 before the form
      // when nothing bounded it.
      //
      // Reached from the *standalone* schedule, never the embed: a schedule
      // loaded with `embed=1` carries the flag forward on its trip links, and
      // this baseline is the full-chrome page. Its own test now, so that can no
      // longer depend on which capture ran before it.
      test(`the public trip briefing renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await page.getByRole("heading", { name: "The day" }).waitFor();
        // The form is the last section and a Client Component; waiting on it
        // hydrating is what makes this the settled page rather than a shot of
        // the form mounting.
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await capture(page, "site-briefing", scheme);
        await page.getByLabel("Email", { exact: true }).fill("avery@gmial.com");
        await page.getByLabel("Email", { exact: true }).press("Tab");
        await page.getByRole("button", { name: /avery@gmail\.com/ }).waitFor();
        await capture(page, "booking-email-correction", scheme);
      });

      /**
       * **The same departure with the pitch's door open** (ADR
       * 20260904-reef-all-the-way-down, decision 1).
       *
       * Four beats moved behind one `<details>` — the route, the rest of the
       * field guide, the shop's own site prose and the crew — and a capture
       * of the closed page alone would leave all four as pixels
       * nothing ever looks at again. Nothing is deleted by that slice; this is
       * the baseline that proves it.
       */
      /**
       * **A full boat, and the wait list a party joins whole** (fourth UX
       * review, items 31 and 34). The seeded wreck ships 10 of 10: the page
       * offers other departures, then the wait-list form, which asks how many
       * divers and only the lead's details.
       */
      test(`a full boat's page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis");
        await page
          .locator("li")
          .filter({ hasText: "Wreck Trip — Spiegel Grove" })
          .getByRole("link", { name: "Wreck Trip — Spiegel Grove" })
          .click();
        await page.getByRole("heading", { name: "Join the wait list" }).waitFor();
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await capture(page, "public-trip-full", scheme);
      });

      /**
       * **A first-timer's course session** (UX sheet 2026-10-22, item 3). Under
       * The day, the course's own "Your afternoon" and, since the seed's
       * Discover Scuba includes its gear, "Gear is included." The page where
       * she pays now says what the course page says.
       */
      test(`a course session's page carries the afternoon and the gear (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/s/blue-mantis");
        await page
          .getByRole("link", { name: /Discover Scuba — Pool & Reef/ })
          .first()
          .click();
        await page.getByTestId("trip-course-plan").getByText("Gear is included.").waitFor();
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await capture(page, "public-trip-course-session", scheme);
      });

      test(`the pitch's door opens onto the whole briefing (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await page.getByRole("heading", { name: "The rest of the briefing" }).click();
        // Wait on something only the opened door renders, never a timing guess.
        await expect(page.getByRole("heading", { name: "Look for" })).toBeVisible();
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await capture(page, "booking-pitch-open", scheme);
      });

      /**
       * The same page on a charter that actually gates, so the "Who this trip
       * is for" note names a level *above* the shop's default (ADR
       * 20260803-trip-admission-at-booking). `site-briefing` above already
       * photographs the note in its shop-default form — every non-course
       * charter states Open Water — but not the raised form, which is the one a
       * diver is refused against and the one whose wording carries a level
       * name assembled from the trip's own requirement row.
       *
       * Advanced Drift is the uncontaminated case from
       * `src/db/seed-cert-gates.ts`: a level and nothing else, at a site with no
       * gate of its own. Its day-31 departure is deliberately off the public
       * schedule's first page, so the id comes off the staff board on a
       * disposable context and `page` never holds a session.
       */
      test(`the public trip page's requirement note renders true to the design (${scheme})`, async ({
        page,
        browser,
        workerBaseURL,
        staffStorageState,
      }) => {
        // A board crawl on a second context, then the capture. Same
        // aggregate-cost reasoning as the waiver and recap tests below.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await tripIdWithoutSigningIn(
          browser,
          workerBaseURL,
          await staffStorageState("owner"),
          ADVANCED_CHARTER,
        );
        await page.goto(`/s/blue-mantis/trips/${tripId}`);
        // One unboxed line, the form's first, no heading over it (ADR
        // 20260827-the-divers-thread, decision 2; UX audit #25).
        await page.getByText(/^This charter is for divers with/).waitFor();
        // The booking form is a Client Component below the note; wait for it to
        // hydrate so the shot is of the settled page, not of the form mounting.
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await capture(page, "site-briefing-requirements", scheme);
      });

      /**
       * **"Joining as", with a price per type** (ADR 20261007-participant-types).
       * A departure that sells snorkeler and rider seats asks each person what
       * they are doing, and the hero states each type's price. Today's reef
       * boat, through `/api/test/seed-trouble-states?mixedBoat=1`, which names
       * the two prices unless the demo seed already has.
       */
      test(`the public trip page offers a snorkeler and a rider seat (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?mixedBoat=1");
        expect(seeded.ok()).toBe(true);
        const { mixedBoat } = (await seeded.json()) as { mixedBoat?: { tripId: string } };
        if (!mixedBoat) throw new Error("seed-trouble-states found no departure to mix");
        await page.goto(`/s/blue-mantis/trips/${mixedBoat.tripId}`);
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await expect(page.getByLabel("Joining as")).toBeVisible();
        await capture(page, "public-trip-participant-types", scheme);
      });

      /**
       * **A dock day the departure's own legs lay out** (ADR
       * 20260815-per-leg-travel-minutes).
       *
       * `site-briefing` above photographs the reef morning, where the legs are
       * short and the day therefore reads exactly as it did on the shop's single
       * ride-out figure — which is the correct outcome there and proves nothing
       * about the column. The seeded long-range run is the only departure in the
       * demo whose *second* leg is longer than the shop's surface interval, and
       * that is the one shape that changes which beat a diver reads: the gap
       * between two dives is `max(surfaceInterval, travel)`, so at 75 minutes
       * the window is named "Ride to the next site" instead of "Surface
       * interval". Until this capture, no baseline had ever rendered that beat.
       *
       * Its id comes off the staff board on a disposable context, the same
       * CR-019 pattern as the requirement note above, so `page` stays the
       * unauthenticated visitor whose page is being photographed — who now has
       * to *hold a seat* to read it: the dock-day rhythm moved to the diver's
       * own thread when the trip page stopped selling and preparing at once
       * (ADR 20260827-the-divers-thread, decision 2).
       */
      test(`the departure's own legs lay the dock day out (${scheme})`, async ({
        page,
        browser,
        workerBaseURL,
        staffStorageState,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await tripIdWithoutSigningIn(
          browser,
          workerBaseURL,
          await staffStorageState("owner"),
          MINIMUM_SEATS_TRIP,
        );
        await page.goto(`/s/blue-mantis/trips/${tripId}`);
        // Fixed per scheme, like `bookAVisualRegressionSeat`: the name renders,
        // so a random one would be a permanent diff rather than a regression.
        await bookASeatAndOpenThread(
          page,
          `Leg Regression ${scheme === "light" ? "Day" : "Night"}`,
        );
        await page.getByRole("heading", { name: "Your dock-day rhythm" }).waitFor();
        // The beat only a stated leg can produce, and the reason this capture
        // exists — waiting on it means the shot can never be of a day that
        // quietly fell back to the shop's twenty minutes.
        await page.getByText("Ride to the next site").waitFor();
        await capture(page, "dock-day-legs", scheme);
      });

      // "Upcoming dates" is the last section the public course page streams, so
      // it is the signal that the whole document has landed — without it this
      // capture also shot a viewport-tall blank page on some runs.
      test(`the public course page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/courses/open-water-diver");
        await page.getByRole("heading", { name: "Upcoming dates" }).waitFor();
        await capture(page, "course-page", scheme);
      });

      test(`the course alternate-date enquiry opens beneath its dates (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/s/blue-mantis/courses/open-water-diver");
        await page.getByRole("heading", { name: "Upcoming dates" }).waitFor();
        const inquiry = page.locator("#get-in-touch");
        await page.locator("#get-in-touch > summary").click();
        await expect(inquiry).toHaveAttribute("open", "");
        await expect(inquiry.getByLabel(diverCopy("inquiry.yourEmail"))).toBeVisible();
        await capture(page, "course-alternate-date-enquiry-open", scheme);
      });

      /**
       * **The place page** (N-48): the shop's own briefing for one dive site,
       * addressed by the site rather than by a departure.
       *
       * Molasses Reef is the seeded library's fullest row — prose, landmarks,
       * a conservation note, a field guide and a drawn route — so this
       * baseline covers every beat the page can render at once. "Next
       * departures here" is the last section, so waiting on it is what says
       * the whole document has landed rather than its header alone.
       */
      test(`the public dive-site page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/sites/molasses-reef");
        await page.getByRole("heading", { name: "Next departures here" }).waitFor();
        // The fleet refuses the maps host (e2e/fixtures.ts), so this capture is
        // the failed state: the sunken ground, the route alone, and the quiet
        // line naming the site (issue #2013). The frame asks the maps host
        // only once it is on screen (`MapFrame`), so bring it there first, or
        // the state stays "waiting" and the line never shows. Then back to the
        // top, where every other capture starts.
        await page.locator("[data-map-state]").first().scrollIntoViewIfNeeded();
        await page.getByText("is not loading.").waitFor();
        await page.evaluate(() => window.scrollTo(0, 0));
        await capture(page, "dive-site-page", scheme);
      });

      // The diver's catalog index. It used to be the signed-out half of a
      // staff page inside /shop and so had no baseline of its own; it is a
      // standalone public surface now (ADR 20260803-public-shop-namespace).
      test(`the public course catalog renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/courses");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await capture(page, "public-courses", scheme);
      });
    });
  });
}
