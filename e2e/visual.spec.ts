import { readdirSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { AFTER_STATE_TEST_IDS } from "../src/app/ready/[token]/_components/after-state-test-ids";
import { DIVE_SITE_TEMPLATES } from "../src/content/dive-site-templates";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed";
import { LISTED_SHOP_SLUGS } from "../src/db/seed-listed-shops";
import { staffTranslator } from "../src/i18n/staff-messages";
import { type FeaturePageSlug, featurePagePath } from "../src/lib/feature-pages";
import { publicFindMyBookingPath } from "../src/lib/public-routes";
import { signRecapToken } from "../src/lib/recap-links";
import { weekStartOf } from "../src/lib/week-board";
import { clearCourseForms } from "./course-form-only";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  bookOpenWaterSession,
  choosePartySize,
  counterPath,
  createTrip,
  daysFromNow,
  disclosureSettled,
  e2eNow,
  manifestRow,
  offlineCopySaved,
  openBoatCheck,
  openCounterFor,
  openDiverFileGroup,
  openFirstRosterRowWith,
  openManifestPerson,
  openOnThisPhone,
  openPaperWaiverForm,
  openRosterDetails,
  openRosterNotes,
  openSettingsRow,
  openThreadStep,
  openTripAbout,
  openTripFromBoard,
  openTripTab,
  publicTripUrl,
  requireCourseForm,
  STAFF_DAY_HEADING,
  saveDiveIntent,
  scheduleCrewedOpenWaterSession,
  seatFromRoster,
  seededTripId,
  threadStatus,
  tripPathByTitle,
  waiverLinkFromResult,
  waiverLinkFromToast,
  walkInFormPath,
  writeCourseForm,
} from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";
import { mintOnboardFormPath } from "./setup-link";
import {
  ADVANCED_CHARTER,
  AGING_SAVED_AT,
  AOW_COURSE,
  bookAVisualRegressionSeat,
  capture,
  captureFolded,
  capturePrint,
  captureStickyFoot,
  DEEP_CHARTER,
  deepDiverLogPath,
  diverCopy,
  EASING_BACK_TRIP,
  FLOW_TIMEOUT_MS,
  IDENTITY_ROUTE,
  installVisualBuildGuard,
  MINIMUM_SEATS_TRIP,
  OTHER_SHOP,
  openDisputeSheet,
  openDiverProfile,
  openReefTrip,
  openSailedTrip,
  PAST_PENDING_GRACE,
  publicReefCard,
  REEF_TRIP,
  rewriteSavedOfflineRecord,
  SAILED_TRIP,
  SPANISH,
  SURFACE_TIMEOUT_MS,
  savedOfflineRecordFor,
  settleOfflineShellWorker,
  staffCopy,
  tripIdWithoutSigningIn,
  waitForHashLanding,
  waitForSiteLibrary,
  waitForSiteMap,
  withRendererBound,
  withTransitionsOff,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test.describe("public", () => {
      /**
       * **The counter's QR door** (issue #1236): the form a walk-in fills in
       * before any booking exists. Three groups — who they are, what they say
       * their card is, and the sizes that save a fitting — on a page a shop
       * prints a QR for and puts on the desk.
       */
      test(`the shopfront's register form renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/s/blue-mantis/register");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await page.getByRole("button", { name: "Send it to the shop" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "shopfront-register", scheme);
      });

      test(`the landing page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/");
        await capture(page, "landing", scheme);
      });

      // The other two buyer-facing sales surfaces: the features hub (every
      // feature page by phase with its checklist folded under it, the groups
      // no page owns, honest-no scope) and the pricing page with its
      // objection FAQ. Copy changes here are product changes.
      test(`the product page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/product");
        await capture(page, "product", scheme);
      });

      test(`the pricing page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/pricing");
        await capture(page, "pricing", scheme);
      });

      // Where a shop the owner has spoken to is opened: two group labels over
      // the fields, the storefront address written under the shop link, and
      // the one trial sentence (ADR 20260827-first-light, decision 1). Only
      // behind the setup key (ADR 20260925-shops-are-set-up-by-hand).
      test(`the onboarding form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto(await mintOnboardFormPath(page));
        // This route owns a loading.tsx, and `goto` resolves on the document
        // load event while the body is still streaming — a bare capture here
        // once shot the skeleton and published it as the baseline
        // (onboard-light-vw-390, caught only when the next PR's correct
        // render diffed against it). The page's own <h1> is the readiness
        // proof: every page renders one, no skeleton does. Same wait on every
        // capture below whose route owns a loading.tsx.
        await page.locator("h1").first().waitFor();
        await capture(page, "onboard", scheme);
      });

      // What everyone without the key meets at `/onboard`: one sentence on how
      // a shop is set up and the door to the set-up form.
      test(`the closed onboarding door renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/onboard");
        await page.locator("h1").first().waitFor();
        await capture(page, "onboard-closed", scheme);
      });

      // Where every "Get set up" door lands (ADR 20261007-setup-request-form):
      // seven asks, two of them as pills.
      test(`the set-up request form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/get-set-up?from=pricing");
        await page.locator("h1").first().waitFor();
        await capture(page, "get-set-up", scheme);
      });

      // The thank-you page a sent request lands on, with the demo door.
      test(`the set-up request thank-you page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/get-set-up/sent");
        await page.locator("h1").first().waitFor();
        await capture(page, "get-set-up-sent", scheme);
      });

      // DiveDay's door for a diver who lost their link (fourth review, item
      // 50): the listed shops, each leading to its own find-my-booking.
      test(`the diver's shop picker renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/find-your-booking");
        await page.locator("h1").first().waitFor();
        // The picker lists every public shop in the shared database, so a shop
        // another capture made first (the Bookable Moment shop) would change
        // this picture with test order (#2690). Only the seeded listed shops
        // stay in the frame; the page is otherwise exactly as it rendered.
        await page.getByRole("list", { name: diverCopy("findYourBooking.listLabel") }).waitFor();
        await page.evaluate((kept) => {
          for (const item of document.querySelectorAll("main ul > li")) {
            const href = item.querySelector("a")?.getAttribute("href") ?? "";
            if (!kept.includes(href)) item.remove();
          }
        }, LISTED_SHOP_SLUGS.map(publicFindMyBookingPath));
        await expect(
          page
            .getByRole("list", { name: diverCopy("findYourBooking.listLabel") })
            .getByRole("listitem"),
        ).toHaveCount(LISTED_SHOP_SLUGS.length);
        await capture(page, "find-your-booking", scheme);
      });

      test(`the sign-in page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/sign-in");
        await capture(page, "sign-in", scheme);
      });

      // The same form after a signed-out visitor followed a `/shop/**` link:
      // Auth.js's `callbackUrl` names the shop, so the page offers that shop's
      // public schedule instead of leaving a diver at a staff password field.
      test(`the sign-in shop escape hatch renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/sign-in?callbackUrl=%2Fshop%2Fblue-mantis%2Fdivers");
        await capture(page, "sign-in-shop-escape", scheme);
      });

      test(`the forgot-password page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/forgot-password");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "forgot-password", scheme);
      });

      // The sent door — the only home of the `sent` mark, and the one terminal
      // state reachable without a real token (ADR 20260827-first-light,
      // decision 2: the mark is a drawn stroke, never an emoji, so it is now a
      // thing a baseline can hold to across platforms at all). `?sent=1` is
      // exactly what the enumeration-safe action redirects to for every
      // outcome, so this is the real page and not a mock of it.
      test(`the reset-sent door renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/forgot-password?sent=1");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "forgot-password-sent", scheme);
      });

      // The token pages' one always-reachable state: an unrecognized token
      // never renders anything but this same closed notice (no live token to
      // capture the confirm/reset form with — see e2e/account-lifecycle.spec.ts).
      test(`the invalid email-verification notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/verify/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "verify-invalid", scheme);
      });

      test(`the invalid password-reset notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/reset-password/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "reset-password-invalid", scheme);
      });

      test(`the invalid unsubscribe notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/unsubscribe/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "unsubscribe-invalid", scheme);
      });

      test(`the invalid contact-confirmation notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/confirm-contact/not-a-real-token");
        // Streams behind a loading.tsx — wait for the page's h1 (see the
        // onboard capture above).
        await page.locator("h1").first().waitFor();
        await capture(page, "confirm-contact-invalid", scheme);
      });

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
       * "Filter" disclosure open, so the row itself is in this shot.
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
        await page.getByRole("link", { name: "Book" }).first().waitFor();
        await capture(page, "embed-grid", scheme);
      });

      test(`the embed departure card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis/embed/grid");
        const href = await page.getByRole("link", { name: "Book" }).first().getAttribute("href");
        const tripId = /\/trips\/([^/#?]+)/.exec(href ?? "")?.[1];
        expect(tripId).toBeTruthy();
        await page.goto(`/s/blue-mantis/embed/departure?show=${tripId}`);
        await page.getByRole("link", { name: "Book" }).waitFor();
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
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
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
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
        await capture(page, "site-briefing", scheme);
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
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
        await capture(page, "public-trip-full", scheme);
      });

      test(`the pitch's door opens onto the whole briefing (${scheme})`, async ({ page }) => {
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await page.getByRole("heading", { name: "The rest of the briefing" }).click();
        // Wait on something only the opened door renders, never a timing guess.
        await expect(page.getByRole("heading", { name: "Look for" })).toBeVisible();
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
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
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
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
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
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
        await page.locator("iframe[data-map-state]").first().scrollIntoViewIfNeeded();
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

      /**
       * **The thread's after-state**, reached through the recap token: the same
       * surface `/ready` renders once the boat is home (ADR
       * 20260827-the-divers-thread, decision 4 — slice 7d folded `/recap` into
       * it), minted for the pinned demo booking (src/db/seed.ts) so the marquee
       * word-of-mouth surface has a stable baseline with no in-app link to
       * reach it.
       *
       * The capture keeps its `recap` name, because what it is a picture *of* —
       * the day after — has not changed. What it now photographs is the
       * welcome-home greeting, the one dive record, the crew's word, the single
       * review ask, and the run of quiet doors at rest.
       *
       * Slice 16i added three things inside that same frame and they are the
       * reason this baseline moves: the record's face says "Dive day № 3"
       * rather than a clause naming the shop (H-67 c), the record's footer
       * carries the dashed private line and Save as image (D33 issue #1193,
       * issue #1081), and the private pulse and the one next-dive card sit
       * below the review (D40 issue #1200, D35 issue #1195). The two sibling
       * recap captures below render the same component and move for the same
       * reasons; none of the three is filtered to hide it.
       *
       * Two pieces of setup it cannot render without. The review section (docs
       * ADR 20260726-post-trip-review-request) needs the shop's review link
       * set, done on a disposable staff context (the CR-019 pattern) so the
       * public `page` never holds a session. The tip section (docs ADR
       * 20260726-post-trip-tipping) needs a connected, charges-enabled Stripe
       * account — `canAcceptPayments` is a pure DB check, independent of
       * whether STRIPE_SECRET_KEY is set — so /api/test/seed-stripe-account
       * marks the demo shop connected without ever calling Stripe, purely to
       * render the surface for this capture. The actual checkout button stays
       * inert (no STRIPE_SECRET_KEY in this fleet), the same reason no capture
       * here exercises a real charge.
       */
      test(`the post-trip recap renders true to the design (${scheme})`, async ({
        page,
        browser,
        workerBaseURL,
        staffStorageState,
        request,
      }) => {
        // A settings round-trip on a second context, a test-route write, then
        // the tallest capture in the file.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const reviewSettingsContext = await browser.newContext({
          baseURL: workerBaseURL,
          storageState: await staffStorageState("owner"),
        });
        const reviewSettingsPage = makeActivitySafe(await reviewSettingsContext.newPage());
        await reviewSettingsPage.goto("/shop/blue-mantis/settings");
        await openSettingsRow(reviewSettingsPage, "Review link");
        await reviewSettingsPage
          .getByLabel("Review link (optional)", { exact: true })
          .fill("https://g.page/r/blue-mantis/review");
        await reviewSettingsPage.getByRole("button", { name: "Save review link" }).click();
        await reviewSettingsPage
          .getByText("Review link saved.")
          .filter({ visible: true })
          .waitFor();
        await reviewSettingsContext.close();

        await request.post("/api/test/seed-stripe-account");
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
        await page.getByRole("heading", { name: /Welcome back/ }).waitFor();
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        // The tip door renders at all only for a shop that can take a tip, and
        // that is what the seed-stripe-account write above buys — so waiting on
        // it is what proves the whole run of doors is in the frame.
        await page.getByText("Tip the crew", { exact: true }).waitFor();
        await capture(page, "recap", scheme);
      });

      /**
       * **The day that went somewhere else** (issue #1191, D31).
       *
       * The recap above is the ordinary shape: a plan, and no record
       * disagreeing with it. This is the other branch — a divemaster wrote
       * dive one down at a different site, so the record card names where the
       * boat went and keeps the plan beneath it under "Planned".
       *
       * Seeded through a test route rather than into blue-mantis, for the
       * reason AGENTS.md gives for the trouble states: a demo shop whose every
       * recap says the boat went elsewhere is a worse demo, and the branch
       * worth a baseline is the rare one. Mutating is safe — each worker owns
       * its database and resets before every test.
       */
      test(`a recap whose record left the plan renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const seeded = await request.post("/api/test/seed-changed-dive-site");
        expect(seeded.ok(), await seeded.text()).toBe(true);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        // The "Planned" row is the whole subject: waiting on it is what proves
        // the comparison fired rather than photographing the calm variant
        // twice.
        await page
          .getByTestId(AFTER_STATE_TEST_IDS.plannedSites)
          .filter({ visible: true })
          .waitFor();
        await capture(page, "recap-record-left-plan", scheme);
      });

      /**
       * **The day that turned up something** (issue #1190, D30).
       *
       * The recap above renders no sighting at all, which is the ordinary
       * shape and the one that proves the boundary: a species reaches this card
       * because a crew member wrote it down, never because the reef is known
       * for it. This is the other branch.
       *
       * It is a *separate* capture from the changed-site one above rather than
       * folded into it, because the two states have nothing to do with each
       * other — most days that turn up a turtle go exactly where they meant to,
       * and photographing them together would suggest they travel as a pair.
       *
       * The field guide two rows down is the counterweight worth looking at in
       * the same frame: the same catalog, the opposite verb.
       */
      test(`a recap naming what the crew saw renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const seeded = await request.post("/api/test/seed-observed-species");
        expect(seeded.ok(), await seeded.text()).toBe(true);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        // Waiting on the line itself, not on the page: photographing the calm
        // variant twice is the failure this exists to avoid.
        await page.getByTestId(AFTER_STATE_TEST_IDS.seen).filter({ visible: true }).waitFor();
        await capture(page, "recap-seen-on-the-day", scheme);
      });

      /**
       * **The session that certified its diver** (fourth review, item 55).
       *
       * The record names the level the shop issued from this session, under
       * the diver, and only from the card the roster's Certify wrote: the
       * calm `recap` above carries no such line. Through a test route for the
       * reason the two above give: the demo's recap is an ordinary reef day.
       */
      test(`a recap for a session that certified its diver renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const seeded = await request.post("/api/test/seed-certified-recap");
        expect(seeded.ok(), await seeded.text()).toBe(true);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        await page.getByTestId(AFTER_STATE_TEST_IDS.certified).filter({ visible: true }).waitFor();
        await capture(page, "recap-certified", scheme);
      });

      /**
       * **The day the crew logged, with its times** (issue #1425, N-04).
       *
       * The `recap` capture above is the day with no `executed_dives` row,
       * which is what most recaps look like at the moment they are opened, and
       * it carries no fly-safe line: nothing on that record can say. This is
       * the other branch — both tanks logged with a time out — and the one
       * sentence it adds under the record: when this diver may fly, in the
       * shop's zone, with the hours and who set them. A separate capture from
       * the two beside it for the same reason they are separate from each
       * other: a logged day, a changed site and a sighting are three states
       * that do not travel together.
       */
      test(`a recap that says when the diver may fly renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const seeded = await request.post("/api/test/seed-dive-times");
        expect(seeded.ok(), await seeded.text()).toBe(true);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        // Waiting on the line itself, not on the page — see the capture above.
        await page.getByTestId(AFTER_STATE_TEST_IDS.flySafe).filter({ visible: true }).waitFor();
        await capture(page, "recap-fly-safe", scheme);
      });

      /**
       * **The field guide, open** (issue #1192, D32).
       *
       * The drawer is shut on arrival, so the `recap` capture above already
       * photographs it — as one hairline row and nothing else. What needs a
       * baseline is what is behind it: the faces each site is known for, under
       * that site's own name, which is what keeps the guide a statement about a
       * *place* rather than a report of what this dive saw.
       *
       * Molasses and French both carry a seeded guide (`seed-dive-sites.ts`),
       * so no test route is needed — this is the demo shop's ordinary state.
       */
      test(`the recap's field guide renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID)}`);
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        await page.locator("[data-recap-door='field-guide'] summary").click();
        // A species name is what proves the drawer opened *and* that the
        // catalog copy resolved — an open door with no faces in it would
        // photograph as a heading over nothing.
        await page
          .locator("[data-recap-door='field-guide']")
          .getByText("Stoplight parrotfish", { exact: true })
          .first()
          .waitFor();
        await capture(page, "recap-field-guide", scheme);
      });

      /**
       * Active (unsigned) waiver — the safety-critical form itself, before any
       * signature or medical answer is entered.
       *
       * Minting the link is a real send-waiver action, run on a disposable
       * staff context so `page` stays the same unauthenticated visitor
       * throughout, exactly as a real diver reaches the link.
       */
      test(`the unsigned waiver renders true to the design (${scheme})`, async ({
        page,
        browser,
        workerBaseURL,
        staffStorageState,
      }) => {
        // Board → trip → Guests → send, on a second context, then the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const staffContext = await browser.newContext({
          baseURL: workerBaseURL,
          storageState: await staffStorageState("owner"),
        });
        const staffPage = makeActivitySafe(await staffContext.newPage());
        await staffPage.goto("/shop/blue-mantis/schedule/board");
        await staffPage
          .locator("li")
          .filter({ hasText: REEF_TRIP })
          .getByRole("link", { name: REEF_TRIP, exact: true })
          .click();
        await staffPage.waitForURL(/\/shop\/blue-mantis\/trips\//);
        await staffPage.waitForURL(/\/trips\/[a-f0-9-]+$/);
        const diverSection = staffPage.locator("#roster");
        const unsent = await openFirstRosterRowWith(staffPage, "Send waiver");
        await unsent.getByRole("button", { name: "Send waiver", exact: true }).click();
        const resultNotice = diverSection.getByRole("status");
        await resultNotice.waitFor();
        const waiverHref = await waiverLinkFromResult(staffPage, resultNotice);
        await staffContext.close();

        await page.goto(waiverHref);
        await page.getByRole("heading", { name: "A quick step before the dock" }).waitFor();
        await capture(page, "waiver-active", scheme);

        /**
         * The same page once the diver has worked through it: the step rail at
         * 2 of 3 with Release and Medical settled and Sign still open, the
         * questionnaire's own outcome line under the answers, and Sign as the
         * page's one filled button with saving demoted to the text link beside
         * the expiry sentence (ADR 20260827-the-divers-thread, decision 5).
         *
         * It rides on the capture above rather than taking a test of its own:
         * minting a waiver link is a real staff send on a second context, and
         * answering the form afterwards costs nothing but client-side clicks.
         */
        const noRadios = page.getByRole("radio", { name: "No" });
        const questionCount = await noRadios.count();
        for (let index = 0; index < questionCount; index++) {
          await noRadios.nth(index).check();
        }
        // Wait on the rail's own statement that every answer landed — never a
        // timeout, and never the last click's own resolution, which says
        // nothing about the count two components away from it.
        await page.getByTestId("waiver-step-rail").getByText("2 of 3 done").waitFor();
        await capture(page, "waiver-rail", scheme);

        /**
         * The same page one honest answer later. "I am over 45 years of age" is
         * the most ordinary yes on a dive boat and it puts Box B's four
         * required questions on the page: the Box's own rule beside the
         * questions it opened, the outcome line saying they are still to
         * answer, and the rail dropping back to 1 of 3 because the medical step
         * is open again. Every capture before this one answers "No" to
         * everything, so no Box had ever been photographed (2026-08-28 review).
         */
        await page
          .getByRole("group", { name: /I am over 45 years of age/ })
          .getByRole("radio", { name: "Yes" })
          .check();
        await page.getByTestId("waiver-step-rail").getByText("1 of 3 done").waitFor();
        await capture(page, "waiver-rail-follow-ups", scheme);
      });

      /**
       * **The held release and the doctor's page** (fifth-loop ideas, item 17;
       * ADR 20261016-doctor-referral-page). Priya Sharma answers question 3
       * yes and signs, so her link reopens on the medical hold with its new
       * "Take this to your doctor" door, and that door opens the printable
       * evaluation form with her name in it and the question's number.
       */
      test(`the doctor's page renders true to the design (${scheme})`, async ({
        page,
        browser,
        workerBaseURL,
        staffStorageState,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const staffContext = await browser.newContext({
          baseURL: workerBaseURL,
          storageState: await staffStorageState("owner"),
        });
        const staffPage = makeActivitySafe(await staffContext.newPage());
        await staffPage.goto("/shop/blue-mantis/schedule/board");
        await staffPage
          .locator("li")
          .filter({ hasText: REEF_TRIP })
          .getByRole("link", { name: REEF_TRIP, exact: true })
          .click();
        await staffPage.waitForURL(/\/trips\/[a-f0-9-]+$/);
        const unsent = await openFirstRosterRowWith(staffPage, "Send waiver");
        await unsent.getByRole("button", { name: "Send waiver", exact: true }).click();
        const resultNotice = staffPage.locator("#roster").getByRole("status");
        await resultNotice.waitFor();
        const waiverHref = await waiverLinkFromResult(staffPage, resultNotice);
        await staffContext.close();

        await page.goto(waiverHref);
        const noRadios = page.getByRole("radio", { name: "No" });
        await noRadios.first().waitFor();
        const questionCount = await noRadios.count();
        for (let index = 0; index < questionCount; index++) {
          await noRadios.nth(index).check();
        }
        await page
          .locator("fieldset")
          .filter({ visible: true })
          .nth(2)
          .getByRole("radio", { name: "Yes" })
          .check();
        await page.getByLabel("Type your full name").fill("Priya Sharma");
        await page.getByLabel("I have read this waiver, understand it, and agree to it.").check();
        await page.getByRole("button", { name: "Sign waiver" }).click();
        await page.waitForURL(/\/ready\//);

        await page.goto(waiverHref);
        await page.getByRole("link", { name: "Take this to your doctor" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "waiver-medical-held", scheme);

        await page.getByRole("link", { name: "Take this to your doctor" }).click();
        await page.getByTestId("doctor-evaluation-form").waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "waiver-doctor", scheme);
      });

      /**
       * **The guardian's card** (ADR 20260907-guardian-co-signature): the
       * second signature a minor's release takes, and the one composition on
       * this page no other capture can reach — it renders from the diver's own
       * date of birth, so an adult's link never draws it.
       *
       * Its own diver rather than the seeded thirteen-year-old, for the reason
       * `e2e/guardian-co-signature.spec.ts` gives: hers is already co-signed so
       * the demo boat is not permanently blocked, and a signed release issues
       * no second link.
       */
      test(`the guardian's half of a minor's release renders true to the design (${scheme})`, async ({
        page,
        browser,
        workerBaseURL,
        staffStorageState,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const staffContext = await browser.newContext({
          baseURL: workerBaseURL,
          storageState: await staffStorageState("owner"),
        });
        const staffPage = makeActivitySafe(await staffContext.newPage());
        // A minted diver keeps the capture's own name out of the frame: the
        // page prints the diver's name in the guardian card's opening line, so
        // a per-run stamp would change the picture on every run. Pinned words.
        await staffPage.goto("/shop/blue-mantis/divers/new");
        await staffPage.getByLabel("Full name").fill("Robin Delgado");
        await staffPage.getByLabel("Email").fill("robin.delgado@example.com");
        await staffPage.getByRole("button", { name: "Add diver" }).click();
        await staffPage.waitForURL(/\/shop\/blue-mantis\/divers\/[0-9a-f-]{36}/);
        // Thirteen against the frozen e2e clock, so the rendered page is the
        // same picture on every run. `?edit=1` names the disclosure the date of
        // birth lives behind rather than relying on where a fresh record lands.
        await staffPage.goto(`${new URL(staffPage.url()).pathname}?edit=1`);
        await staffPage.getByLabel("Date of birth").fill(daysFromNow(-365 * 13));
        await staffPage.getByRole("button", { name: "Save details" }).click();
        await staffPage.getByRole("status").getByText("Diver details updated").waitFor();
        // Back to the record's own URL first: the save lands on a `?notice=`,
        // whose banner is a second `role="status"` beside the copy toast
        // `waiverLinkFromToast` reads.
        await staffPage.goto(new URL(staffPage.url()).pathname);
        // An unsigned release opens its group onto the ways to get it signed.
        await openDiverFileGroup(staffPage, "Waiver");
        await staffPage.getByRole("button", { name: "Copy link" }).click();
        const waiverHref = await waiverLinkFromToast(staffPage);
        await staffContext.close();

        await page.goto(waiverHref);
        await page.getByRole("heading", { name: "Parent or guardian" }).waitFor();
        await capture(page, "waiver-guardian", scheme);
      });

      /**
       * The moment the whole public funnel exists for: `/ready` as it looks in
       * the seconds after a seat is taken — the "You've got a seat" earned
       * moment, the emails line, and the checklist under it (ADR
       * 20260820-one-page-after-booking). It was a branch of the trip page
       * until 2026-08-20; the capture keeps its name, because what it is a
       * picture *of* — the confirmed state — has not changed.
       *
       * It and `readiness` below are now the same route in two states, and
       * that is the point of having both: this one on `?booked=1`, the other
       * on the plain link a shop sends the night before. They each run their
       * own booking rather than sharing one. That used to be forbidden — a
       * second real booking inside the public tour would have moved the seat
       * counts every capture after it depended on (CR-019) — but the per-test
       * `demoReset` in e2e/fixtures.ts reseeds the demo shop before each of
       * these, so each books against the same fixture and neither can see the
       * other's seat.
       */
      test(`the booking confirmation renders true to the design (${scheme})`, async ({ page }) => {
        // A real booking through the public form, then the capture.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        await capture(page, "booking-confirmed", scheme);
      });

      // The same page on the *durable* link — what a diver opens from the
      // night-before email, days after the celebration above has been flashed
      // out of the URL. Reloading without `?booked=1` is exactly how a diver
      // reaches it, so that is how it is captured. One full-page shot covers
      // the whole thread at rest: the status figure, the spine with its first
      // step open and every other one a line, and the packing list below (ADR
      // 20260827-the-divers-thread, decision 3).
      test(`the diver's thread renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        await page.goto(new URL(page.url()).pathname);
        await threadStatus(page).waitFor();
        await capture(page, "readiness", scheme);
      });

      /**
       * **The thread's Day-of step, answered "Getting comfortable again"** (D12
       * and D18).
       *
       * Both questions were asked on the public booking form until 2026-09-06
       * and the `booking-intent` capture stood there; they are asked here now,
       * of the diver whose seat it is. This is still the only state in which
       * D18's three offers are ever on screen, so without a baseline the block
       * a rusty diver actually reads has none at all — and it has to be a
       * departure more than a day out, or the offers are correctly absent.
       */
      test(`the thread answers a diver easing back (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/s/blue-mantis");
        await page
          .locator("li")
          .filter({ hasText: EASING_BACK_TRIP })
          .getByRole("link", { name: EASING_BACK_TRIP })
          .click();
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
        await page.getByLabel("Name", { exact: true }).fill("Visual Regression Diver");
        await page
          .getByLabel("Email", { exact: true })
          .fill(`visual-regression-easing-${scheme}@example.com`);
        await page.getByRole("button", { name: /^Book/ }).click();
        await expect(page).toHaveURL(/\/ready\//);
        await saveDiveIntent(page, "Getting comfortable again");
        // The save redirects, which shuts the accordion; the offers are the
        // point of the capture, so the step is opened again for it.
        const dayOf = await openThreadStep(page, "dayof");
        await expect(dayOf.getByText("Anything that would help?")).toBeVisible();
        await capture(page, "readiness-easing-back", scheme);
      });

      /**
       * **The thread with a later step opened**, which the capture above can
       * never show: at most one step is open at rest, and the one at rest is
       * always the first thing on the diver. Everything the spine does with a
       * form — the rental fit's own controls, a step's fine print, the
       * disclosure the diver just closed to get here — only renders in this
       * state, and nothing had ever photographed it.
       */
      test(`the thread's opened step renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        await page.goto(new URL(page.url()).pathname);
        await threadStatus(page).waitFor();
        await openThreadStep(page, "gear");
        await capture(page, "thread-prep-current-step", scheme);
      });

      /**
       * **The returning diver's thread** — ADR 20260904-reef-all-the-way-down,
       * D15 with D19 folded in, D14's recall line, and Budget rule 5's chips.
       *
       * The only state that photographs all of them at once: the three facts
       * with their doors, the sentence naming the staffer who kept a fit, the
       * Crew chip on the change ledger and the Plan chip on the arrival card's
       * sites row. None of it renders on the calm thread above, because the
       * step only exists for a diver whose sizes the shop was already holding
       * before the booking — a state no form can reach, hence the seed.
       */
      test(`the returning diver's thread renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        const seeded = await request.post("/api/test/seed-returning-diver", {
          data: { shopSlug: "blue-mantis", email: `visual-regression-${scheme}@example.com` },
        });
        expect(seeded.ok()).toBe(true);
        await page.goto(new URL(page.url()).pathname);
        await threadStatus(page).waitFor();
        await openThreadStep(page, "changes");
        await capture(page, "thread-anything-changed", scheme);
      });

      /**
       * **The door remembers who opened it** (ADR 20260906-before-you-ask,
       * decision 3). The booking page as a known diver reaches it from the
       * thread's next-dive link: the standing facts folded into one panel above
       * the fields, the lead's own details already in them, and "Not you?"
       * beneath. Reached through `/api/test/seed-booking-handoff`, which mints
       * the same ten-minute handoff the thread would; the cold page is every
       * other booking capture in this file.
       */
      test(`the known diver's booking page renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        const seeded = await request.post("/api/test/seed-booking-handoff", {
          data: { shopSlug: "blue-mantis", email: `visual-regression-${scheme}@example.com` },
        });
        expect(seeded.ok()).toBe(true);
        const { href } = (await seeded.json()) as { href: string };
        await page.goto(href);
        await page.getByText("Booking as Visual Regression Diver").waitFor();
        await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
          "Visual Regression Diver",
        );
        await capture(page, "booking-known-diver", scheme);
      });

      /**
       * **The card a diver meets on their worst day**, which nothing had ever
       * photographed — in either language or either scheme (issue #859).
       *
       * `ExpiredLinkCard` is what a dead bearer link renders, and it has two
       * shapes worth a baseline. This is the attributed one: the shop named,
       * its contact link, and — since issue #850 — a button that mails a fresh
       * link to the address already on the booking. `e2e/readiness.spec.ts`
       * drives it and asserts every string on it; what nothing looked at is
       * the notice band's tone against the card and how the button sits above
       * the "Need help?" line.
       *
       * Reached the only way it can be: book a seat, release it, and open the
       * bare URL. Cancelling revokes this very token, which is what makes the
       * link dead — no fixture hands you one.
       */
      test(`a dead readiness link renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        await page.goto(new URL(page.url()).pathname);
        await threadStatus(page).waitFor();
        await page.getByRole("button", { name: "Cancel my seat" }).click();
        await page.getByRole("button", { name: "Yes, cancel my seat" }).click();
        await page.getByRole("heading", { name: "This booking was canceled" }).waitFor();
        // Without `?cancelled=1` — the bookmarked URL, or the link out of an
        // old reminder email, which is how a diver actually arrives here.
        await page.goto(new URL(page.url()).pathname);
        await page.getByRole("heading", { name: /readiness link isn.t available/ }).waitFor();
        await capture(page, "expired-link-readiness", scheme);
      });

      /**
       * **The stranded diver's card, and what a blown-out day left standing**
       * (issue #1197, delight report D37).
       *
       * The third shape of this component and the only one nothing had ever
       * photographed — which matters more here than on the two above, because
       * this is the card a diver reads on the morning a trip they had planned
       * around was called off. It carries the cancellation, the shop's name,
       * the way to the schedule, and now a short list of the preparation that
       * survived: those records are filed against the person and the shop, not
       * the seat, so they are still there.
       *
       * The sizes are saved through the real product path first, because the
       * block renders only what is actually true and a diver who has prepared
       * nothing sees no block at all — `e2e/blowout.spec.ts` asserts both
       * directions. Reached the only way it can be reached: book, prepare,
       * blow the departure out from the staff board, reopen the same link.
       */
      test(`the stranded diver's card renders true to the design (${scheme})`, async ({
        page,
        browser,
        staffStorageState,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await bookAVisualRegressionSeat(page, scheme);
        const threadUrl = new URL(page.url()).pathname;
        await openThreadStep(page, "gear");
        await page.getByLabel("BCD size").selectOption("L");
        await page.getByLabel("Wetsuit size").selectOption("XL");
        await page.getByRole("button", { name: "Save rental fit" }).click();
        await expect(page.getByText("the crew will have your sizes")).toBeVisible();

        // The captain calls it off from a second context. This test's own page
        // is the *diver's* — signed out, which is the whole point of the card
        // being captured — and `signedInAsOwner()` is describe-scoped, so
        // borrowing the staff session for one action is what keeps them apart.
        const staffContext = await browser.newContext({
          storageState: await staffStorageState("owner"),
          colorScheme: scheme,
        });
        try {
          const staff = makeActivitySafe(await staffContext.newPage());
          const tripId = await seededTripId(staff, "blue-mantis", REEF_TRIP);
          await staff.goto(`/shop/blue-mantis/schedule/blowout/${tripId}`);
          await staff.getByRole("button", { name: "Call the blow-out" }).click();
          await staff.getByRole("heading", { level: 1, name: "Blow-out cascade" }).waitFor();
        } finally {
          await staffContext.close();
        }

        await page.goto(threadUrl);
        await page.getByRole("heading", { level: 1, name: "This trip was canceled" }).waitFor();
        await page.getByText("Still on file for you").waitFor();
        await capture(page, "stranded-diver-card", scheme);
      });

      /**
       * The same component's other shape: **no shop to attribute it to.** A
       * token that resolves to no record at all reveals nothing about why,
       * which is the bearer-token model's own guarantee — so the card is the
       * heading, the sentence, and nothing else. Worth its own baseline
       * precisely because it is the one with no content to hold it up.
       */
      test(`an unknown bearer link renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/waivers/not-a-real-token");
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await capture(page, "expired-link-unknown", scheme);
      });

      /**
       * The group-organizer surfaces (docs ADR 20260804-seat-claim-links),
       * both sides of one flow: the organizer's confirmation with the
       * "Your group's seats" claim panel, then the claim page an invited
       * diver opens from the shared link. A real party booking through the
       * public form — `demoReset` reseeds the fixture, so the two extra
       * seats never move any other capture's counts.
       */
      test(`the party organizer confirmation and claim page render true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await choosePartySize(page, 2);
        await page.getByLabel("Name", { exact: true }).fill("Orla Byrne");
        await page.getByLabel("Email", { exact: true }).fill(`organizer-${scheme}@example.com`);
        await page.getByLabel("Diver 2 name").fill("Sam Reyes");
        await page.getByLabel("Use the main contact’s email for this diver").check();
        await page.getByRole("button", { name: /^Book/ }).click();
        await page.getByRole("heading", { name: /You’ve got a seat/ }).waitFor();
        await expect(page).toHaveURL(/\/ready\//);
        await page.getByRole("heading", { name: "Your group’s seats" }).waitFor();
        await capture(page, "party-organizer-confirmation", scheme);

        // Collapsed disclosure — the token never renders as pixels (that's
        // what keeps this capture stable run to run), but the text is in the
        // DOM for textContent.
        const claimUrlText =
          (await page
            .locator("li")
            .filter({ hasText: "Sam Reyes" })
            .locator("p.font-mono")
            .textContent()) ?? "";
        const claimPath = claimUrlText.match(/\/claim\/[^\s/?#]+/)?.[0];
        await page.goto(claimPath ?? "/");
        await page.getByRole("heading", { name: /A seat on/ }).waitFor();
        await capture(page, "seat-claim", scheme);

        /**
         * **The third state of the same link: spent** (ADR
         * 20260827-first-light, decision 3, slice 10c). Claiming revokes every
         * capability on the booking, so the URL the organizer shared into a
         * group chat is dead the moment the seat changes hands — and it is the
         * *ordinary* way this page is reached, not an edge case. The token
         * still resolves to a row this app issued, which is what earns the
         * booking tier: the shop's name and its way in. What the sentence
         * beside it may say is set by the *worst* of the six causes that share
         * this card — a cancelled seat, a departure called off — so it names
         * whoever sent the link and claims nothing about the seat. Captured
         * from the real spent link rather than a hand-made expiry, because the
         * revocation is the thing.
         */
        await page.getByLabel("Your name").fill("Sam Reyes");
        await page.getByLabel("Your email").fill(`claimant-${scheme}@example.com`);
        await page.getByRole("button", { name: "Claim this seat" }).click();
        // Every claim lands on the static "check your email" page (#2381).
        await expect(page).toHaveURL(/\/claim\/[^/?#]+\?sent=1$/);
        await page.goto(claimPath ?? "/");
        await page.getByRole("heading", { name: /link isn.t available/ }).waitFor();
        await capture(page, "expired-link-claim", scheme);
      });

      /**
       * **Ask to move, before and after it is sent** (H-126; #2666). Past the
       * free-cancellation window a paid diver's page offers a request ahead of
       * the cancel that forfeits what they paid: the form, then the page
       * saying it was asked. The same flow as `e2e/ask-to-move.spec.ts`.
       */
      test(`the diver's ask-to-move form and its asked state render true to the design (${scheme})`, async ({
        page,
        browser,
        staffStorageState,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const title = "Ask To Move Two-Tank";
        const staffContext = await browser.newContext({
          storageState: await staffStorageState("owner"),
          colorScheme: scheme,
        });
        let tripId: string;
        try {
          const staff = makeActivitySafe(await staffContext.newPage());
          await createTrip(staff, {
            title,
            date: daysFromNow(5),
            departsAt: "08:00",
            returnsAt: "11:30",
            capacity: 6,
            price: 120,
            // Thirty days: five days out is long past it.
            cancellationWindowHours: 720,
          });
          tripId = await seededTripId(staff, "blue-mantis", title);
          await staff.goto(`/shop/blue-mantis/trips/${tripId}`);
          await openTripAbout(staff);
          await staff.getByText("Edit requirements", { exact: true }).click();
          await staff.getByLabel("Require payment to board").check();
          await staff.getByRole("button", { name: "Save requirements" }).click();
          await expect(staff.getByRole("status")).toContainText("requirements updated");
        } finally {
          await staffContext.close();
        }

        await page.goto(publicTripUrl(`/shop/blue-mantis/trips/${tripId}`));
        await bookASeatAndOpenThread(page, "Rafa Ortiz", `rafa-ask-${scheme}@example.com`);
        const readyUrl = page.url().split("?")[0] ?? "";

        const staffPayContext = await browser.newContext({
          storageState: await staffStorageState("owner"),
          colorScheme: scheme,
        });
        try {
          const staffPay = makeActivitySafe(await staffPayContext.newPage());
          await staffPay.goto(`/shop/blue-mantis/trips/${tripId}`);
          const row = staffPay
            .locator("li")
            .filter({ hasText: "Rafa Ortiz" })
            .filter({ visible: true });
          await openRosterDetails(row);
          await row.getByRole("combobox").selectOption("paid");
          await row.getByRole("radio", { name: "Cash" }).check();
          await row.getByRole("button", { name: "Update" }).click();
          await expect(row.getByText("Payment: Paid")).toBeVisible();
        } finally {
          await staffPayContext.close();
        }

        await page.goto(readyUrl);
        await page.getByRole("button", { name: "Ask to move" }).waitFor();
        await page.getByLabel("Dates that would work (optional)").fill("Any Saturday in August");
        await capture(page, "ready-ask-to-move", scheme);

        await page.getByRole("button", { name: "Ask to move" }).click();
        await expect(page.getByText(diverCopy("ready.moveAsk.sent"))).toBeVisible();
        await expect(page.getByRole("button", { name: "Ask to move" })).toHaveCount(0);
        await capture(page, "ready-asked-to-move", scheme);
      });

      /**
       * **A parent signs a child's release** (H-124; #2666): a lead books a
       * party with one seat "Under 18", the panel offers "Sign {name}'s
       * waiver" on that seat, and the child's own claim link says a parent
       * signs with them. The flow of the last test in
       * `e2e/guardian-co-signature.spec.ts`.
       */
      test(`the party panel's minor seat and the claim page's minor note render true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const child = "Mia Byrne";
        await page.goto("/s/blue-mantis");
        await publicReefCard(page).getByRole("link", { name: REEF_TRIP }).click();
        await choosePartySize(page, 2);
        await page.getByLabel("Name", { exact: true }).fill("Orla Byrne");
        await page
          .getByLabel("Email", { exact: true })
          .fill(`organizer-minor-${scheme}@example.com`);
        await page.getByLabel("Diver 2 name").fill(child);
        await page.getByLabel("Use the main contact’s email for this diver").check();
        await page
          .getByRole("checkbox", { name: /^Under 18/ })
          .nth(1)
          .check();
        await page.getByRole("button", { name: /^Book/ }).click();
        await expect(page).toHaveURL(/\/ready\//);
        const seatRow = page.locator("#party-seats li").filter({ hasText: child });
        await expect(
          seatRow.getByText(diverCopy("seatClaim.minorSignBody", { name: child })),
        ).toBeVisible();
        await expect(seatRow.getByRole("button", { name: `Sign ${child}’s waiver` })).toBeVisible();
        await capture(page, "party-panel-minor-seat", scheme);

        await seatRow.getByText("Show link").click();
        const claimPath = ((await seatRow.locator("p.font-mono").textContent()) ?? "").match(
          /\/claim\/[^\s/?#]+/,
        )?.[0];
        expect(claimPath).toBeTruthy();
        await page.goto(claimPath ?? "/");
        await expect(
          page.getByText(diverCopy("seatClaim.minorNote", { seatName: child }), { exact: false }),
        ).toBeVisible();
        await capture(page, "seat-claim-minor-note", scheme);
      });

      // Its own test rather than another stop on a public tour: a trust page
      // whose baseline is skipped because a long test ran out of budget is the
      // one baseline you'd most want.
      /**
       * The two legal pages, published 2026-08-14
       * (FU-20260812-no-privacy-or-terms-page). Their own captures rather than
       * a stop on a public tour, for the same reason `/about` has one: these
       * are long unbroken columns of prose, which is the shape that breaks
       * quietest — a measure that runs too wide, a dark-mode contrast that
       * fails on muted body text, a definition list whose term and body run
       * together. Nothing about them is interactive, so a screenshot is
       * genuinely the whole test.
       */
      test(`the privacy page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/privacy");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await capture(page, "privacy", scheme);
      });

      test(`the terms page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/terms");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await capture(page, "terms", scheme);
      });

      // The page a shop owner opens on their worst morning, so the one whose
      // dark mode and phone width are worth a baseline: a status mark, a
      // headline, two ruled rows and a timestamp. The clock is frozen by the
      // harness, so "Last checked …" is stable pixels rather than a mask
      // (ADR 20260907-external-uptime-monitor).
      test(`the status page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/status");
        await page.getByRole("heading", { level: 1 }).waitFor();
        await capture(page, "status", scheme);
      });

      test(`the about page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/about");
        await capture(page, "about", scheme);
      });

      // The migration-guides hub: one ruled row per thing a shop might be
      // leaving, the entry point to the portability wedge on the marketing side.
      // Also the only baseline covering `ImportPreviewFallback`, the mockup that
      // makes this page's "exactly what comes across" promise visible instead of
      // merely stated — its mapped-column chips and skipped row are the parts a
      // diff here should be read against.
      test(`the switching hub renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching");
        await page
          .getByRole("heading", { name: "Every guide ends at the same import screen." })
          .waitFor();
        await capture(page, "switching-hub", scheme);
      });

      // The "Switching from EVE" migration guide: the marketing face of the
      // portability wedge — export click-path, the shared scope table, and the
      // importer, on the market's most motivated switching pool. Represents the
      // one shared composition (`src/app/switching/_components/guide.tsx`) that
      // every guide, incumbent or not, renders as a single numbered move rail.
      test(`the EVE switching guide renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching/eve");
        await page.getByRole("heading", { name: "Moving your shop off EVE" }).waitFor();
        await capture(page, "switching-eve", scheme);
      });

      // The non-incumbent switching guide: shops coming from a spreadsheet — the
      // market's largest under-served pool. Same shared composition as the
      // incumbent guides, with its own first phase (columns-that-matter, the
      // downloadable template) and three rail phases instead of four — there is
      // no incumbent to cut over from.
      test(`the spreadsheet switching guide renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/switching/spreadsheet");
        await page.getByRole("heading", { name: "Bring the spreadsheet with you." }).waitFor();
        await capture(page, "switching-spreadsheet", scheme);
      });

      // The FareHarbor guide: the coexist-led variant of the composition, for a
      // booking channel a shop keeps rather than a records system it leaves —
      // the "keep it, or leave it" section (the ruled run-the-day list plus the
      // leave path) that only the channel guides render.
      test(`the FareHarbor switching guide renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/switching/fareharbor");
        await page
          .getByRole("heading", { name: "FareHarbor fills the seats. DiveDay runs the boat." })
          .waitFor();
        await capture(page, "switching-fareharbor", scheme);
      });

      // The Rezdy guide: the second booking-channel guide, same coexist shape
      // with its own copy (a monthly-plus-per-booking model). Baselined so its
      // page — and the extra hub row it adds — stay pixel-stable.
      test(`the Rezdy switching guide renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/switching/rezdy");
        await page
          .getByRole("heading", { name: "Rezdy sells the seats. DiveDay runs the boat." })
          .waitFor();
        await capture(page, "switching-rezdy", scheme);
      });

      // The twelve feature pages (`src/lib/feature-pages.ts`, H-93). One
      // template draws them all, so what differs from page to page is the copy
      // and the screen each one draws (`src/components/MarketingFeatureScreens.tsx`
      // and the three older drawings it reuses). Every page is captured because
      // every page draws a different screen, and the screen is the part a diff
      // here should be read against. Spelled out one by one rather than looped,
      // so each name is one `scripts/route-coverage.json` can find.
      const openFeaturePage = async (page: Page, slug: FeaturePageSlug) => {
        await page.goto(featurePagePath(slug));
        // The route owns a loading.tsx, so the page's own <h1> is the readiness
        // proof, as on the onboarding form: the skeleton draws none.
        await page.getByRole("heading", { level: 1 }).waitFor();
      };

      test(`the online booking feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "online-booking");
        await capture(page, "feature-online-booking", scheme);
      });

      test(`the website feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "website");
        await capture(page, "feature-website", scheme);
      });

      test(`the waivers feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "waivers");
        await capture(page, "feature-waivers", scheme);
      });

      test(`the certifications feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "certifications");
        await capture(page, "feature-certifications", scheme);
      });

      test(`the messages feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "messages");
        await capture(page, "feature-messages", scheme);
      });

      test(`the check-in feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "check-in");
        await capture(page, "feature-check-in", scheme);
      });

      test(`the boat manifest feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "boat-manifest");
        await capture(page, "feature-boat-manifest", scheme);
      });

      test(`the dive sites feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "dive-sites");
        await capture(page, "feature-dive-sites", scheme);
      });

      test(`the rental gear feature page renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openFeaturePage(page, "rental-gear");
        await capture(page, "feature-rental-gear", scheme);
      });

      test(`the schedule feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "schedule");
        await capture(page, "feature-schedule", scheme);
      });

      test(`the courses feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "courses");
        await capture(page, "feature-courses", scheme);
      });

      test(`the payments feature page renders true to the design (${scheme})`, async ({ page }) => {
        await openFeaturePage(page, "payments");
        await capture(page, "feature-payments", scheme);
      });

      /**
       * The seeded demo shop's day spine never runs dry, so the shared
       * `EmptyState` card the spine renders when nothing needs attention
       * (docs/design/principles.md, terminal-vs-section empty states) has no
       * other baseline. A freshly onboarded shop is the real "empty queue"
       * scenario — same flow as e2e/onboard.spec.ts's first-run checklist test.
       *
       * **Two captures in one test, deliberately.** `settings-billing` is
       * this shop's Settings > Billing page — demo shops have no Billing door
       * and are never billed, so `blue-mantis` (the seeded demo shop the
       * other settings captures use) can never show a trial's standing. Both
       * images contain the shop's slug — the first-run checklist renders the
       * public schedule URL. A second test would have to onboard a *second*
       * shop, because `/api/test/reset` reseeds the demo shop and purges
       * minted demo shops but does not delete one created through `/onboard`,
       * so the slug would have to differ — and a different slug is different
       * pixels in every baseline. Splitting here would move a baseline to buy
       * isolation, which is the wrong trade; the captures are one
       * onboarded session anyway. The trial's standing is clock-anchored and
       * deterministic: this shop's `created_at` is the harness's one frozen
       * instant, so "21 days left" and the end date never drift between runs.
       */
      test(`a freshly onboarded shop's Today tab renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // A real sign-up flow, then two captures.
        test.setTimeout(FLOW_TIMEOUT_MS);
        // Deterministic, not Date.now(): this slug renders on screen (the
        // "Share your public schedule" URL), and neither DIVEDAY_CLOCK nor the
        // browser-context clock fixture freezes a value read in the Node.js
        // test process itself — a wall-clock slug here is a permanent visual
        // diff between CI runs, not a real regression. `scheme` alone
        // (light/dark) is unique enough since this test runs once per scheme
        // and the suite has no retries (playwright.config.ts).
        const unique = `today-empty-${scheme}`;
        await page.goto(await mintOnboardFormPath(page));
        await page
          .locator('input[name="shopName"]')
          .filter({ visible: true })
          .fill("Fresh Shop E2E");
        await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
        await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
        await page
          .locator('input[name="ownerEmail"]')
          .filter({ visible: true })
          .fill(`${unique}@example.com`);
        await page
          .locator('input[name="ownerPassword"]')
          .filter({ visible: true })
          .fill("trial-pass-123");
        await page.getByRole("button", { name: "Create shop & start trial" }).click();
        await page.waitForURL(new RegExp(`/shop/${unique}$`));
        await page.getByRole("heading", { name: "First morning" }).waitFor();
        // The canvas's `FirstMorning` board: the setup ledger as the day
        // spine's leading group, under its own group label (ADR
        // 20260827-first-light, decision 6). The checklist is the page now. The queue's "Nothing is waiting on
        // you" state — a claim about a roster this shop does not have — used to
        // render directly beneath it, and the header sentence above said "No
        // boats out today" of a shop that has never had a board (issue #711).
        await expect(page.getByRole("heading", { name: "Nothing is waiting on you" })).toHaveCount(
          0,
        );
        await capture(page, "today-empty", scheme);

        // **`today-empty-departures` retired here**, with the by-departure view
        // it photographed: that capture existed to catch `BlockerGroups`'s own
        // `EmptyState`, and both are gone (ADR
        // 20260827-clearwater-surface-language, decision 4). The one empty
        // state left on this page is the spine's, which `today-empty` above
        // already frames.

        // **The page this shop is told to paste on its website.** Step 4 of the
        // checklist above hands over this URL, and nothing had ever
        // photographed what a visitor finds at it before the shop has data —
        // the seed, the specs and every other capture see a shop with a board.
        // What was there: an empty state telling a diver to call a number the
        // page withholds, a discount list for boats that do not exist, and the
        // one form that would help switched off because the shop had not set a
        // contact email (issue #710). Free to take here — the shop already
        // exists and this is one navigation.
        await page.goto(`/s/${unique}`);
        // A shop this new has nothing on the board, so it lands in the quiet
        // state N-45 designed rather than the empty list it used to show. The
        // heading it waits for is the one that replaced "No trips on the books
        // yet" — a sentence that read as a shop which had stopped rather than
        // one which had not started, which is exactly the wrong thing to say
        // on the page a shop is told to paste on its own website.
        await page.getByRole("heading", { name: "Nothing on the water for a while" }).waitFor();
        // **Day zero is a shape, not a failure state** (ADR
        // 20260827-clearwater-surface-language, decision 8). The hero is the
        // shop's name and nothing else — no tagline it has not written, no
        // rating nobody has left, no DiveDay sentence standing in for either —
        // and with no boat to book, the page's one primary becomes the
        // date-request composer's own submit.
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fresh Shop E2E");
        await expect(page.getByRole("region", { name: "Next boat with space" })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "Book this boat" })).toHaveCount(0);
        await capture(page, "public-schedule-new-shop", scheme);
        // In the quiet state the composer is the page's one primary and comes
        // up already open, so there is no disclosure left to click — the shot
        // above now carries the form rather than a collapsed row. Assert it is
        // reachable without one, which is the promotion N-45 makes.
        await expect(page.locator("details#request-a-date > summary")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible();

        // **The board before anything is on it.** The `schedule-builder`
        // baseline is shot against blue-mantis, whose board always has
        // fourteen departures, so the state a new owner actually opens on had
        // no capture at all — and it had grown four controls, two of them
        // primary-weight, one of which ("Add a booking") leads to a departure
        // picker with no departures in it (issue 797). The header now stands
        // down here and the empty state holds the one door. Free to take —
        // the shop and the session already exist.
        await page.goto(`/shop/${unique}/schedule/board`);
        await page.getByRole("heading", { name: "Nothing upcoming on the board" }).waitFor();
        await capture(page, "schedule-builder-empty", scheme);

        // Same session, straight to Settings > Billing: the one place a trial
        // shop's owner sees its standing (days left, and — with the billing
        // env absent here, as in every e2e build — "billing isn't turned on").
        await page.goto(`/shop/${unique}/settings/billing`);
        await page.getByRole("heading", { name: "Your plan" }).waitFor();
        await capture(page, "settings-billing", scheme);

        // **The Gear page before a fleet exists** (issue #2412): the empty
        // register and the one door it holds, which nothing photographed. Free
        // to take here for the reason the board's empty frame is: the shop and
        // its session already exist, and no other shop in the suite has no gear.
        await page.goto(`/shop/${unique}/gear`);
        await page.getByRole("heading", { name: "No gear on the register yet" }).waitFor();
        await capture(page, "gear-empty", scheme);
      });

      /**
       * The bookable moment: the first departure ever landing on the board is
       * the exact instant the first-run checklist (and the share link it
       * carried) leaves Today, so the created notice grows into a share card
       * exactly once — e2e/first-ten-minutes.spec.ts drives the behavior, this
       * is the surface. Same fresh-shop-per-scheme pattern (and deterministic
       * slug reasoning) as the `today-empty` capture above: the slug renders
       * inside the card, so it must not contain a wall-clock stamp.
       */
      test(`the first bookable moment renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const unique = `bookable-${scheme}`;
        await page.goto(await mintOnboardFormPath(page));
        await page
          .locator('input[name="shopName"]')
          .filter({ visible: true })
          .fill("Bookable Moment E2E");
        await page.locator('input[name="shopSlug"]').filter({ visible: true }).fill(unique);
        await page.locator('input[name="ownerName"]').filter({ visible: true }).fill("Nour Haddad");
        await page
          .locator('input[name="ownerEmail"]')
          .filter({ visible: true })
          .fill(`${unique}@example.com`);
        await page
          .locator('input[name="ownerPassword"]')
          .filter({ visible: true })
          .fill("trial-pass-123");
        await page.getByRole("button", { name: "Create shop & start trial" }).click();
        await page.waitForURL(new RegExp(`/shop/${unique}$`));

        // The first (and only-ever-first) departure, dated off the frozen
        // clock so the card and queue rows render pixel-identically per run.
        await page.goto(`/shop/${unique}/schedule/board?add=1`);
        const tomorrow = new Date(Date.parse(E2E_FROZEN_CLOCK) + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        await page.locator('input[name="title"]').fill("Two-Tank Morning Reef");
        await page.locator('input[name="date"]').fill(tomorrow);
        await page.getByLabel("Departs").fill("08:00");
        await page.getByLabel("Returns").fill("12:30");
        await page.getByRole("button", { name: "Put it on the board" }).click();
        await page.waitForURL(new RegExp(`/shop/${unique}\\?created=`));
        await page.getByRole("heading", { name: "Your shop is bookable." }).waitFor();
        await capture(page, "today-first-bookable", scheme);

        // The orientation's *other* form, on the same shop rather than a
        // second sign-up. `RoleOrientationCard` above is what a Today with
        // nothing on it renders; the moment the page has work to show
        // (`hasWorkToShow`, src/app/shop/[shopSlug]/page.tsx) the same pointer
        // compresses to `RoleOrientationLine` so the queue keeps the top of
        // the page. Reaching that state needs a real shop whose owner has not
        // dismissed orientation *and* a queue row — the demo shop suppresses
        // orientation entirely and `today-empty` deliberately has no bookings,
        // so no other capture in this suite can render the line.
        //
        // One hand-entered diver is enough: seating owes a waiver on join
        // (src/db/seat-diver.ts), the departure is inside the operational
        // horizon, so Today gains a waiver row.
        await page.goto(`/shop/${unique}/bookings/new`);
        await page.getByRole("link", { name: /Two-Tank Morning Reef/ }).click();
        await page.getByRole("link", { name: "Add diver" }).click();
        await page.waitForURL(/\/divers\/new\?/);
        await page.getByLabel("Full name").fill("Marisol Vega");
        await page.getByLabel("Email", { exact: true }).fill(`marisol-${scheme}@example.com`);
        await page.getByRole("button", { name: "Add to trip" }).click();
        await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);

        await page.goto(`/shop/${unique}`);
        // The line's own tour link, which is what the line exists to keep.
        await page
          .getByRole("link", { name: "Open Schedule to see this week’s departures." })
          .waitFor();
        // ...and proof it is the line and not the card: the two forms share
        // that link, so waiting on it alone would pass on either.
        await expect(
          page.getByRole("heading", { name: "New here? A few pointers for your role." }),
        ).toHaveCount(0);
        // **The coral morning, in the same frame** (the canvas's `FirstBooking`
        // board; ADR 20260827-first-light, decision 6). Marisol Vega is this
        // shop's first booking ever and her departure is still ahead, so the
        // once-ever moment is live here — and it is live in exactly one place
        // in the suite, because every other shop with bookings has more than
        // one. Deliberately *not* a second capture: it is the same page at the
        // same viewport, and a duplicate frame buys a name, not a baseline.
        await expect(page.getByText("Your first booking")).toBeVisible();
        // `.first()`: her name is also the subject of the waiver row her own
        // seat just created, which is the point — the moment names the diver,
        // the queue names the job.
        await expect(page.getByText("Marisol Vega").first()).toBeVisible();
        await capture(page, "today-orientation-line", scheme);
      });
    });

    /**
     * The marketing header's second face. `MarketingNavView` renders two
     * different bars off one session read: signed out it offers "Sign in" and
     * "Try the live demo" (#934); signed in it drops the sign-in link entirely
     * and turns the CTA slot into the way back to that staffer's own shop.
     * Every public capture above is the signed-out bar, so the signed-in one —
     * the header a shop owner actually sees every time they come back to read
     * the pricing page — had no baseline at all.
     *
     * Its own `test.describe` because `signedInAsOwner()` is a describe-scoped
     * `storageState`; the sibling "public" block must stay anonymous.
     *
     * Shot on `/onboard` rather than the landing page for two reasons. It is
     * the shortest marketing surface (one sentence and a mail), so the
     * duplicated body below the header costs the least; and it is the one page
     * that sets `hideCta`, where the signed-in branch has a documented rule
     * with nothing watching
     * it — the CTA *pitch* is suppressed, but the way back to your own shop is
     * wayfinding and still renders. The header markup is identical on every
     * marketing route, so this frame is the state, not a special case of it.
     */
    test.describe("public, signed in", () => {
      signedInAsOwner();

      test(`the marketing header renders true to the design for a signed-in staffer (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/onboard");
        // Wait on the signed-in CTA itself, not the page heading: the heading
        // renders in the static shell, so it proves nothing about the
        // session-aware nav having streamed in over MarketingNavFallback.
        // Scoped to the banner because the footer grew its own session-aware
        // "Go to shop" link when it was aligned with the nav (#394). That one
        // streams in from a different server component, so waiting on whichever
        // resolved first would let the header still be showing its fallback at
        // capture time — the one thing this frame exists to catch.
        //
        // By landmark role rather than by the nav's accessible name: that name
        // is `t("nav.mainNavigation")`, a message-bundle string, so matching on
        // its English text would couple this spec to one locale. `banner` is
        // the `<header>` the nav sits in and carries no copy.
        await page.getByRole("banner").getByRole("link", { name: "Go to shop" }).waitFor();
        await capture(page, "marketing-nav-signed-in", scheme);
      });
    });

    test.describe("staff", () => {
      signedInAsOwner();

      test(`the day spine renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis");
        await page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING }).waitFor();
        await capture(page, "today", scheme);
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
       * **The hold a move leaves under Save** (issue #2513, UX review
       * 2026-10-11 item 1): "Telling … the new time…" counts down and then
       * speaks, so the frame kept is the settled one after Undo, "Not told"
       * with its "Tell them" door. On the trip page, from the Details form.
       */
      test(`the trip page holds a reschedule notice under Save (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripAbout(page);
        await page.getByText("Edit details", { exact: true }).click();
        await page.getByLabel("Departs").fill("13:45");
        await page.getByLabel("Returns").fill("17:15");
        await page.getByRole("button", { name: "Save changes" }).click();
        await page.getByText(/^Telling \d+ divers? the new time…$/).waitFor();
        await page.getByRole("button", { name: "Undo" }).click();
        await page.getByText(staffTranslator("en-US")("shared.rescheduleHold.notTold")).waitFor();
        await capture(page, "trip-reschedule-hold", scheme);
      });

      /** The same hold on the schedule board, under the move's own notice. */
      test(`the board holds a reschedule notice after a move (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await boardListSettled(page);
        // The first departure with divers booked that has not counted heads;
        // the panel's own refusal line says which (schedule-builder.spec.ts).
        const titles = await page
          .getByRole("button", { name: /^Move, copy, or remove / })
          .evaluateAll((nodes) =>
            nodes.map(
              (node) =>
                /^Move, copy, or remove ([^,]+),/.exec(node.getAttribute("aria-label") ?? "")?.[1],
            ),
          );
        let moved = false;
        for (const title of new Set(titles.filter(Boolean))) {
          const row = page
            .getByRole("listitem")
            .filter({ hasText: title as string })
            .first();
          const text = (await row.textContent()) ?? "";
          if (!/(?:^|\D)[1-9]\d* of \d+/.test(text) || text.includes("Sailed")) continue;
          await page
            .getByRole("button", { name: new RegExp(`^Move, copy, or remove ${title},`) })
            .first()
            .click();
          await page
            .getByRole("button", { name: new RegExp(`^Move ${title},`) })
            .first()
            .click();
          await page.locator("[data-move-preflight]").waitFor({ state: "attached" });
          if ((await page.getByText("already counted heads").count()) === 0) {
            moved = true;
            break;
          }
          await page.getByRole("button", { name: "Cancel" }).click();
        }
        expect(moved).toBe(true);
        const date = page.getByLabel("New date");
        const next = new Date(`${await date.inputValue()}T12:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        await date.fill(next.toISOString().slice(0, 10));
        await page.getByRole("button", { name: "Move it" }).click();
        await page.getByText(/^Telling \d+ divers? the new time…$/).waitFor();
        await page.getByRole("button", { name: "Undo" }).click();
        await page.getByText(staffTranslator("en-US")("shared.rescheduleHold.notTold")).waitFor();
        await capture(page, "schedule-builder-reschedule-hold", scheme);
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
       * the row reads "Signed waiver lapsed." — a signature that no longer
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
          .filter({ hasText: "Aboard" })
          .filter({ hasText: "Signed waiver lapsed." })
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
        const door = row
          .locator("details")
          .filter({ has: page.getByText("Turn away…", { exact: true }) });
        await door.locator("> summary").click();
        await disclosureSettled(door);
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

      // The counter's mode of the departure door: the new-diver form for a walk-in
      // on a boat's Divers tab, no required email at the desk. The boat is the
      // form's own `tripId`, so there is no picker. The boat's Divers tab (its
      // search and "Add as a walk-in") is the departure capture's.
      const openWalkInForm = async (page: Page) => {
        const tripId = await openCounterFor(page, "blue-mantis", "Priya Sharma");
        await page.goto(walkInFormPath("blue-mantis", tripId));
        await page.getByRole("heading", { name: "Add a diver", level: 1 }).waitFor();
      };

      /**
       * **"Took a call"** (N-22), folded into Add a booking as its last
       * disclosure, on the branch that shows the most: the date request, whose
       * extra block is the only part of this form that is not the caller's own
       * three boxes. Opened by its `#call` hash and the branch chosen from the
       * URL rather than by clicking, so the picture cannot depend on a click
       * landing before the shot.
       */
      test(`the desk phone's door renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/bookings/new?outcome=date-request#call");
        await page.getByRole("heading", { name: "Full boat or another day?" }).waitFor();
        await page.getByLabel("What they asked about").waitFor();
        await page.locator("#call").scrollIntoViewIfNeeded();
        await capture(page, "took-a-call", scheme);
      });

      test(`the walk-in diver step renders true to the design (${scheme})`, async ({ page }) => {
        await openWalkInForm(page);
        await capture(page, "trip-walk-in-diver", scheme);
      });

      // **A walk-in family on one form** (fifth loop, item 9): the same diver
      // step with two more people added, one of them ticked "Under 18". Pinned
      // words so the picture is the same on every run.
      test(`the walk-in party rows render true to the design (${scheme})`, async ({ page }) => {
        await openWalkInForm(page);
        await page.getByLabel("Full name").first().fill("Ana Brightwater");
        await page.getByRole("button", { name: "Add another person" }).click();
        const second = page.getByRole("group", { name: "Person 2" });
        await second.getByLabel("Full name").fill("Mia Brightwater");
        await second.getByLabel(/Under 18/).check();
        await page.getByRole("button", { name: "Add another person" }).click();
        await page
          .getByRole("group", { name: "Person 3" })
          .getByLabel("Full name")
          .fill("Leo Brightwater");
        await capture(page, "trip-walk-in-party", scheme);
      });

      // The global Add-booking door, both halves: the departure picker — one
      // ledger grouped by day since slice 9g of ADR
      // 20260827-the-shops-shelves, seats-left on every row — and the diver
      // step once a boat is chosen (returning-diver search + hand entry). Two
      // captures and two tests — the picker and the diver form never share a
      // screen, so one shot would leave half the surface with no baseline at
      // all, and one *test* would let a broken picker take the diver form's
      // baseline with it.
      test(`the Add-booking departure picker renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/bookings/new");
        await page.getByRole("heading", { name: "Add a booking", level: 1 }).waitFor();
        // The day headings are the composition; wait for the first one rather
        // than for the h1, which paints with the static shell.
        await page.getByRole("heading", { level: 3 }).first().waitFor();
        await capture(page, "booking-new", scheme);
      });

      test(`the Add-booking diver step renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/bookings/new");
        await page.getByRole("heading", { name: "Add a booking", level: 1 }).waitFor();
        // The whole row is the door and its accessible name is the departure's
        // title — the seats-left fact rides beside it rather than inside the
        // link, so it is the row that is clicked here.
        //
        // **Scoped to the picker.** This page opens with "Relevant requests"
        // above the departures, and those rows are `<li>`s too — so an
        // unscoped `listitem` query took the first *date request*, whose link
        // is `?request=<id>` on this same page and can never satisfy the
        // `waitForURL` below. The capture then burned its whole budget and
        // took the shard down with it, which is worse than a wrong picture:
        // reg-suit skips its compare when a shard fails and reports green over
        // nothing compared.
        await page
          .getByRole("region", { name: "Which departure?" })
          .getByRole("listitem")
          .first()
          .getByRole("link")
          .first()
          .click();
        await page.waitForURL(/\/bookings\/new\/[^/?]+$/);
        await page.getByRole("link", { name: "Add diver", exact: true }).click();
        await page.waitForURL(/\/divers\/new/);
        await page.getByRole("heading", { name: "Add a diver", level: 1 }).waitFor();
        await capture(page, "booking-new-diver", scheme);
      });

      /**
       * **Wait for the list's own tail, not just the shell.**
       *
       * The board is `instant = true` with a `loading.tsx`, so its departures
       * arrive by PPR streaming *after* the heading these shots used to gate on.
       * That is the same race this file already documents for the public
       * schedule ("two runs catching different skeleton frames is what produced
       * the schedule-dark diffs on builds with no code change") — and it came
       * back here: `schedule-builder-add-dark-vw-390` reported changed on a PR
       * that touches neither the board nor anything it renders, and the whole
       * difference was 168px of missing tail with "Show later departures" in it.
       * One variant out of four, which is what a race looks like and what a code
       * change does not.
       *
       * **The signal is the week's own pager now** (#1923). It used to be the
       * day stream's cursor link, `a[data-board-pager='next']`, and that went
       * with the stream. The week's "Next week" step is the same kind of
       * thing: it arrives in the board's streamed payload and is stable —
       * every week has a next one, whatever the seed holds.
       *
       * **Attached, and by attribute.** A visibility wait is what spent three
       * board captures' whole 184s budget once, and the role query cannot
       * express "attached": `e2e/fixtures.ts` appends
       * `.filter({ visible: true })` to every one of them, which is visible in
       * the CI call log and which silently discards `includeHidden`.
       * `page.locator` is the query it leaves alone.
       */
      const boardListSettled = (page: Page) =>
        page.locator('[data-week-board] a[data-week-step="next"]').waitFor({ state: "attached" });

      /**
       * **Prove the add panel is open before photographing it — every other
       * gate this capture has is equally true of the board with it shut.**
       *
       * `schedule-builder-add` used to gate on the placeholder `<option
       * disabled>` inside `select[name="courseId"]` detaching, which is the
       * right signal that the panel's own fetch has landed and the shot will
       * not be of "Loading…". It is the wrong signal for whether the panel
       * exists: Playwright resolves `state: "detached"` **immediately** for a
       * locator matching nothing, and before the panel mounts there is no
       * `select[name="courseId"]` at all. The gate was therefore true at
       * exactly the moment it was meant to be false, and the capture's two
       * other gates cannot tell the pages apart — the `Board` heading and the
       * board's trailing pager render identically either way.
       *
       * Measured rather than reasoned. Instrumenting `capture()` to log
       * `location.href` beside `document.documentElement.scrollHeight`, a
       * `--repeat-each=5` run caught `schedule-builder-add` shooting
       * `/schedule/board` with no `?add=` twice, at 3,828px — the
       * `schedule-builder` baseline's own height, the same page — against
       * 4,986px on `/schedule/board?add=1`. The click's client navigation had
       * simply not committed, and nothing waited for it. The old gate also
       * admitted a half-settled panel at 4,818px, the 168px that made this
       * look like a pager appearing and disappearing.
       *
       * It is not the pager. The trailing "Show later departures" control was
       * present in every probe of both runs, and the demo shop seeds 48
       * upcoming departures against a 14-row keyset page, so `nextCursor` is
       * never null and the control is never conditional. With the gates below,
       * 20 consecutive captures measured 4,986px and 3,136px, every one.
       *
       * Read the two heights as history: that control was the day stream's,
       * and the stream is gone (#1923). The gates are what mattered and they
       * still hold; the numbers they stabilised moved with the composition.
       */
      const addPanelSettled = async (page: Page) => {
        // The click's client navigation has committed. Every other gate below
        // — and both of this capture's outer ones — is equally true of the
        // *pre-click* board, so this is the only one that can tell the two
        // pages apart. A no-op for the expanded capture, which `goto`s the
        // panel state directly.
        await page.waitForURL(/[?&]add=/);
        const courseSelect = page.locator('select[name="courseId"]');
        // The panel is mounted. Without this the wait below is vacuous.
        await courseSelect.waitFor({ state: "attached" });
        // `loadBuilderOptionsAction` has answered. One select speaks for both:
        // the two placeholders are driven by the same `options === null`, and
        // the dive-site select is `hidden` in the expanded panel, where a wait
        // on its visibility would never resolve.
        await courseSelect.locator("option[disabled]").waitFor({ state: "detached" });
      };

      // The staff schedule as a builder: departures grouped by day, each row
      // carrying its crew and one quiet "⋯" disclosure for move/copy/remove.
      test(`the schedule board renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await boardListSettled(page);
        await capture(page, "schedule-builder", scheme);
      });

      /**
       * **Rostered and away, on the board** (fourth review, item 12). The demo
       * marks Marcus Webb away three and four days out; a departure of the
       * capture's own on the first of those days, with him rostered, carries
       * the warning line under its facts.
       */
      test(`the week says who is rostered while away (${scheme})`, async ({ page }) => {
        test.setTimeout(60_000);
        const title = `Away-day refresher (${scheme})`;
        const day = daysFromNow(3);
        await createTrip(page, { title, date: day, departsAt: "09:00", returnsAt: "12:00" });
        await page.goto(await tripPathByTitle(page, "blue-mantis", title));
        await openTripAbout(page);
        await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
        await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
        await page.getByRole("button", { name: "Unassign Marcus Webb" }).waitFor();
        await page.goto(`/shop/blue-mantis/schedule/board?week=${weekStartOf(day)}`);
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await boardListSettled(page);
        await page
          .getByText(/^Marcus Webb away /)
          .first()
          .waitFor();
        await capture(page, "schedule-builder-crew-away", scheme);
      });

      /**
       * **The days somebody asked for, under the week they belong to** (ADR
       * 20260919-one-idea, slice 23f).
       *
       * A week off the current one, because that is where the seeded leads
       * are: `seed-date-requests.ts` places them twelve and thirteen days out,
       * and the week board is seven days wide. Addressed by `?week=` rather
       * than by clicking the pager twice — the pager has its own coverage, and
       * a capture that has to navigate first is a capture that can fail for a
       * reason that is not about pixels.
       */
      test(`the week draws the days somebody asked for (${scheme})`, async ({ page }) => {
        // Derived from the fleet's frozen clock rather than written down: the
        // seed places these leads twelve days out, so a literal date here
        // would rot the moment either moves. Monday-first, like the board.
        const day = new Date(e2eNow());
        day.setUTCDate(day.getUTCDate() + 12);
        day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
        const asked = day.toISOString().slice(0, 10);
        await page.goto(`/shop/blue-mantis/schedule/board?week=${asked}`);
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await boardListSettled(page);
        await page.getByText("Asked for").waitFor();
        await capture(page, "schedule-builder-asked", scheme);
      });

      /**
       * **A row's "⋯" list, open under the button that opened it** (the "..."
       * bugs, 2026-10). It used to render as a strip at the foot of the whole
       * week, so no capture of the board ever showed it beside its row. The
       * wait is on the list's own hook, which exists only while it is open.
       */
      test(`a row's ⋯ list opens under its row (${scheme})`, async ({ page }) => {
        const title = "Wreck Trip — Spiegel Grove";
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await boardListSettled(page);
        await page
          .getByRole("button", { name: new RegExp(`^Move, copy, or remove ${title},`) })
          .first()
          .click();
        await page.locator("[data-row-menu]").waitFor();
        await capture(page, "schedule-builder-row-menu", scheme);
      });

      /**
       * **The move panel with its impact preview** (issue #1203, D43).
       *
       * The one seeded departure that has consequences worth stating: the
       * Spiegel Grove wreck trip carries the demo's only booking confirmations
       * and its reserved gear, so this photographs the block populated rather
       * than the empty case every other row shows. That every other row shows
       * nothing is the point of the feature and is covered by unit tests; a
       * capture of an absent block would be a capture of the board.
       *
       * Gated on the block's own heading, which only renders once the panel's
       * read has landed — the preview is fetched when the panel opens, so the
       * `Board` heading and the pager are both true before it exists.
       *
       * **Both widths show the panel** as of issue #1309. This used to force
       * the phone viewport before opening, because the board's two
       * compositions — the vertical day stream below `xl`, the week grid at and
       * above it — keyed their panels separately (`move:` against `w:move:`),
       * so whichever was open closed the moment `capture()` resized through the
       * other and the 1280 sibling was a duplicate of the plain week grid: two
       * baseline names for one image, and a reviewer triaging the same board
       * change twice. The panel now renders once for the whole board, outside
       * both compositions, so it survives the resize and each width photographs
       * what it says it does — the narrow column where a block of prose stacked
       * above a two-field form would crowd, and the wide one where it runs full
       * width beneath the grid.
       */
      test(`the move panel says what a move will cost (${scheme})`, async ({ page }) => {
        const title = "Wreck Trip — Spiegel Grove";
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await boardListSettled(page);
        await page
          .getByRole("button", { name: new RegExp(`^Move, copy, or remove ${title},`) })
          .first()
          .click();
        await page
          .getByRole("button", { name: new RegExp(`^Move ${title},`) })
          .first()
          .click();
        await page.getByText("If you move it").waitFor();
        await capture(page, "schedule-builder-move-impact", scheme);
      });

      /**
       * **The same panel once a target date is typed** (issue #1688).
       *
       * The capture above opens the panel and never touches the fields, and
       * `getMovePreflight` only asks `crewMoveConflicts` when it is given a
       * target — so the baseline holds the muted costs list alone and the crew
       * clash, the loudest line the block can draw, is in no baseline at all.
       * It is the only state where two warning weights stack: a
       * `role="alert"` line per clashing person above the muted "If you move
       * it" list.
       *
       * No seeding. `seed-trips.ts` puts the same captain and divemaster on
       * every seeded charter, so landing one charter on another's hours is the
       * whole of it — the target below is the Christ of the Abyss window
       * (`at(7, 11, 30)` in the seed), and the wreck charter is the mover
       * because it is the one departure carrying paid seats, reserved gear and
       * told divers, which is what keeps the muted list in the frame too.
       *
       * **The wait is on the clash sentence, not on `data-move-impact`.** That
       * attribute is already on the page from the target-null read the panel
       * opened with, so waiting on it resolves instantly against the *old*
       * preview and shoots the panel without the clash. And the sentence names
       * the other departure, which is what makes a mistyped date fail loudly
       * here rather than silently photograph the calm state.
       *
       * Both fields are filled before anything is waited on: `MoveImpact`
       * re-reads on every change to either string and discards stale answers
       * with its own `live` flag, so a wait between the two would be a wait on
       * a read that is about to be replaced.
       */
      test(`the move panel says who would be on two boats (${scheme})`, async ({ page }) => {
        const title = "Wreck Trip — Spiegel Grove";
        const host = "Two-Tank Reef — Christ of the Abyss";
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await boardListSettled(page);
        await page
          .getByRole("button", { name: new RegExp(`^Move, copy, or remove ${title},`) })
          .first()
          .click();
        await page
          .getByRole("button", { name: new RegExp(`^Move ${title},`) })
          .first()
          .click();
        await page.getByLabel("New date").fill(daysFromNow(7));
        await page.getByLabel("New departure time").fill("11:30");
        // One alert per person, because two clashing crew are two facts — and
        // the muted list is still under them, which is the stack worth a
        // baseline.
        await expect(
          page.getByText(new RegExp(`is already rostered on ${host} at that time`)),
        ).toHaveCount(2);
        await expect(page.getByText("If you move it")).toBeVisible();
        await capture(page, "schedule-builder-move-clash", scheme);
      });

      /**
       * **The state the panel refuses outright** (issue #1786) — the third and
       * last thing `MoveImpact` can draw, and the one with no baseline: a
       * warning-toned `role="alert"` above the muted costs list, saying the
       * move will not happen at all.
       *
       * The issue proposed a charter whose window had already passed.
       * `blockedReason` (`src/lib/move-preflight.ts`) does not read the clock:
       * it refuses a cancelled departure as `not_scheduled` and one the crew
       * have counted heads against as `already_sailed`. So the seed records a
       * single boarding through `recordRollCall`, which is cheaper, is the
       * product's own door, and leaves the departure on the board the panel is
       * opened from — a row dragged into the past would not be on it.
       *
       * `not_scheduled` is deliberately not photographed beside it. The board's
       * stream carries upcoming departures, a cancelled one is not among them,
       * and the two refusals draw the same element with different words — a
       * second capture would buy one message bundle string.
       *
       * **The wait is on the banner's own sentence**, for the reason the clash
       * capture states about `data-move-impact`: that attribute is on the page
       * from the read the panel opens with, so waiting on it proves nothing
       * about which preview is drawn.
       */
      test(`the move panel refuses a departure the crew has counted (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?moveBlocked=1");
        expect(seeded.ok()).toBe(true);
        const { moveBlocked } = (await seeded.json()) as {
          moveBlocked?: { tripId: string; title: string };
        };
        if (!moveBlocked) {
          throw new Error("seed-trouble-states found no upcoming departure to count heads on");
        }

        // **Anchored, not a substring.** "Move <title>" *is* a substring of the
        // row's own "Move, copy, or remove <title>" — `remove` ends in `move`
        // — so a substring match re-clicks the control that disclosed the
        // panel and shuts it again, which is what the first run of this
        // capture photographed. The title comes back from the seed rather
        // than being spelled here, so it is escaped before it becomes a
        // pattern.
        const rowAction = (verb: string) =>
          new RegExp(`^${verb} ${moveBlocked.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},`);

        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await boardListSettled(page);
        await page
          .getByRole("button", { name: rowAction("Move, copy, or remove") })
          .first()
          .click();
        await page
          .getByRole("button", { name: rowAction("Move") })
          .first()
          .click();
        await expect(page.getByText(/The crew has already counted heads/)).toBeVisible();
        await capture(page, "schedule-builder-move-blocked", scheme);
      });

      /**
       * **A snorkeler and a rider aboard** (ADR 20261007-participant-types):
       * the roster's type badge, the Details row that sets their prices, the
       * manifest head count's split and the roll-call badge, on today's reef
       * boat. `/api/test/seed-trouble-states?mixedBoat=1` seats Mara and Owen
       * Quint there through `seatDiver` unless the demo seed already has, so
       * the capture reads the same on every layer of the stack.
       */
      test(`a departure carrying a snorkeler and a rider (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const seeded = await request.post("/api/test/seed-trouble-states?mixedBoat=1");
        expect(seeded.ok()).toBe(true);
        const { mixedBoat } = (await seeded.json()) as {
          mixedBoat?: { tripId: string; snorkeler: string; rider: string };
        };
        if (!mixedBoat) throw new Error("seed-trouble-states found no departure to mix");

        await page.goto(`/shop/blue-mantis/trips/${mixedBoat.tripId}`);
        await expect(
          page
            .locator('#roster li[id^="booking-"]')
            .filter({ hasText: mixedBoat.rider })
            .first()
            .getByText("Rider", { exact: true }),
        ).toBeVisible();
        await capture(page, "trip-roster-participant-types", scheme);

        await page.goto(`/shop/blue-mantis/trips/${mixedBoat.tripId}?view=details`);
        await expect(page.locator("details#participant-terms")).toBeVisible();
        await capture(page, "trip-details-participant-terms", scheme);

        await page.goto(`/shop/blue-mantis/trips/${mixedBoat.tripId}/manifest`);
        await page.getByRole("heading", { name: "Roll call" }).waitFor();
        await expect(page.getByText(/1 snorkeler · 1 rider/).first()).toBeVisible();
        await capture(page, "manifest-participant-types", scheme);
      });

      // The add-a-departure form as a shop meets it all week: the quick path,
      // which the board only ever shows as a button — every field a departure
      // is born with, price included, with the rare half collapsed behind
      // "More options".
      test(`the add-a-departure panel renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await page.getByRole("link", { name: "Add a departure", exact: true }).click();
        await addPanelSettled(page);
        await boardListSettled(page);
        await capture(page, "schedule-builder-add", scheme);
      });

      // The same quick panel once a stationed site is chosen: the one line the
      // panel adds when it knows where the boat is going (ADR
      // 20260907-noaa-tide-predictions), read off the fixture table the fleet
      // serves in place of NOAA. Its own capture rather than a change to the
      // one above, which is the baseline for the panel with nothing chosen.
      test(`the add-a-departure panel with a tide window renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await page.getByRole("link", { name: "Add a departure", exact: true }).click();
        await addPanelSettled(page);
        // By control name, not by label: the quick row and dive one both carry
        // a "Dive site" select, and the expanded one stays mounted-but-hidden
        // so nothing typed is lost on a collapse (e2e/dive-sites.spec.ts says
        // the same thing at its own two call sites).
        await page.locator('select[name="diveSiteId"]').selectOption({ label: "Molasses Reef" });
        await page
          .getByText(/(Next|Last) (high|low) water at .*; this departure reaches the site/)
          .waitFor();
        await boardListSettled(page);
        await capture(page, "schedule-builder-add-tide", scheme);
      });

      // The same panel at full depth — everything `/trips/new` used to be, now
      // disclosed inline (ADR 20260806-one-trip-create-form). This is the tall
      // one, and the only baseline that can catch the expanded form's own
      // rhythm: the dive-plan block, the two bordered fieldsets, and the single
      // submit that still ends it.
      test(`the expanded add-a-departure panel renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/schedule/board?add=full");
        await page.getByRole("heading", { name: "Schedule", level: 1 }).waitFor();
        await page.getByRole("button", { name: "Fewer options" }).waitFor();
        await addPanelSettled(page);
        await boardListSettled(page);
        await capture(page, "schedule-builder-add-full", scheme);
      });

      // The repeating-trip panel on a trip's own page. Built through the add
      // panel rather than seeded, because putting a standing charter into the
      // demo seed would move a dozen unrelated baselines (the board, the public
      // schedule, Today, the monthly report) for one section's sake. Per-test
      // reset makes the write safe, and the frozen clock makes the dates it
      // generates stable.
      test(`the repeating-trip panel renders true to the design (${scheme})`, async ({ page }) => {
        const title = "Standing Saturday charter";
        await page.goto("/shop/blue-mantis/schedule/board?add=full");
        await page.getByLabel("What is it").fill(title);
        await page.getByLabel("Date").fill(daysFromNow(4));
        await page.getByLabel("Departs").fill("08:00");
        await page.getByLabel("Returns").fill("11:00");
        await page.getByLabel("How often").selectOption("1");
        await page.getByRole("button", { name: "Put it on the board" }).click();
        // **The write's own signal, not the page's heading.** `?add=full` is
        // the board with the panel open, so the "Schedule" heading is already on
        // screen and waiting for it waits for nothing — and the crawl below
        // reads the week with `count()`, which does not auto-wait, so it
        // walked past a departure still being written and hunted it to the
        // end of the horizon (`.claude/rules/e2e.md`'s `action-race`).
        await expect(page.getByRole("status")).toContainText(title);
        await openTripFromBoard(page, title);
        await openTripAbout(page);
        // The About panel's "Repeats" row — its label and cadence sentence are
        // the summary, and the headed "Repeating trip" card is gone.
        await page.locator("details#series").waitFor();
        await capture(page, "trip-repeating-panel", scheme);

        // And the cadence editor open — the weekday chips carrying the run's
        // real answer, which is the state the collapsed panel above can never
        // show. Same page, one click, so it costs a click rather than a build.
        await page.getByText("Change the days it runs").click();
        await page.getByRole("group", { name: "Repeats on" }).waitFor();
        await capture(page, "trip-repeating-cadence", scheme);

        // And what a diver reads on the same departure: the header's run line,
        // "Runs every … · next …" (fourth UX review, item 35).
        await page.goto(publicTripUrl(page.url().split(/[?#]/)[0] ?? page.url()));
        await page.getByText(/^Runs every /).waitFor();
        await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
        await capture(page, "public-trip-run-line", scheme);
      });

      // The blow-out confirm — the one deliberate step between the captain's
      // word and cancelling live bookings (ADR 20260804-blowout-cascade).
      // Read-only: nothing is cancelled by rendering it.
      test(`the blow-out confirm page renders true to the design (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/schedule/blowout/${tripId}`);
        await page.getByRole("heading", { level: 1, name: "Call a blow-out?" }).waitFor();
        await capture(page, "blowout-confirm", scheme);
      });

      // A past day, read-only (issue #2662): yesterday's boats as the evening
      // closed them, under Schedule. Read-only by construction.
      test(`a past day renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto(`/shop/blue-mantis/schedule/day/${daysFromNow(-1)}`);
        await page.getByRole("heading", { level: 1 }).waitFor();
        await capture(page, "past-day", scheme);
      });

      // The day's weather call (ADR 20261009-day-weather-call), reached from
      // the single-trip confirm: every departure of the reef charter's day,
      // none selected, with who is booked on and crewing each; then its review,
      // every departure selected. Read-only until the review's button.
      test(`the day's weather call renders true to the design (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/schedule/blowout/${tripId}`);
        await page.getByRole("link", { name: /Call several departures at once/ }).click();
        await page
          .getByRole("heading", { level: 1, name: "Call a blow-out for the day?" })
          .waitFor();
        await page.getByRole("button", { name: "Review the call" }).waitFor();
        await capture(page, "blowout-day", scheme);
        await page.getByRole("link", { name: "All departures" }).click();
        await page.waitForURL(/pick=all/);
        await page.getByRole("button", { name: "Review the call" }).click();
        await page.getByRole("heading", { level: 1, name: "Cancel these departures?" }).waitFor();
        await capture(page, "blowout-day-review", scheme);
      });

      // The cascade record — the surface a blow-out morning is worked from.
      // Calling the blow-out inside the test is safe (per-test reset) and
      // deterministic: the frozen clock pins calledAt, and with no email
      // provider in the fleet every row lands in the same "Not sent" state —
      // the honest fallback surface an unconfigured shop would really see.
      test(`the blow-out cascade record renders true to the design (${scheme})`, async ({
        page,
      }) => {
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/schedule/blowout/${tripId}`);
        await page.getByRole("button", { name: "Call the blow-out" }).click();
        await page.getByRole("heading", { level: 1, name: "Blow-out cascade" }).waitFor();
        await page.getByRole("columnheader", { name: "Diver" }).waitFor();
        await capture(page, "blowout-cascade", scheme);
      });

      // The roster — the front desk's densest everyday surface, and now one
      // ledger at every width: letter groups, a name per row, and a badge only
      // where something is exceptional (ADR 20260827-people-not-lists).
      // Wait for the roster itself, not the skeleton: same race as the public
      // schedule, and the one that put a half-drawn loading state into the
      // divers-light baseline.
      test(`the diver roster renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/divers");
        await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
        await page.getByRole("searchbox", { name: "Search divers" }).waitFor();
        // The search row is a box *and* a button now, both from first paint
        // (issue #782). Waiting for only half of it is how a baseline ends up
        // holding a row that is still assembling.
        await page.getByRole("link", { name: "Add diver" }).waitFor();
        // ...and the ledger under it: the first letter group is what the
        // skeleton's grey bars stand in for, so this is the wait that keeps the
        // capture off the loading state.
        await page.locator("main ul li").first().waitFor();
        await capture(page, "divers", scheme);
      });

      // The roster in the order a "who hasn't been back" call needs (fourth
      // UX review, item 27): one group, most recent dive first, with the
      // order line saying so and offering the alphabet back.
      test(`the diver roster sorted by last dive (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/divers?sort=last_dived");
        await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
        await page.getByText("Most recent dive first").first().waitFor();
        await page.locator("main ul li").first().waitFor();
        await capture(page, "divers-last-dived", scheme);
      });

      /**
       * **The same roster, scrolled — the bar wearing the page's name.**
       *
       * This is the surface the fold was written for: a staffer halfway down
       * Divers used to see "Blue Mantis Divers" and 26 names, with nothing on
       * screen saying which page they were on (ADR
       * 20260907-nothing-from-nowhere, decision 5; issue #1422). The capture is
       * the only thing that can catch the label arriving at the wrong size, in
       * the wrong place, or on top of the shop's mark rather than beside it.
       *
       * Light only: the fold is a phone behaviour, and dark is photographed at
       * the desktop width alone (`DARK_VIEWPORTS`).
       */
      if (scheme === "light") {
        test("the bar folds the page's title in on a phone (light)", async ({ page }) => {
          await page.goto("/shop/blue-mantis/divers");
          await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
          await page.locator("main ul li").first().waitFor();
          await captureFolded(page, "chrome-folded-title", "light");
        });
      }

      /**
       * The form the front desk fills in most often, and the one the command
       * palette's create flow lands on. Four specs reach it and none of them
       * had ever looked at it: `check:route-coverage` counted an e2e spec as
       * coverage and passed silently (issue #727). Forms are where visual
       * regressions hide — alignment, the `Field`/`FieldGrid` wrappers, the
       * shape of an optional-vs-required row.
       */
      test(`the add-diver form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/divers/new");
        await page.getByRole("heading", { level: 1, name: "Add a diver" }).waitFor();
        await capture(page, "divers-new", scheme);
      });

      test(`a restored add-diver draft renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/divers/new");
        const name = "Ada Lindqvist";
        const saved = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            Boolean(response.request().headers()["next-action"]) &&
            Boolean(response.request().postData()?.includes(name)),
        );
        await page.getByLabel(staffCopy("divers.page.fullNameLabel")).fill(name);
        await page
          .getByRole("navigation", { name: "Main", exact: true })
          .getByRole("link", { name: "Divers", exact: true })
          .click();
        await expect(page).toHaveURL(/\/divers$/);
        expect((await saved).ok()).toBe(true);
        await page.goto("/shop/blue-mantis/divers/new");
        await expect(page.getByLabel(staffCopy("divers.page.fullNameLabel"))).toHaveValue(name);
        const startOver = page.getByRole("button", {
          name: staffCopy("shared.formDraft.startOver"),
        });
        await expect(startOver).toBeVisible();
        try {
          await capture(page, "divers-new-restored-draft", scheme);
        } finally {
          await startOver.click();
          await expect(startOver).toHaveCount(0);
        }
      });

      // The roster's one view that leaves the active list behind: where a
      // deleted diver can be found and restored, once the undo toast is long
      // gone. The demo shop deletes nobody, so this photographs the view's own
      // chrome — the chip row with "Deleted" on it, the line saying what the
      // view holds, and the way back out.
      test(`the deleted-divers view renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/divers?filter=removed");
        await page.getByRole("heading", { level: 1, name: "Divers" }).waitFor();
        await page.getByRole("link", { name: "Deleted", exact: true }).waitFor();
        await capture(page, "divers-removed", scheme);
      });

      /**
       * **One diver's whole record**, in the composition ADR
       * 20260827-people-not-lists gave it, the file now ahead of the story:
       * masthead, status ledger, the file as inset groups (each gap said by
       * its own row), then the story. Priya is the diver `seed-diver-trail.ts`
       * gives a trail past one page to, so the folded Activity group is real
       * here.
       */
      test(`a diver's record renders true to the design (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Priya", "Priya Sharma");
        // The story is the last section on the page and the widest — waiting
        // on it rather than on the h1 keeps the shot off a half-assembled
        // record.
        await page.getByRole("region", { name: "The story" }).waitFor();
        await capture(page, "diver-profile", scheme);
      });

      /**
       * **The bench on a diver's own record** (ADR 20261008-gear-work-orders):
       * the pieces of theirs the shop has on file, their tickets, and the door
       * to a new one. Tom is the diver `seed-work-orders.ts` leaves with a
       * ticket waiting on a part, so the group stands open as it does when
       * there is work outstanding.
       */
      test(`a diver's own gear renders true to the design (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Tom Okafor", "Tom Okafor");
        await page.getByRole("region", { name: "Their own gear" }).waitFor();
        await openDiverFileGroup(page, "Their own gear");
        await capture(page, "diver-record-bench", scheme);
      });

      /**
       * **The record with nothing outstanding** — the state the design is
       * really about, and the one a seeded demo never shows: every seeded
       * diver has a card, a signature or a balance waiting on somebody. The
       * status section renders *nothing at all* here, which is the pinned rule
       * (`src/lib/diver-status.test.ts`), and this is the only baseline that can catch
       * a heading or an "all clear" line creeping back in above the story.
       *
       * Built rather than seeded: a fresh diver has no cards, no bookings and
       * no orders, so the only thing left is the release and the emergency
       * contact, and the details form takes both. Safe to mutate — every
       * worker owns its database and resets before each test.
       */
      test(`a clear diver's record renders true to the design (${scheme})`, async ({ page }) => {
        // Deterministic, not `Date.now()`: the name renders in the h1, the
        // email line, the earned-moment banner and the delete button, so a live
        // stamp made this capture differ on every run. The reset before each
        // test purges every non-staff person, so the fixed identity is free.
        const name = "Clear Diver";
        await page.goto("/shop/blue-mantis/divers/new");
        await page.getByRole("heading", { level: 1, name: "Add a diver" }).waitFor();
        await page.getByLabel("Full name").fill(name);
        await page.getByLabel("Email").fill("clear-diver@example.com");
        await page.getByRole("button", { name: "Add diver", exact: true }).click();
        await page.getByRole("heading", { level: 1, name }).waitFor();
        // The roster's add form lands here with the details editor open.
        await page.getByLabel("Emergency contact name").fill("Kojo Mensah");
        await page.getByLabel("Emergency contact phone").fill("+13055550177");
        await page.getByRole("button", { name: "Save details" }).click();
        // **Wait for the save's own redirect before reloading over it.** The
        // reload was already here to settle the page; on its own it *raced*
        // the action instead, aborting the request mid-write. When the reload
        // won, the contact was never saved, the record kept its one open item,
        // and the earned moment 40 lines below correctly never rendered — the
        // test then spent its whole 210s budget waiting for a banner that was
        // right not to appear (CI run 34082101061).
        await page.waitForURL(/notice=person-saved/);
        // Land the save before touching the Waiver group. The save redirects and
        // the record re-renders around the notice it carries, which is what left
        // the paper-waiver button "not stable" and then "detached from the DOM"
        // mid-click. Reloading is the deterministic settle — a record at rest,
        // with its disclosures closed — rather than a wait on a moving page.
        await page.reload();
        await page.getByRole("heading", { level: 1, name }).waitFor();
        await openDiverFileGroup(page, "Waiver");
        await openPaperWaiverForm(page);
        await page
          .getByLabel("I have this diver’s signed release on file", { exact: false })
          .check();
        await page.getByRole("button", { name: "Record paper signature" }).click();
        // The earned moment is what says the ledger emptied — and it is the
        // page's one coral element (20260827-clearwater-surface-language,
        // decision 11).
        await page.getByText("That was the last thing").waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-record-clear", scheme);
      });

      /**
       * **A cleared date of birth asks for an age** (issue #2167). Lena is
       * the seeded thirteen-year-old; emptying her date without "They're 18
       * or older" is refused on the date field, with the box beside it, so a
       * known minor never reads as an adult by a blanked field. Safe to
       * mutate: the refusal writes nothing.
       */
      test(`a refused date-of-birth clear renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Lena", "Lena Fischer");
        await openDiverFileGroup(page, "Contact details");
        await page.getByLabel("Date of birth").fill("");
        await page.getByRole("button", { name: "Save details" }).click();
        await page.waitForURL(/notice=date-of-birth-age-unstated/);
        await page.getByText("To clear the date of birth").waitFor();
        await capture(page, "diver-record-dob-clear-refused", scheme);
      });

      /**
       * **The form that ends a medical hold** (issue #1252).
       *
       * The one readiness blocker a shop cannot clear from the boat, and until
       * this landed there was no form to photograph at all — the Waiver group
       * rendered nothing for a hold. It asks for the physician's evaluation
       * date and either their name or the form itself, so what is on screen is
       * three fields a staffer fills while somebody stands at the desk holding
       * a letter. The demo's Morgan Vale carries the synthetic hold.
       */
      test(`the physician-clearance form renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/divers?q=Morgan");
        await page.getByRole("link", { name: "Morgan Vale" }).click();
        await page.getByRole("heading", { level: 1, name: "Morgan Vale" }).waitFor();
        await page.getByRole("button", { name: "Record the physician’s answer" }).click();
        // The submit is what the disclosure reveals, so waiting on it is
        // waiting on the panel being open rather than on a duration.
        await page.getByRole("button", { name: "Record the answer" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-medical-clearance-form", scheme);
      });

      /**
       * **The record of an answer that was no** (issue #1283).
       *
       * The other half of the form above, and the state that had no picture
       * because it had no representation: a diver whose physician refused to
       * clear them used to render identically to one nobody had heard from, so
       * the shop kept chasing and the crew never learned. The demo's Rowan Pike
       * carries the synthetic refusal, and what this photographs is the row
       * saying so, dated, with no send-another-link door beside it.
       */
      test(`a refused physician evaluation renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/divers?q=Rowan");
        await page.getByRole("link", { name: "Rowan Pike" }).click();
        await page.getByRole("heading", { level: 1, name: "Rowan Pike" }).waitFor();
        // The waiver group's own summary carries the standing, so waiting for
        // the words is waiting for the group to have resolved rather than for
        // a duration.
        await page.getByText("Not cleared").first().waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-medical-not-cleared", scheme);
      });

      /**
       * **The signed release itself** (Aaron, 2026-10-06: "you actually can't
       * even view the signed record!") — what the roster's "View signed
       * record" opens. Rowan Pike's, because it is the one with the most to
       * say: the physician's refusal, dated and named, above the release text.
       */
      test(`a signed waiver renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, "Afternoon Two-Tank — French Reef");
        const row = page
          .locator("li")
          .filter({ has: page.getByText("Rowan Pike", { exact: true }) })
          .filter({ visible: true });
        await row.getByRole("link", { name: "View signed record" }).click();
        await page.getByRole("heading", { level: 1, name: "Signed waiver" }).waitFor();
        await page.getByRole("heading", { name: "What they signed" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-signed-waiver", scheme);
      });

      /**
       * The explicit duplicate-resolution surface: create a second record for
       * a seeded diver, then photograph the possible-duplicates panel: each
       * likely duplicate, why it was offered, and its door to the merge
       * preview, without making the demo seed itself a duplicate. The per-test reset removes the temporary record afterward.
       */
      test(`a possible duplicate record renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/divers/new");
        await page.getByRole("heading", { level: 1, name: "Add a diver" }).waitFor();
        await page.getByLabel("Full name").fill("Priya Sharma");
        await page.getByLabel("Email").fill("priya.duplicate@example.com");
        // Seeded Priya's own number: a name alone is never offered as a duplicate.
        await page.getByLabel("Phone").fill("+1 305 555 0110");
        await page.getByRole("button", { name: "Add diver", exact: true }).click();
        // The prompt asks the counter's question by name now (issue #1556), so
        // this waits on the half that is about this diver rather than on a
        // sentence that also carries what picking one costs.
        await page.getByRole("heading", { name: /^Is this the same Priya Sharma\?/ }).waitFor();
        await page.getByRole("button", { name: "Create new diver anyway" }).click();
        await page.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor();
        await page.getByRole("heading", { name: "Possible duplicate records" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-profile-merge", scheme);
      });

      /**
       * **The merge preview** (issue #1240): the two records side by side, the
       * fields they disagree on as choices with the kept record's preselected,
       * what moves, and the one danger action. Reached the way a staffer
       * reaches it, from the duplicate made at the counter above; the per-test
       * reset removes the temporary record afterward.
       *
       * Both records print their "Added" date, a `defaultNow()` stamp from the
       * database's wall clock, so `/api/test/pin-added-date` moves both onto
       * the frozen clock before the preview renders (issue #2297).
       */
      test(`the merge preview renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await page.goto("/shop/blue-mantis/divers/new");
        await page.getByRole("heading", { level: 1, name: "Add a diver" }).waitFor();
        await page.getByLabel("Full name").fill("Priya Sharma");
        await page.getByLabel("Email").fill("priya.duplicate@example.com");
        // Seeded Priya's own number: a name alone is never offered as a duplicate.
        await page.getByLabel("Phone").fill("+1 305 555 0110");
        await page.getByRole("button", { name: "Add diver", exact: true }).click();
        await page.getByRole("heading", { name: /^Is this the same Priya Sharma\?/ }).waitFor();
        await page.getByRole("button", { name: "Create new diver anyway" }).click();
        await page.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor();
        const pinned = await request.post("/api/test/pin-added-date", {
          data: { fullName: "Priya Sharma" },
        });
        expect(await pinned.json()).toEqual({ pinned: 2 });
        await page.getByRole("link", { name: "Compare with Priya Sharma" }).first().click();
        await page.getByRole("heading", { level: 1, name: "Merge duplicate records" }).waitFor();
        // Swap so the seeded Priya, with her bookings and releases, is the
        // record merged away: "What moves" then shows real movement rather
        // than a row of zeros from the record made a moment ago. The two
        // share a name, so the link names which Priya it keeps.
        await page.getByRole("link", { name: /^Keep Priya Sharma \(Added .*\) instead$/ }).click();
        await page.getByRole("heading", { level: 1, name: "Merge duplicate records" }).waitFor();
        await page.getByRole("heading", { name: "What moves to the kept record" }).waitFor();
        await page.getByRole("rowheader", { name: "Bookings" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-merge-preview", scheme);
      });

      /**
       * **A card waiting for a check, with its agency's lookup beside it**
       * (market audit item 30). Mateo Duarte's seeded SSI card is pending, so
       * the open Certification records group shows "Check with SSI": the one
       * place the agency link renders, and behind a closed group in every
       * other capture.
       */
      test(`a pending card's agency check link renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Mateo", "Mateo Duarte");
        const group = await openDiverFileGroup(page, "Certification records");
        await group.getByRole("link", { name: "Check with SSI" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-profile-agency-check", scheme);
      });

      /**
       * **The other cards an agency's page lists, offered after a match**
       * (layer 3 of ADR 20261008-cert-check-extension). The extension is
       * stood in for at the page's one seam, as next door: SSI's page shows
       * Mateo Duarte's Open Water card, which the check certifies, and his
       * nitrox and Deep cards, which the panel under it offers with a tick
       * each. Safe to mutate: each test resets the shop's cards.
       */
      test(`an agency check's offer of the page's other cards renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.addInitScript(() => {
          const announce = () => {
            document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
            window.dispatchEvent(new Event("diveday-cert-check-ready"));
          };
          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", announce);
          } else {
            announce();
          }
          window.addEventListener("message", (event) => {
            const data = event.data;
            if (data?.source !== "diveday-page" || data.type !== "agency-check") return;
            window.postMessage(
              {
                source: "diveday-cert-check",
                type: "agency-check-result",
                requestId: data.requestId,
                ok: true,
                pageText: `Online Diver Check\n${data.query.firstName} ${data.query.lastName}\nCard ${data.query.cardNumber}\nOpen Water Diver\nEnriched Air Nitrox · Deep Diving`,
              },
              window.location.origin,
            );
          });
        });
        // The actionable Undo stays available after the acknowledgement
        // interval; the capture checks its Dismiss control at phone and desktop
        // widths while the offer's Add button remains visible behind it.
        await page.clock.install();
        await openDiverProfile(page, "Mateo", "Mateo Duarte");
        const group = await openDiverFileGroup(page, "Certification records");
        await group.getByRole("button", { name: "Check with SSI" }).click();
        await group
          .getByRole("group", {
            name: "SSI also shows these certifications. Add them? Each waits for Mark certified.",
          })
          .waitFor();
        const toast = page.getByRole("status").filter({ hasText: "SSI shows this certification." });
        await toast.waitFor();
        await page.mouse.move(0, 0);
        await page.clock.fastForward(13_000);
        await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
        await expect(toast.getByRole("button", { name: "Dismiss" })).toBeVisible();
        await capture(page, "diver-profile-agency-listed", scheme);
      });

      /**
       * **A Divers-tab row after an agency check that came up short** (H-105).
       * Nothing here renders without the DiveDay browser extension, so this
       * stands in for it at the page's one seam (`e2e/agency-check-roster.spec.ts`
       * does the same): SSI's page finds Tyler Brooks but shows him only as a
       * Scuba Diver. The row keeps the agency's words under its reason, the
       * link to SSI's own page, and its "Check with SSI" for another try —
       * the state a staffer is left to read, and the densest one the row has.
       */
      test(`a Divers-tab row's agency check, short of a match, renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.addInitScript(() => {
          const announce = () => {
            document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
            window.dispatchEvent(new Event("diveday-cert-check-ready"));
          };
          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", announce);
          } else {
            announce();
          }
          window.addEventListener("message", (event) => {
            const data = event.data;
            if (data?.source !== "diveday-page" || data.type !== "agency-check") return;
            window.postMessage(
              {
                source: "diveday-cert-check",
                type: "agency-check-result",
                requestId: data.requestId,
                ok: true,
                pageText: `Online Diver Check\n${data.query.firstName} ${data.query.lastName}\nCard ${data.query.cardNumber}\nScuba Diver`,
              },
              window.location.origin,
            );
          });
        });
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, "Two-Tank Reef — French Reef");
        await openTripTab(page, "Trip");
        const roster = page.locator("#roster");
        await roster.getByRole("button", { name: "Check with SSI" }).click();
        await roster.getByText("SSI found this diver, but not at this level.").waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "trip-guests-agency-check", scheme);
      });

      /**
       * **The record of a diver who has been deleted**, which is the only place
       * "Erase personal data" is offered at all (ADR 20260802-diver-data-erasure,
       * 2026-08-21 amendment). Two things this is the sole baseline for: the
       * warning-toned Restore card at the top, and the destructive tail at the
       * bottom — the one control in the product with no undo, in the one state
       * it renders in.
       *
       * Deletes a diver rather than seeding one, because the demo shop should
       * not permanently carry a deleted person: the roster's own "Deleted" view
       * is photographed next door on its *empty* chrome, and a resident deleted
       * diver would quietly change that capture too. Safe to mutate — every
       * Playwright worker owns its database and resets the schedule before each
       * test, which puts Felix back.
       */
      test(`a deleted diver's record renders true to the design (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Felix", "Felix Grant");
        const record = page.url().split("?")[0] ?? "";
        await page.getByText("Delete Felix Grant").click();
        await page.getByRole("button", { name: "Delete diver" }).click();
        await page.getByText("Diver deleted.").waitFor();
        await page.goto(record);
        // The two ends of the page this capture exists for, waited on by name
        // so the shot can never land on a half-rendered record.
        await page.getByText("This diver is deleted").waitFor();
        await page.getByRole("heading", { name: "Erase personal data" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-profile-deleted", scheme);
      });

      /**
       * **The erase control refusing a typed name** (issue #1985): the one
       * state where someone reads this control hardest, and the one no baseline
       * had looked at. The refusal renders under the box, and the button has to
       * stand level with the box rather than drop to the error's line. Reached
       * directly — a wrong name is refused by the real action, so nothing is
       * seeded and nothing is erased.
       */
      test(`the erase control's refused name renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Felix", "Felix Grant");
        const record = page.url().split("?")[0] ?? "";
        await page.getByText("Delete Felix Grant").click();
        await page.getByRole("button", { name: "Delete diver" }).click();
        await page.getByText("Diver deleted.").waitFor();
        await page.goto(record);
        await page.getByText("Erase Felix Grant’s personal data").click();
        await page.getByLabel("Type Felix Grant to confirm").fill("Felix Gr");
        await page.getByRole("button", { name: "Erase personal data" }).click();
        // The refusal on the box itself, so the shot never lands mid-redirect.
        await page.getByRole("alert").filter({ hasText: "nothing was erased" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "diver-profile-erase-refused", scheme);
      });

      /**
       * The waiver card with its paper attestation open — the one state on this
       * record that no baseline had ever looked at, because it used to live
       * behind a `<details>` that only opens on a click.
       *
       * It is worth its own capture rather than a note on `diver-profile`:
       * these are the four ways a shop gets a release signed, they have to read
       * as one control group at both widths, and the panel that drops out of
       * that row carries the medical attestation a staffer is putting their
       * name to. A row that wraps badly or a panel that reads as a different
       * kind of object is exactly the drift a screenshot catches and a
       * functional assertion cannot.
       */
      test(`the waiver card's paper attestation renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Priya", "Priya Sharma");
        await openDiverFileGroup(page, "Waiver");
        await openPaperWaiverForm(page);
        // The panel itself, not the trigger that opened it — so the capture can
        // never photograph the row mid-swap.
        await page.getByRole("button", { name: "Record paper signature" }).waitFor();
        await capture(page, "diver-profile-paper-waiver", scheme);
      });

      /**
       * The same delivery row on a day when one of the ways failed: each button
       * wearing what we last knew about *its own* channel — a refused email
       * beside a text that landed.
       *
       * Test-only for the reason the whole trouble-states route exists: a
       * delivery outcome needs a provider, the demo shop has none, and seeding
       * a permanent failure would make the calm capture next door a lie. The
       * ring is colour and the mark beside it is a shape, so this is also the
       * only baseline that can catch the two drifting apart.
       */
      test(`a waiver's per-channel delivery states render true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await openDiverProfile(page, "Priya", "Priya Sharma");
        await openDiverFileGroup(page, "Waiver");
        // The ringed button itself, so the capture can never land before the
        // server data that rings it has arrived.
        await page.getByRole("button", { name: /Email waiver/ }).waitFor();
        await page.getByText("Didn’t go out").waitFor({ state: "attached" });
        await capture(page, "diver-profile-waiver-delivery", scheme);
      });

      /**
       * The diver record on the day somebody says they hold no card: a
       * warning-toned correction panel, not a certification row. The state is
       * test-only because the demo shop should not permanently claim that a
       * healthy diver is uncertified; the seed route also makes the staff
       * eraser available to the functional flow.
       */
      test(`a diver's no-card declaration renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await openDiverProfile(page, "Nadia", "Nadia Petrov");
        // The door's fact: a booked diver's card gap opens the group, and the
        // statement inside repeats the words.
        await page
          .getByTestId("diver-file-group-certifications")
          .locator("summary")
          .getByText("Not certified yet — unverified")
          .waitFor();
        await capture(page, "diver-profile-not-certified", scheme);
      });

      // The migrated diver, and every surface that has to say so. Her level
      // card reads verified with an "imported" provenance chip and a one-tap
      // "Confirm card" nudge (ADR 20260724-import-verified-cards), and her
      // shop history carries the visits that came across from the old system
      // (ADR 20260725-import-prior-visits) — imported-marked, unlinked, with a
      // cancelled booking struck through so it can't be read as a dive. This
      // page is where a spreadsheet cell either looks like evidence or looks
      // like what it is, so it is worth a baseline in both schemes.
      test(`an imported diver's record renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Hana", "Hana Kobayashi");
        await capture(page, "diver-profile-imported", scheme);
      });

      /**
       * A diver who has actually paid for something. None of the three
       * profiles above carries a single order row — verified against the
       * seed, not assumed — so the money facts on the story's rows had only
       * ever been photographed absent. Talia Rosen is the seed's heaviest
       * payer, so this is the widest version of the ledger.
       *
       * Deliberately a fourth capture rather than a repoint of
       * `diver-profile`: Priya's profile is the baseline for the *other*
       * states on that page, and moving it would trade one blind spot for
       * another.
       *
       * What this still does NOT cover, and why: a story row for an order
       * with `bookingId === null` — a standalone shop payment, which renders
       * as its own row pointing at the order. Every seeded order is generated
       * from a booking, so that branch is unreachable from the demo data. It
       * stays covered by `DiverStory.test.tsx` alone.
       */
      test(`a paying diver's record renders true to the design (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Talia", "Talia Rosen");
        // The money facts ride the story's rows now — Payments, Upcoming and
        // Shop history folded into one ledger.
        await page.getByRole("region", { name: "The story" }).waitFor();
        await capture(page, "diver-profile-payments", scheme);
      });

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
        await page.getByRole("heading", { level: 1, name: "Blow-out cascade" }).waitFor();
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await page.getByRole("button", { name: "Reinstate trip" }).waitFor();
        await page.getByRole("link", { name: "View the blow-out cascade" }).waitFor();
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
       * `trip-guests` above can never show this: the deal panel lives behind a
       * collapsed disclosure, and it renders nothing at all until somebody is
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
        await page.getByRole("heading", { name: "You’re on the list." }).waitFor();

        // Already signed in: `signedInAsOwner()` is describe-scoped over this
        // block, which is also why the public form above renders with the staff
        // preview bar. Neither affects the surface being photographed.
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        // The `#last-minute-deal` anchor is what auto-opens the disclosure.
        await page.goto(`/shop/blue-mantis/trips/${tripId}?view=details#last-minute-deal`);
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
          await page.getByRole("heading", { name: "You’re on the list." }).waitFor();
        };
        // The optional question, skipped — the common answer on a marketing
        // opt-in, and the one a shop can weigh least.
        await join("Wes Toledo", "wes.visual@example.com");
        await join("Tess Alvarez", "tess.visual@example.com", "open_water");

        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await openTripAbout(page);
        await page.getByText("Edit requirements", { exact: true }).click();
        await page.getByLabel("Minimum certification").selectOption("rescue");
        await page.getByRole("button", { name: "Save requirements" }).click();
        // Raising the bar mid-season strands the divers already booked under
        // the old one, so the save answers with its warning variant ("8 booked
        // divers no longer meet them") rather than the plain confirmation.
        // Matching the stem keeps this test about the deal panel.
        await expect(page.getByRole("status")).toContainText("Requirements updated.");

        // The save lands on Details; the deal panel and the wait list are on Divers.
        await openTripTab(page, "Trip");
        await page.goto(`/shop/blue-mantis/trips/${tripId}?view=details#last-minute-deal`);
        await page.getByRole("heading", { name: "Nobody to send this to yet" }).waitFor();
        await waitForHashLanding(page);
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
       * The night charter still carries both seeded joiners, while Selah also
       * starts today so the headline reef departure has one marked row when a
       * demo visitor opens it. Rowan remains tomorrow-only, keeping that first
       * list realistic rather than alarming.
       */
      test(`the deal panel carries the demo's own declarations (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", "Night Dive — City of Washington");
        await page.goto(`/shop/blue-mantis/trips/${tripId}?view=details#last-minute-deal`);
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
       * The Invite button beside the name is in the frame deliberately. Nothing
       * about this mark filters the list, reorders it, or disables the invite —
       * a wait list is leads in the order they asked (ADR
       * 20260813-wait-list-is-a-lead-list) and informing the staffer is the whole
       * design.
       */
      test(`the wait list weighs a lead against the bar (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await seededTripId(page, "blue-mantis", "Two-Tank Reef — Pickles Reef");
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await openTripAbout(page);
        await page.getByText("Edit requirements", { exact: true }).click();
        await page.getByLabel("Minimum certification").selectOption("advanced_open_water");
        await page.getByRole("button", { name: "Save requirements" }).click();
        // Raising the bar on a seated charter answers with the warning variant
        // ("… booked divers no longer meet them"); matching the stem keeps this
        // test about the wait list.
        await expect(page.getByRole("status")).toContainText("Requirements updated.");

        // The save lands on Details; the deal panel and the wait list are on Divers.
        await openTripTab(page, "Trip");
        await page.goto(`/shop/blue-mantis/trips/${tripId}#waitlist`);
        // Scoped to the ledger: the deal panel further down the same page
        // renders the identical phrase for its own recipients, and this test is
        // about the list that was still silent until now. (`#waitlist` is the
        // group's band heading, not an ancestor of its rows — the rows are the
        // band's sibling list, so the section is the narrowest honest scope.)
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
        await radio.getByText("Note a problem").click();
        await radio.getByLabel("What’s wrong?").fill("VHF crackles on 16");
        await radio.getByRole("button", { name: "Save note" }).click();
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
        await odile.getByText("Not here", { exact: true }).click();
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
        await page.getByRole("region", { name: "Roll calls left open" }).waitFor();
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

      // The offline shell's list view — every trip currently saved on this
      // device, reachable at dive.day root as well as `/offline-manifest`
      // directly (see ADR 20260726-shopwide-offline-manifest-priming). Visiting
      // the manifest is what puts a trip in it, so this test walks there first.
      test(`the offline manifest list renders true to the design (${scheme})`, async ({ page }) => {
        // Board → trip → Manifest, then the offline shell.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await offlineCopySaved(page);
        await settleOfflineShellWorker(page);
        await page.goto("/offline-manifest");
        await page.getByRole("heading", { name: "Saved on this device" }).waitFor();
        await capture(page, "offline-manifest-list", scheme);
      });

      /**
       * The same list with one copy no longer current — the only state on it
       * that carries a pill at all.
       *
       * The baseline above photographs the calm case, where every row is
       * current and nothing is badged; before 2026-08-23 that case badged all
       * four rows green and this one was indistinguishable from it at a glance
       * (issue #816). That is the whole reason this frame exists separately:
       * the change is only worth anything if the exceptional row is louder than
       * the ordinary ones, and no capture could show that while they looked the
       * same. Both the row's pill and the group line at the top move here and
       * nowhere else.
       */
      test(`an offline copy needing a refresh renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest → the shell, plus the store rewrite.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await savedOfflineRecordFor(page);
        await rewriteSavedOfflineRecord(page, tripId, { savedAt: AGING_SAVED_AT });
        // The tenant lookup is still refused from `savedOfflineRecordFor`, so
        // no cross-shop purge re-reads the record underneath this reload and
        // the row paints from exactly what was just written.
        await page.reload();
        await page.getByText("Saved 2 hours ago").waitFor();
        await capture(page, "offline-manifest-list-needs-refresh", scheme);
      });

      /**
       * The saved copy actually *opened* — the roll call a crew member works
       * with no signal, which until now had no baseline of any kind. The four
       * other offline captures photograph the shell's states around it (the
       * list, nothing-saved, discarded, another shop's), and none of them
       * contains a diver row, so every control on the surface a boat falls back
       * to was uncovered: the roster, the per-diver note disclosure, the
       * board/not-boarded pair, the freshness pill. Found by a 2026-08-11 change
       * that restyled the note disclosure here and moved no pixels in any
       * baseline.
       */
      test(`the offline roll call renders true to the design (${scheme})`, async ({ page }) => {
        // Board → trip → Manifest, then the saved copy.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await settleOfflineShellWorker(page);
        await openOnThisPhone(page);
        await page.getByRole("link", { name: "Open offline roll call" }).click();
        await page.waitForURL(/offline-manifest/);
        // The roster is what proves the record was read back and decrypted —
        // the shell renders its chrome before the store resolves.
        await expect(page.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();
        await capture(page, "offline-manifest-roll-call", scheme);
      });

      /**
       * **The same saved copy after a dive, with nothing recorded yet** — the
       * ordinary opening of a surface-interval count at sea. "Mark not back
       * aboard" is neutral on every row until somebody records it, as on the
       * live page (decision 4 of ADR 20260827-the-departure-is-two-working-
       * surfaces, issue #2107). The frame above is the departure checkpoint,
       * whose controls were already neutral, so nothing photographed this one.
       */
      test(`the offline after-dive roll call renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await settleOfflineShellWorker(page);
        await openOnThisPhone(page);
        await page.getByRole("link", { name: "Open offline roll call" }).click();
        await page.waitForURL(/offline-manifest/);
        await expect(page.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();
        await page.getByRole("button", { name: "After dive 1" }).click();
        await expect(page.getByRole("heading", { name: "After dive 1 roll call" })).toBeVisible();
        await capture(page, "offline-manifest-after-dive", scheme);
      });

      /**
       * **The counter's own half of that copy, with a tap made** (ADR
       * 20260907-the-counter-survives-offline).
       *
       * The frame above photographs the section untouched, alongside every
       * other control on the shell. This one is the state a desk actually
       * works in: one seat settled — the primary fill and the drawn check the
       * live counter's own settled row wears — beside a diver readiness
       * refuses, who gets no control at all and shows what is in the way. Two
       * rows that must not look alike, and nothing else on this surface can
       * show that pair.
       */
      test(`the offline counter renders a settled arrival true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest, then the saved copy, then one tap.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await settleOfflineShellWorker(page);
        await openOnThisPhone(page);
        await page.getByRole("link", { name: "Open offline roll call" }).click();
        await page.waitForURL(/offline-manifest/);
        const counter = page.getByRole("region", { name: "At the counter" });
        const diego = counter.getByRole("button", { name: /Diego Alvarez/ });
        await diego.click();
        // Wait on what the tap itself renders, never on a timeout: the row
        // reports its own settled state through `aria-pressed`.
        await expect(diego).toHaveAttribute("aria-pressed", "true");
        await capture(page, "offline-counter-settled", scheme);
      });

      // The offline fallback a captain lands on after a failed reload with
      // no snapshot saved — the entire safety surface in that moment, so it
      // gets its own baseline rather than relying on the roll-call text
      // assertion in e2e/manifest.spec.ts to catch a styling regression.
      // Staff pages prime a device copy in the background, so clear IndexedDB
      // immediately before the visit to reproduce the truly-empty state (e.g.
      // storage eviction) rather than assuming a fresh context is enough.
      test(`the empty offline manifest renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // The shop-wide primer (OfflineManifestAutoSave) starts a fetch →
        // purge → save-all round on every staff page mount, and its parallel
        // saves can land *after* the deleteDatabase below finishes — the
        // store quietly refills and the empty heading never renders (caught
        // as a 164s timeout on CI shard 2, run 31075399016). Cut the race at
        // the harness boundary: with the upcoming-manifests feed blocked
        // from the first navigation, no round ever writes, and the delete
        // stays as defence against any other writer.
        await page.route("**/api/offline-manifests/upcoming", (route) => route.abort());
        await openReefTrip(page);
        const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/?]+)/)?.[1];
        await page.evaluate(
          () =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase("diveday-offline-manifests");
              request.onsuccess = () => resolve();
              request.onerror = () =>
                reject(request.error ?? new Error("failed to clear IndexedDB"));
            }),
        );
        await page.goto(`/offline-manifest?trip=${tripId}`);
        await page.getByRole("heading", { name: "Nothing saved on this phone yet" }).waitFor();
        await capture(page, "offline-manifest-empty", scheme);
      });

      /**
       * The discard notice: roll call a crew member recorded offline that never
       * reached DiveDay, on a saved copy the store finally deleted for passing
       * `OFFLINE_MANIFEST_PENDING_GRACE_MS` — 28 days past its own expiry — with
       * that evidence still queued on it (security review 2026-08-06, F3).
       *
       * It earns a baseline because of *where* it lands and *when*. The delete
       * almost always happens with no page open (the worker's push refresh, the
       * staff layout's auto-save), so this danger-toned panel is the first and
       * only place a human is told; and the surface it appears on is a shared
       * boat tablet at the dock, in the minute a captain is counting heads. It
       * is also the one thing on this shell that reconnecting cannot undo.
       *
       * Captured on the **list** branch, once. The notice is a single component
       * rendered identically by all three branches (list, the trip empty state,
       * and the roster) — the only difference is which sibling precedes it — so
       * a second and third frame would cost eight more PNGs to photograph the
       * same markup at a different vertical offset. The list is where a tablet
       * picked up at the dock opens.
       *
       * Left on Blue Mantis's own record rather than a foreign shop's: the
       * ceiling is shop-agnostic, and keeping it on the seeded shop means every
       * word in the notice is a seeded value rather than an invented one.
       */
      test(`the offline manifest's discard notice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest → the shell, twice, plus the store rewrite.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await savedOfflineRecordFor(page);
        // Two divers' worth, so the plural of both strings is what is banked —
        // one lost tap is the rarer shape, and it is the narrower one to lay out.
        await rewriteSavedOfflineRecord(page, tripId, {
          expiresAt: PAST_PENDING_GRACE,
          pendingRollCalls: 2,
        });

        // The tenant lookup stays refused for the rest of this test (see
        // `savedOfflineRecordFor`), and here that is what makes the panel
        // deterministic rather than merely still. A tenant the shell *can*
        // resolve starts a cross-shop purge, and that purge reads every saved
        // record through `loadOfflineManifest` — the same function the list
        // branch is already reading them through. Both would reach this record
        // before either deleted it, both would append a notice for it, and the
        // panel would photograph one row or two depending on which finished
        // first. One reader, one row.
        await page.reload();
        // The notice itself, not the list heading: the discard is written while
        // the store is being read and the panel arrives after the rows, so the
        // heading resolves against a page that has not yet been told anything
        // was lost. `role="alert"` is the panel's own element — waiting on the
        // "Got it" button would equally prove it mounted, but this is the
        // sentence a regression would move.
        await page
          .getByRole("alert")
          .filter({ hasText: "Roll call that never sent has been removed" })
          .waitFor();
        await capture(page, "offline-manifest-discarded", scheme);
      });

      /**
       * `?trip=<id>` for a record the cross-shop purge has just deleted out from
       * under the captain reading it — a different shop signed in on this
       * tablet, so this trip's saved copy is gone and roll call for it has to be
       * recorded on that shop's own live manifest (security review 2026-08-06,
       * F5).
       *
       * The point of the state is the *copy*: before this it repainted to the
       * ordinary "Nothing saved on this phone yet", which is the one sentence
       * the captain already knows is false — they were looking at the roster a
       * moment ago. `offline-manifest-empty` is the baseline for that ordinary
       * sentence and stays pointed at it; this is its own frame because the two
       * render the same layout with different words, and a regression that
       * collapsed one into the other would move nothing on that one.
       *
       * Reached the way it happens on a boat, in order: no signal, so the shell
       * paints the saved roster; then signal, so the purge runs and the record
       * goes. That order is the whole test — the state needs the roster to have
       * been on screen first (it is what tells the purge whose copy it was
       * removing), so a purge that wins the race to the store instead produces
       * the plain empty state and photographs the wrong page.
       */
      test(`an offline copy removed by another shop renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest → the shell, twice, plus the store rewrite.
        test.setTimeout(FLOW_TIMEOUT_MS);
        const tripId = await savedOfflineRecordFor(page);
        await rewriteSavedOfflineRecord(page, tripId, { shop: OTHER_SHOP });

        // No signal for the first paint — the tenant lookup is still refused
        // from `savedOfflineRecordFor`, so the purge declines to run and the
        // saved roster paints from storage exactly as it does on the dock.
        // Cutting the whole context offline would say the same thing, and would
        // also put this navigation through the service worker's cached shell:
        // a second thing to prime and a second thing to be flaky.
        await page.goto(`/offline-manifest?trip=${tripId}`);
        await page.getByRole("heading", { name: "Before departure roll call" }).waitFor();

        // Signal returns. The shell re-runs its purge on `online` — the same
        // event the fixture's own `setOffline(false)` dispatches — and this time
        // the tenant answers, so the foreign record is deleted and the branch
        // repaints saying why.
        await page.unroute(IDENTITY_ROUTE);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await page.getByRole("heading", { name: "That saved copy has been removed" }).waitFor();
        await capture(page, "offline-manifest-removed-other-shop", scheme);
      });

      // The settings hub, the directory every shop setting hangs off.
      test(`shop settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Trip packing checklist" }).waitFor();
        // One row open in the capture, so the baseline shows the disclosure's
        // open-form treatment as well as the at-rest directory.
        await openSettingsRow(page, "Trip packing checklist");
        await capture(page, "settings-payments", scheme);
      });

      /**
       * What the shop rents and what it charges for it: one table with a tick
       * and a price box per piece, the terms and the service interval, one
       * save (#2815).
       */
      test(`the rentals page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/rentals");
        await page.getByRole("heading", { level: 1, name: "Rentals" }).waitFor();
        await page.getByRole("button", { name: "Save rentals" }).waitFor();
        await capture(page, "settings-rentals", scheme);
      });

      /**
       * The address card, open — one search box and the address it found (ADR
       * 20260811-address-is-one-search-box). It earns its own capture because
       * the row is closed in `settings-payments`, so the shape that replaced
       * five text boxes and a Save button is otherwise never looked at.
       *
       * The fleet configures no `PLACES_AWS_*` credentials, so this captures
       * the unconfigured state — the search box absent, its one sentence in
       * place of it — which is what every local and self-hosted instance sees,
       * and what the seeded shop's stored address and Remove control sit under.
       */
      test(`the shop address card renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("heading", { name: "Shop address" }).waitFor();
        await openSettingsRow(page, "Shop address");
        await page.getByRole("button", { name: "Remove address" }).waitFor();
        await capture(page, "settings-address", scheme);
      });

      /**
       * The shop's fleet — a name, a capacity and a line of description per
       * hull, with the delete confirm that names how many departures one has
       * carried. Its own page rather than a hub row: a list plus an add form
       * stopped fitting inside a disclosure.
       */
      test(`the boats page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/boats");
        await page.getByRole("heading", { level: 1, name: "Boats" }).waitFor();
        const boat = page.locator('details[id^="boat-"]:not(#boat-new)').first();
        await boat.locator("summary").waitFor();
        await capture(page, "settings-boats", scheme);
        await boat.locator("summary").click();
        await boat.getByLabel(staffCopy("boats.nameLabel")).waitFor();
        await capture(page, "settings-boats-edit", scheme);
        await boat.locator("summary").click();
        await page.locator("#boat-new summary").click();
        await page.getByRole("button", { name: "Add a boat", exact: true }).waitFor();
        await capture(page, "settings-boats-add", scheme);
      });

      /**
       * The shop's trip tags (ADR 20260904-reef-all-the-way-down, decision 2)
       * — the list a diver then filters the public schedule by.
       */
      test(`the trip-tags page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/trip-tags");
        await page.getByRole("heading", { level: 1, name: "Trip tags" }).waitFor();
        await capture(page, "settings-trip-tags", scheme);
        const tag = page.locator('details[id^="tag-"]:not(#tag-new)').first();
        await tag.locator("summary").click();
        await tag.getByLabel(staffCopy("lenses.nameLabel")).waitFor();
        await capture(page, "settings-trip-tags-edit", scheme);
        await tag.locator("summary").click();
        await page.locator("#tag-new summary").click();
        await page.locator("#tag-new").getByLabel(staffCopy("lenses.nameLabel")).waitFor();
        await capture(page, "settings-trip-tags-add", scheme);
      });

      /**
       * The dock-day rhythm, open — six minute boxes and the live strip of
       * beats they produce (ADR 20260812-configurable-dock-day-rhythm). Its own
       * capture for the same reason the address card has one: the row is closed
       * in `settings-payments`, and this is the only place the form that
       * replaced a single arrival-call box is looked at. The preview strip
       * underneath is the part worth a baseline — it is the same arithmetic the
       * diver's booking page renders, so a change to the model that quietly
       * stops matching shows up as pixels here.
       */
      test(`the dock-day rhythm card renders true to the design (${scheme})`, async ({ page }) => {
        // A page of its own since #1854.
        await page.goto("/shop/blue-mantis/settings/dock-day");
        await page.getByRole("heading", { level: 1, name: "Dock-day rhythm" }).waitFor();
        await page.getByLabel("Surface interval between dives").waitFor();
        await capture(page, "settings-dock-day-rhythm", scheme);
      });

      /**
       * Saved emergency numbers and the response plan read at rest; the same
       * capture also opens the contact, plan and shore-alert editors so their
       * fixed-slot fields and consent controls remain visible in the baseline.
       */
      test(`the emergency reference card renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // A page of its own since #1854.
        await page.goto("/shop/blue-mantis/settings/emergency-reference");
        await page.getByRole("heading", { level: 1, name: "Emergency reference" }).waitFor();
        await page.getByRole("button", { name: "Save emergency reference" }).waitFor();
        await capture(page, "settings-emergency", scheme);
        const contact = page
          .locator('details[id^="emergency-contact-"]:not(#emergency-contact-new)')
          .first();
        await contact.locator("summary").click();
        await page.locator("#emergency-response summary").click();
        await page.locator("#emergency-alerts summary").click();
        await page.getByText(staffCopy("settings.main.emergency.shoreAlertDemo")).waitFor();
        await capture(page, "settings-emergency-edit", scheme);
        await contact.locator("summary").click();
        await page.locator("#emergency-response summary").click();
        await page.locator("#emergency-alerts summary").click();
        await page.locator("#emergency-contact-new summary").click();
        await page.locator('#emergency-contact-new input[name^="emergencyLabel-"]').waitFor();
        await capture(page, "settings-emergency-add", scheme);
      });

      /**
       * **Try the checks** (H-105): the disclosure on the Card checks row
       * (#2817), running the cert-check extension against its own sample
       * pages, after a run. The extension is
       * stood in for at the page's one seam, as the agency-check captures do:
       * it says hello as 1.5.0, passes every sample but NAUI's, and finds a
       * signed-in PADI tab. The report's time is the frozen clock's, and its
       * browser line is pinned here, so a Chromium update moves no pixel.
       */
      test(`the cert-check extension's try-it disclosure renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, "userAgent", { get: () => "Chromium (visual capture)" });
          const announce = () => {
            document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
            window.dispatchEvent(new Event("diveday-cert-check-ready"));
          };
          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", announce);
          } else {
            announce();
          }
          window.addEventListener("message", (event) => {
            const data = event.data;
            if (data?.source !== "diveday-page") return;
            const answers: Record<string, object> = {
              hello: {
                ok: true,
                version: "1.5.0",
                agencies: ["ssi", "naui", "sdi", "gue", "cmas", "padi"],
                elearning: ["padi"],
              },
              "dry-run": {
                ok: true,
                filled: data.query?.agency !== "naui",
                typed: data.query?.agency !== "naui",
                submitted: data.query?.agency !== "naui",
                hostAccess: true,
                missing: data.query?.agency === "naui" ? ["birthDate"] : [],
              },
              "padi-session": { ok: true, padi: "signed_in" },
            };
            const answer = answers[data.type];
            if (!answer) return;
            window.postMessage(
              {
                source: "diveday-cert-check",
                type: "agency-check-result",
                requestId: data.requestId,
                ...answer,
              },
              window.location.origin,
            );
          });
        });
        await page.goto("/shop/blue-mantis/settings");
        await openSettingsRow(page, "Card checks");
        await page.getByText("Try the checks", { exact: true }).click();
        await page.getByText("Added to this browser (1.5.0)").first().waitFor();
        await page.getByRole("button", { name: "Run the checks" }).click();
        await page.getByText("Signed in", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Copy report" }).waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "settings-cert-checks", scheme);
      });

      /**
       * The shop's prepaid dive packages — the price list, and the form that
       * adds one (issue #706). Its own page since that list plus a five-field
       * add form stopped fitting inside a directory row.
       *
       * The seeded shop sells none, so this photographs the empty state plus
       * the add form — which is exactly what a shop meets before the feature
       * turns itself on.
       */
      test(`the dive-packages page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/promos/packages");
        await page.getByRole("heading", { level: 1, name: "Dive packages" }).waitFor();
        await page.locator("#package-new summary").waitFor();
        await capture(page, "settings-dive-packages", scheme);
        await page.locator("#package-new summary").click();
        await page.getByRole("button", { name: "Add package", exact: true }).waitFor();
        await capture(page, "settings-dive-packages-add", scheme);
      });

      /**
       * The Features page (issue #2814): every on/off switch a shop owns, once.
       * It replaces the Stripe Tax card's own capture (`settings-tax`): the tax
       * switch is a row here, with the sentence that says what turning it on
       * does. Opening nothing and saving nothing, so the shared fixture's
       * `shops` flags are exactly as the capture found them (ADR
       * 20260815-per-test-private-shops); `e2e/tax.spec.ts` drives the switch
       * on a shop of its own.
       */
      test(`the features page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/features");
        await page.getByRole("heading", { level: 1, name: "Features" }).waitFor();
        await page.getByRole("button", { name: "Save" }).first().waitFor();
        await capture(page, "settings-features", scheme);
      });

      // Where a shop connects its own WhatsApp Business number (ADR
      // 20260802-whatsapp-embedded-signup). The fleet configures no META_*
      // credentials, so this captures the coming-soon state — which is what
      // every shop sees today, and where all of this surface's copy lives.
      test(`WhatsApp settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/whatsapp");
        await page.getByRole("heading", { name: "No WhatsApp number connected" }).waitFor();
        await capture(page, "settings-whatsapp", scheme);
      });

      // Provider connections are disabled in the browser fleet because their
      // OAuth client secrets are not configured. The useful visual contract is
      // what a shop sees for a provider DiveDay has not switched on: one muted
      // line and no control, which should stay understandable as more providers
      // join the registry.
      test(`integrations settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/integrations");
        await page.getByRole("heading", { level: 1, name: "Your data" }).waitFor();
        await capture(page, "settings-integrations", scheme);
      });

      /**
       * The two orders surfaces — the densest money screens in the app, and
       * until recently the only ones with no baseline at all. That gap was found
       * the honest way: the shop-currency change (ADR 20260731-shop-currency)
       * rewrote how every amount here is formatted, and the visual suite
       * reported nothing, because it had never looked. A surface whose whole
       * job is stating amounts is exactly where a silent pass is worthless.
       *
       * Both render the *order row's own* stored currency, not the shop's
       * current setting: a settled amount is evidence and is never
       * re-denominated by a later settings change.
       */
      test(`the orders list renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders");
        await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
        // A row of the day ledger itself, not just the heading — the ledger
        // streams in and a capture taken on the header alone banks an empty
        // page. (The table became day groups with slice 6f, ADR
        // 20260827-clearwater-surface-language.)
        await page.locator('ul[aria-labelledby^="orders-day-"] > li').first().waitFor();
        await capture(page, "orders", scheme);
      });

      /**
       * The same page on the shop's worst day: a Stripe call nobody confirmed,
       * and divers still owed money for a departure the shop cancelled.
       *
       * Both panels render *only* when something has gone wrong, which is
       * exactly why they had never been photographed — and they are the shape
       * most likely to break, being warning-toned blocks of dense prose with
       * inline links. /api/test/seed-trouble-states puts the demo shop into
       * that state; it is a test-only route rather than seed data because a
       * demo permanently shouting that payments are broken is a worse demo
       * (src/db/seed-front-desk.ts says so at the row it seeds `succeeded`).
       * Safe to mutate: each worker owns its own database and resets it before
       * every test (e2e/servers.ts).
       */
      test(`the orders list renders its unfinished money (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?owedRefund=1");
        await page.goto("/shop/blue-mantis/orders");
        await page.getByRole("region", { name: "Payments that need a check" }).waitFor();
        await page.getByRole("region", { name: "Refunds you still owe" }).waitFor();
        await page.getByRole("region", { name: "Paid after the checkout closed" }).waitFor();
        await page.getByRole("region", { name: "Refunds that failed" }).waitFor();
        await capture(page, "orders-unconfirmed-and-owed", scheme);
      });

      /**
       * The one order that has given money back and is still holding some.
       *
       * `partly_refunded` arrived with the staff partial refund (issue #699)
       * and had no capture at all: the seeded example sorts onto a later page
       * of the index, so the only pixel that moved on the whole visual suite
       * was the pager counting one more order. A new money status, a new badge
       * tone, and the refund control's amount field — the actual new UI —
       * photographed nowhere, which is the silent pass the two comments above
       * were written about.
       *
       * Reached through the index's own `?status=` filter rather than a
       * hardcoded id, because the seeded order's uuid is regenerated on every
       * seed. This narrows *which order* is on screen, never the page itself —
       * the surface is captured whole, and the list it lands on is bounded by
       * the same pager the unfiltered one wears (AGENTS.md's rule is against
       * shrinking a capture to dodge an unbounded page, which this is not).
       */
      test(`a part-refunded order renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders?status=partly_refunded");
        await page
          .locator('ul[aria-labelledby^="orders-day-"] > li a[href*="/orders/"]')
          .filter({ visible: true })
          .first()
          .click();
        // "Diver record" for the reason the sibling capture below gives: the
        // eyebrow text is identical on the list this came from, so waiting on
        // it resolves instantly against the old page.
        await page.getByRole("link", { name: "Diver record" }).waitFor();
        // The refund control is the point of the capture, so the capture waits
        // for it rather than for the heading that arrives before it.
        await page.getByRole("button", { name: "Refund payment" }).waitFor();
        await capture(page, "order-detail-partly-refunded", scheme);
      });

      // One order in full: the total, and the per-line-item amounts that a
      // literal `$` and a hardcoded `/ 100` used to compose by hand.
      test(`an order's detail renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders");
        const ledgerRow = page.locator('ul[aria-labelledby^="orders-day-"] > li');
        await ledgerRow.filter({ visible: true }).first().waitFor();
        await ledgerRow.locator('a[href*="/orders/"]').filter({ visible: true }).first().click();
        // Not "Money": the index this just navigated from wears that word as
        // its own `<h1>`, already on screen, so waiting on it resolves
        // instantly against the *old* page instead of the new one — capture()
        // then fires while orders/[id] is still behind its own loading.tsx
        // skeleton. "Diver record" only exists on the detail page.
        await page.getByRole("link", { name: "Diver record" }).waitFor();
        await capture(page, "order-detail", scheme);
      });

      // **The dispute sheet on screen** (issue #2390): a seat's order, the
      // signed release, the check-in and the roll call, reached the way an
      // owner reaches it, from the order's own "Dispute sheet" door.
      test(`a seat's dispute sheet renders true to the design (${scheme})`, async ({ page }) => {
        await openDisputeSheet(page);
        await capture(page, "order-dispute-sheet", scheme);
      });

      // A deposit names the departure it was raised for and what the seat
      // still owes (third UX review, item 32).
      test(`a deposit order's detail names its departure (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/orders?q=Trip+deposit");
        const ledgerRow = page.locator('ul[aria-labelledby^="orders-day-"] > li');
        await ledgerRow.filter({ visible: true }).first().waitFor();
        await ledgerRow.locator('a[href*="/orders/"]').filter({ visible: true }).first().click();
        await page.getByRole("link", { name: "Open the departure" }).waitFor();
        await capture(page, "order-detail-deposit", scheme);
      });

      /**
       * The one data-out surface: the "your data is yours" promise, concrete,
       * in both halves (ADR 20260806-one-data-out-surface) — the bundle you
       * would download now, and the weekly copy already landing in storage the
       * shop owns. The `settings-backup` capture retired into this one; the
       * seed ships blue-mantis configured with six weekly deliveries and one
       * failed week, so the backup half still photographs doing its real job:
       * proving where the data went and naming the week it didn't.
       */
      test(`the data-export page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/export");
        await page.getByRole("heading", { level: 1, name: "Your data" }).waitFor();
        // The crew sheet (N-43) is the second thing that leaves this page.
        await page.getByRole("heading", { name: "Crew sheet" }).waitFor();
        await capture(page, "settings-export", scheme);
      });

      // The Backups tab of the same page set: the destination and the delivery
      // history, which used to sit under the download on one long page.
      test(`the backups tab renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/export/backups");
        await page.getByRole("heading", { level: 1, name: "Your data" }).waitFor();
        await page.getByRole("heading", { name: "Delivery history" }).waitFor();
        // The history rows, not just the heading — the table is half the
        // surface, and a capture taken on the heading alone banks an empty one.
        await page.getByRole("cell", { name: "Failed" }).waitFor();
        await capture(page, "settings-backups", scheme);
      });

      // The shop's activity log (D5): who did what, to what, when, across the
      // whole team, with its four filters above the first page of lines.
      test(`the activity log renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/activity");
        await page.getByRole("heading", { level: 1, name: "Activity" }).waitFor();
        // The lines, not just the heading: a capture on the heading alone banks
        // the skeleton's list.
        await page.getByTestId("shop-activity").getByRole("listitem").first().waitFor();
        await capture(page, "settings-activity", scheme);
      });

      // The import surface: the honesty table stating what does and doesn't
      // come across, before any file is chosen.
      test(`the data-import page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/import");
        await page.getByRole("heading", { name: "What comes across" }).waitFor();
        await capture(page, "settings-import", scheme);
      });

      // Import's "Gear history" tab: the gear CSV importer.
      test(`the gear-history import tab renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/import?what=gear");
        await page.getByRole("link", { name: "Download gear CSV template" }).waitFor();
        await capture(page, "settings-gear-import", scheme);
      });

      // The other half of `dive_sites.csv`: the bundle carried the shop's whole
      // library for a year while nothing could read one back (issue #1771).
      test(`the dive-site import tab renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/import?what=dive-sites");
        await page.getByRole("button", { name: "Import dive sites" }).waitFor();
        await capture(page, "settings-dive-site-import", scheme);
      });

      /**
       * Settings' "Data" group when the shop owes work it has
       * not finished: photos removed from the app but still in storage, and an
       * erased diver's records still sitting at Stripe. Danger-toned, and the
       * only place either obligation is ever stated — an unfinished erasure is
       * a legal duty, not a notification. Empty on nearly every real day, and
       * therefore never photographed until this capture.
       */
      test(`settings shows the deletions that didn't finish (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await page.goto("/shop/blue-mantis/settings");
        await page.getByRole("region", { name: "Photos that didn’t finish deleting" }).waitFor();
        await page.getByRole("region", { name: "Erasures not finished at Stripe" }).waitFor();
        await capture(page, "settings-data-unfinished", scheme);
      });

      // The embed settings page (docs ADR 20260726-schedule-embed). The fleet
      // now runs against a configured non-loopback APP_HOST (E2E_APP_HOST in
      // e2e/servers.ts), so this baseline is the generated-snippet state a
      // real deploy shows — the two SnippetField boxes and the copy buttons —
      // rather than the "hosting isn't configured" warning it was stuck on
      // while publicAppUrl() returned null here.
      test(`the embed settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/embed");
        await page.getByRole("heading", { name: "Website embed" }).waitFor();
        // The snippets are a Client Component; wait for a control it only
        // renders once mounted before shooting.
        await page.getByRole("button", { name: "Copy" }).first().waitFor();
        await capture(page, "settings-embed", scheme);
      });

      // The team surface at rest: inviting staff, and a roster whose rows read
      // their roles as words behind a disclosure — the page-level "Save
      // changes" is gone (ADR 20260827-the-shops-shelves, slice 9h).
      test(`the team settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/team");
        await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
        await capture(page, "settings-team", scheme);
      });

      // One row's roles open, which is the state that has no still image
      // anywhere else: the checkbox grid inset in the row it belongs to, with
      // no Save button beneath it because closing the row is the save.
      test(`the team roles disclosure renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/team");
        await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
        const roles = page.getByRole("button", { name: /^Edit roles for / }).first();
        await roles.click();
        await expect(roles).toHaveAttribute("aria-expanded", "true");
        await capture(page, "team-role-disclosure", scheme);
      });

      // The shop's own pre-departure checklist: seeded lines
      // (src/db/seed-pre-departure-checklist.ts), the reorder/delete controls
      // beside each, and the add form (ADR 20260824-pre-departure-safety-check).
      test(`the pre-departure checklist settings render true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/safety-checklist");
        await page.getByRole("heading", { level: 1, name: "Pre-departure checklist" }).waitFor();
        await page.getByText("VHF radio checked").waitFor();
        await capture(page, "settings-safety-checklist", scheme);
        await page.locator("#checklist-new summary").click();
        await page.getByLabel(staffCopy("settings.safetyChecklist.addLabel")).waitFor();
        await capture(page, "settings-safety-checklist-add", scheme);
      });

      /**
       * **The first DiveDay screen a new hire ever sees**, and nothing had ever
       * looked at it. It has an `error.tsx` of its own — somebody thought about
       * its failure path — while its happy path went uncaptured because
       * `check:route-coverage` counted `staff-invite.spec.ts` as coverage and
       * passed (issue #727).
       *
       * Driven through the real invite, because the token is hashed at rest and
       * `/api/test/seed-account-token` will only re-mint for an account that
       * already exists — `inviteStaffMember` is what creates it (ADR
       * 20260726-staff-invite-accounts). Deterministic email, not `Date.now()`:
       * a wall-clock value here is a permanent diff between CI runs, not a
       * regression (same reasoning as the onboarding capture).
       */
      test(`the staff invite page renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const email = `invite-capture-${scheme}@example.com`;
        await page.goto("/shop/blue-mantis/settings/team");
        // The invite form opens from its button under the team (ideas item 58).
        const inviteSection = page.locator("#invite");
        await inviteSection.locator("summary").click();
        await inviteSection.getByLabel("Full name").fill("Priya Nair");
        await inviteSection.getByLabel("Email").fill(email);
        await inviteSection.getByLabel("Instructor", { exact: true }).check();
        await inviteSection.getByRole("button", { name: "Send invite" }).click();
        await expect(page.getByText("Invite sent.")).toBeVisible();

        const seeded = await request.post("/api/test/seed-account-token", {
          data: { email, purpose: "invite" },
        });
        expect(seeded.ok()).toBe(true);
        const { token } = (await seeded.json()) as { token: string };

        await page.goto(`/invite/${token}`);
        // Streams behind a loading.tsx — wait for the page's own h1, the same
        // signal every other account-lifecycle capture here gates on.
        await page.locator("h1").first().waitFor();
        await page.getByLabel("Password", { exact: true }).waitFor();
        await capture(page, "staff-invite", scheme);
      });

      // Calendar subscriptions, in the un-subscribed state: both scopes
      // offered to an owner, neither yet minted. Deliberately not the
      // just-minted state — that panel shows a live feed token, which is
      // different on every run and would never match a baseline.
      test(`the calendar settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        // Wait on the panel's own button, not the page's <h1>: the panels are
        // Client Components, and per this file's rule a server-rendered
        // heading resolves before the interesting part has mounted.
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        await capture(page, "settings-calendar", scheme);
      });

      // The staffer's own Email settings: the Monday email's row, on for the
      // owner by default, with its preview door, and the after-hours ping's.
      test(`the email settings render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/email");
        await page
          .getByRole("region", { name: "After-hours messages" })
          .getByRole("button", { name: "Turn off" })
          .waitFor();
        await capture(page, "settings-email", scheme);
      });

      // The Monday email itself, as the preview renders it from the frozen
      // clock's week of the seeded demo shop: the one capture of an email body.
      test(`the Monday email renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/email/preview");
        await page.getByText(/Weeks run Monday to Sunday|no email goes out this Monday/).waitFor();
        await capture(page, "weekly-digest-email", scheme);
      });

      // The courses catalog as one ledger (slice 9g of ADR
      // 20260827-the-shops-shelves): agency as the group heading that replaced
      // the tab strip, the list in progression order rather than alphabetical,
      // and the dissolved row — the row's own tap opens the course's editor,
      // with Schedule as the row's one quiet act beside it and the
      // public-catalog door up in the header. Hide/Show moved to the course's
      // own editor: 55 rows carrying a rare act was a toolbar, not an
      // affordance.
      test(`the staff course catalog renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/courses");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await page.getByRole("heading", { level: 2, name: "PADI" }).waitFor();
        await capture(page, "courses-list", scheme);
      });

      // A later page of the same ledger: the group heading re-rendering on the
      // page its rows landed on, which is what "grouping composes with the
      // Pager" looks like. It replaced the `?agency=` tab capture, which
      // photographed a filter that no longer exists.
      test(`a later page of the staff course catalog renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/courses?page=2");
        await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();
        await page.getByRole("heading", { level: 2 }).first().waitFor();
        await capture(page, "courses-list-page-two", scheme);
      });

      // A course's edit page, on the long-form editor pattern (ADR
      // 20260827-the-shops-shelves): the section rail down the first column at
      // 1280 and, at 390, no rail: each section folds to a header naming it
      // with a line of what it holds, the first one open, eight unboxed sections
      // separated by hairlines rather than eight bordered fieldsets, the depth
      // marker hint beside the prose it governs, and the single Save at the
      // foot — no Preview beside it (ADR 20260805-remove-certification-paths
      // shipped alongside that trim). "Hide from the catalog" sits below the
      // save bar as the page's one rare act.
      test(`the course editor renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/courses/open-water-diver/edit");
        // The rail is the frame of this composition, and it is client-rendered;
        // waiting on the server-rendered legend alone let the capture land
        // mid-mount. ("Day by day" now names two elements — the rail's anchor
        // and the section's own legend — so it is no longer a locator.)
        await page.getByRole("navigation", { name: "Sections", exact: true }).waitFor();
        await page.getByLabel("Day 1 — what happens").waitFor();
        await capture(page, "course-edit", scheme);
      });

      /**
       * The save bar, which `capture()` above cannot photograph: it is sticky,
       * and a full-page screenshot taken at scroll 0 does not paint a stuck
       * element at all (see `captureStickyFoot`). This form is four thousand
       * pixels of fields with one primary action, so a baseline that omits it
       * is a baseline of the wrong page.
       *
       * It is also the one shot that catches the rail *pinned*: scrolled to the
       * foot, the rail is stuck under the chrome bar with its last entry
       * current, which is the state a full-page capture at scroll 0 flattens
       * away exactly as it does the bar.
       */
      test(`the course editor's save bar renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/courses/open-water-diver/edit");
        // Same wait as the full-page shot. The folded sections' preview lines
        // are filled in after hydration; `captureStickyFoot` waits for each
        // to say so (`waitForClientFills`).
        await page.getByRole("navigation", { name: "Sections", exact: true }).waitFor();
        await page.getByLabel("Day 1 — what happens").waitFor();
        await captureStickyFoot(page, "course-edit-save-bar", scheme);
      });

      // Owner reporting: "how's my month" over the seeded back-fill — the five
      // unboxed figures and the departures ledger that answer the buyer's
      // revenue question (slice 9f of ADR 20260827-the-shops-shelves; the
      // baseline moved with it, from six bordered tiles over a five-column
      // table).
      test(`Safety month and year keep their view and print controls (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/safety");
        await page.getByRole("button", { name: "Print month" }).waitFor();
        await capture(page, "safety-month", scheme);
        await page.getByRole("link", { name: "Year view", exact: true }).click();
        await expect(page).toHaveURL(/\/safety\?year=\d{4}/);
        await page.getByRole("link", { name: "Month view", exact: true }).waitFor();
        await capture(page, "safety-year", scheme);
      });

      test(`bookkeeper settings keep the settings rail (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/bookkeeper");
        await page
          .getByRole("heading", { level: 1, name: staffCopy("reports.bookkeeper.label") })
          .waitFor();
        await capture(page, "settings-bookkeeper", scheme);
      });

      test(`owner reports render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/reports");
        await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
        await capture(page, "reports", scheme);
      });

      /**
       * The same page on a month that has fully sailed, which is the reading
       * the current month cannot give: every comparison line resolved against a
       * baseline month, and the waiver meters at their final ratios — the amber
       * *remainders* the ledger exists to put in front of a staffer, against
       * the quiet fills that must never take that tone.
       *
       * Walked to through the arrow rather than a literal `?month=`: the suite
       * freezes one instant, so "the month before the frozen one" is
       * deterministic while a hard-coded key would rot the day the clock moves.
       */
      test(`a fully-sailed month's figures render true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/reports");
        await page.getByRole("link", { name: "Previous month" }).click();
        // The current month renders a "Trips this month" region too, so waiting
        // on the region alone is satisfied before the click has landed — which
        // is how one baseline of this capture came to show July "so far" over
        // June's final figures. The arrow's destination carries `?month=`; the
        // landing page does not.
        await expect(page).toHaveURL(/[?&]month=/);
        await page.getByRole("region", { name: "Trips this month" }).waitFor();
        await capture(page, "reports-figures", scheme);
      });

      /**
       * **The shop's year** (ADR 20260908-one-hand, decision 6, lever T) — the
       * other reading of the same route, reached by the one new control on
       * Reports. The sentence, the strip of fifty-odd weeks, the four figures,
       * and the sites by the times they were dived.
       *
       * Both viewports in one capture, which is the point of photographing it:
       * the strip is fifty-three columns wide at 390px and at 1280px, and the
       * whole promise of drawing it in the tree's tokens rather than in the
       * canvas's CSS is that neither width scrolls sideways.
       */
      test(`the shop's year renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/reports?range=year");
        await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
        await page.getByRole("region", { name: "The year’s numbers" }).waitFor();
        await capture(page, "reports-year", scheme);
      });

      /**
       * The waiver surface as one page (ADR 20260827-people-not-lists,
       * decision 4): the signature log as a day-grouped ledger, under one
       * "Edit the release" door. The editor used to stand open above it — a
       * full-height textarea of the legal text, a radio pair and a Publish, on
       * top of 519 signed records — and editing a release is rare where reading
       * who signed is daily (slice E3-7). The log is paginated
       * (`listWaiverIntegrityAudit`, `WAIVER_INTEGRITY_PAGE_SIZE`) so the demo
       * shop's 150+ signed records are one bounded page under the shared pager
       * rather than a 17,000px capture — the page is what is bounded, not the
       * photograph.
       *
       * Waits for the pager, not just the heading: the log renders below the
       * door, and a capture taken before it lands photographs half a page.
       */
      test(`the waiver surface renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/waivers");
        await page.getByRole("heading", { level: 1, name: "Waivers and signed records" }).waitFor();
        await page.getByRole("navigation", { name: "Pages" }).waitFor();
        await capture(page, "staff-waivers", scheme);
      });

      /**
       * Materiality as a recorded choice, with the material option selected
       * and Publish armed. Publishing a material version makes every signature
       * the shop holds stop counting at once, so what that costs is on the
       * option being selected rather than in a notice afterwards (issue #720).
       * Photographed because the numbers in it come off the seeded roster — a
       * change that quietly stops counting shows up here as pixels — and
       * because the armed button is the one danger-toned control on the page.
       *
       * The arm carries no `autoResetMs`, and that is what makes this capture
       * deterministic rather than a race: `capture()` resizes, repaints and
       * shoots twice on budgets measured in tens of seconds, while a
       * `setTimeout` runs on the runner's real clock — the fleet freezes
       * `Date`, not timers — so a timed arm let the desktop shot photograph a
       * settled button. See `PublishRelease.tsx`; never reintroduce one here
       * without re-arming inside the capture loop.
       */
      test(`the waiver's materiality choice renders true to the design (${scheme})`, async ({
        page,
      }) => {
        // Straight to the open editor: `#release` is the fragment the door
        // answers to, and `AutoOpenDetails` opens it on a hard load as well as
        // on a client transition.
        await page.goto("/shop/blue-mantis/waivers#release");
        await page.getByRole("heading", { level: 1, name: "Waivers and signed records" }).waitFor();
        await page.getByRole("radio", { name: /A material change/ }).check();
        await page.getByRole("button", { name: "Publish", exact: true }).click();
        await page.getByRole("button", { name: /Publish: \d+ signs? again/ }).waitFor();
        await capture(page, "waiver-materiality-choice", scheme);
      });

      /**
       * A signed record reached the way a reviewer reaches one: the roster's
       * "View signed record" deep link, which pins the row first inside its own
       * day group and opens it. This is the only state that renders the
       * evidence block — the release version, the two doors, and any flagged
       * medical prompt — so without it nothing has ever looked at it.
       */
      test(`a pinned signed record renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/waivers");
        const rows = page.locator('details[id^="waiver-record-"]');
        await rows.first().waitFor();
        const record = (await rows.first().getAttribute("id"))?.replace("waiver-record-", "");
        await page.goto(`/shop/blue-mantis/waivers?record=${record}`);
        await page.locator('details[id^="waiver-record-"][open]').first().waitFor();
        await capture(page, "staff-waivers-record", scheme);
      });

      // The moderation queue as a worklist: one aggregate line under the title,
      // "Needs you" leading with its clear-the-lot act, then the published
      // record quiet beneath it (ADR 20260827-people-not-lists, decision 3).
      // Waiting on the worklist group specifically, not just the heading: the
      // groups render above the published run, and a capture taken before they
      // land photographs a half-built page. The seed leaves exactly one review
      // waiting (`seed-history.ts` — Today's deep link depends on that count),
      // so the group's clear-the-lot act is deliberately absent here; the
      // reviews spec exercises it with a second review in hand.
      test(`the review moderation queue renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/reviews");
        await page.getByRole("heading", { level: 1, name: "Inbox" }).waitFor();
        await page.getByRole("region", { name: /^Needs you/ }).waitFor();
        await page.getByRole("region", { name: /^Published/ }).waitFor();
        await capture(page, "staff-reviews", scheme);
      });

      // The same queue narrowed by a chip (fourth UX review, item 30): the
      // chip row under the aggregate line, the chosen chip marked, and the
      // groups holding only the reviews that carry a comment.
      test(`the review queue narrowed to reviews with a comment (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/reviews?show=comment");
        await page.getByRole("heading", { level: 1, name: "Inbox" }).waitFor();
        await page.locator('a[aria-current="true"]', { hasText: "With a comment" }).waitFor();
        await page
          .getByRole("region", { name: /^Published/ })
          .or(page.getByText("No reviews match this view."))
          .first()
          .waitFor();
        await capture(page, "staff-reviews-narrowed", scheme);
      });

      // The review row's "⋯" open, then its Hide: the list floats under its
      // button and the reason picker takes its place in the same panel, and
      // the row keeps its height throughout. Both used to open *inside* the
      // row as nested disclosures, pushing the review down twice.
      test(`the review row menu opens beside its button (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/reviews");
        await page.getByRole("region", { name: /^Published/ }).waitFor();
        const waiting = page.getByRole("region", { name: /^Needs you/ });
        await waiting.getByRole("button", { name: /^More for/ }).click();
        await capture(page, "staff-reviews-row-menu", scheme);
        await waiting.getByRole("button", { name: "Hide", exact: true }).click();
        await page.getByLabel("Why are you taking it down?").waitFor();
        await capture(page, "staff-reviews-row-menu-hide", scheme);
      });

      /**
       * **The panel that only exists when something has gone wrong** (D40,
       * issue #1200) — the class AGENTS.md says is photographed through a
       * test-only seed route rather than by seeding the failure into the demo
       * shop. `POST /api/test/seed-recap-pulse` files one open pulse against
       * the pinned recap booking, which is the only way this block renders at
       * all: with nothing to fix it draws nothing, and blue-mantis must not
       * ship a standing complaint about its own rental gear.
       *
       * It sits above the ledger, so waiting on its heading is also what proves
       * the page below it did not shift under a block that arrived late.
       */
      test(`the reviews page shows what divers asked the shop to fix (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-recap-pulse");
        await page.goto("/shop/blue-mantis/reviews");
        await page.getByRole("heading", { level: 1, name: "Inbox" }).waitFor();
        await page.getByRole("heading", { name: "Asked us to fix" }).waitFor();
        await page.getByRole("region", { name: /^Published/ }).waitFor();
        await capture(page, "staff-reviews-pulse", scheme);
      });

      test(`the public reviews archive renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/s/blue-mantis/reviews");
        await page.getByRole("heading", { level: 1, name: "All reviews" }).waitFor();
        await capture(page, "public-reviews", scheme);
      });

      /**
       * **The shop's reply under a review** (batch 4, K2), signed with the
       * shop's name, through the opt-in `?reviewReply=1` state.
       */
      test(`a review with the shop's reply renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?reviewReply=1");
        expect(seeded.ok()).toBe(true);
        await page.goto("/s/blue-mantis/reviews");
        await page.locator("[data-review-reply]").first().waitFor();
        await capture(page, "public-reviews-reply", scheme);
      });

      /**
       * The reply editor open on a published review: the field, its limit and
       * the two acts, where the row's own words already are.
       */
      test(`the review reply editor opens under its review (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/reviews");
        const published = page.getByRole("region", { name: /^Published/ });
        await published.getByRole("button", { name: "Reply in public" }).first().click();
        await published.getByLabel("Your reply").waitFor();
        await capture(page, "staff-reviews-reply-editor", scheme);
      });

      /**
       * The same queue for a shop that has hidden its way past the line where
       * DiveDay stops publishing its rating to search engines — the warning
       * that explains the Hidden group beneath it, and the only screen that
       * tells a shop its average has stopped being vouched for
       * (ADR 20260813-review-moderation-has-a-floor). Unreachable from the
       * seed: blue-mantis publishes everything, so the fixture route hides
       * however many it takes to cross the threshold.
       */
      test(`the reviews page says when a rating is being withheld (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states");
        await page.goto("/shop/blue-mantis/reviews");
        await page.getByRole("heading", { level: 1, name: "Inbox" }).waitFor();
        await page.getByText(/DiveDay has stopped publishing it/).waitFor();
        await capture(page, "staff-reviews-rating-withheld", scheme);
      });

      // Divers asking for a day the board has nothing on, grouped by that day:
      // the seeded requests put two people on one date (one of them by their
      // alternate, one of them flexible into it), which is the whole reason the
      // group header carries a count and a request reached by two days is
      // printed whole under one of them and referenced by a single line under
      // the other (ADR 20260827-people-not-lists, decision 5). Waiting on the
      // day's own act rather than only the heading — the groups render below
      // it, so a capture taken before one lands photographs a half-built list.
      test(`the date requests list renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/requests");
        await page.getByRole("heading", { level: 1, name: "Inbox" }).waitFor();
        await page.getByRole("link", { name: "Add a departure" }).first().waitFor();
        await capture(page, "staff-date-requests", scheme);
        await page
          .getByRole("button", { name: /^Actions for/ })
          .first()
          .click();
        await page.getByRole("button", { name: "Mark done" }).first().waitFor();
        await capture(page, "staff-date-requests-row-menu", scheme);
      });

      // A request staff closed (third UX review, item 13): off the open list
      // and into the short Done list under it, with Reopen beside it. Marked
      // here rather than seeded, because a closed request in the demo seed
      // would move the open list's own baseline above.
      test(`a request marked done sits under the open list (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/requests");
        await page.getByRole("heading", { level: 1, name: "Inbox" }).waitFor();
        await page
          .getByRole("button", { name: /^Actions for/ })
          .first()
          .click();
        await page.getByRole("button", { name: "Mark done" }).first().click();
        await page.getByRole("region", { name: /^Done:/i }).waitFor();
        await capture(page, "staff-date-requests-done", scheme);
      });

      // "Move to another departure", open on a seat (third UX review, item
      // 11): one select of later departures of the same kind, each worded
      // with its zone, and one button. The row is any booked seat on the
      // reef morning, found by the control itself.
      test(`a seat's move to another departure, open (${scheme})`, async ({ page }) => {
        const tripId = await seededTripId(page, "blue-mantis", REEF_TRIP);
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        const row = page
          .locator('#roster li[id^="booking-"]')
          .filter({ visible: true })
          .filter({ has: page.locator("summary", { hasText: "Move to another departure" }) })
          .first();
        await openRosterDetails(row);
        await row.locator("summary", { hasText: "Move to another departure" }).click();
        await row.getByLabel("Departure").waitFor();
        await row.getByRole("button", { name: "Move", exact: true }).scrollIntoViewIfNeeded();
        await capture(page, "trip-roster-move-seat", scheme);
      });

      // What divers wrote back, as a worklist (ADR 20260907-two-way-inbox):
      // the unanswered ones under a group carrying their count, the answered
      // ones under theirs, and a stranger's row showing the address it came
      // from because it has no record to open. The seed puts one of each in
      // (`src/db/seed-inbox.ts`), which is the whole reason this surface can be
      // photographed at all. Waiting on the second group as well as the
      // heading: both render from one query, so a capture taken on the first
      // alone can photograph a half-built list.
      test(`the shop inbox renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/inbox");
        await page.getByRole("heading", { level: 1, name: "Inbox" }).waitFor();
        await page.getByRole("heading", { name: "Done" }).waitFor();
        await capture(page, "staff-inbox", scheme);
      });

      // A row's "⋯" open: the list floats under its button, over the rows
      // below, and the row it belongs to keeps its height. The stranger's row,
      // because it is the one whose list carries both acts.
      test(`the inbox row menu opens beside its button (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/inbox");
        await page.getByRole("heading", { name: "Done" }).waitFor();
        await page
          .getByRole("button", { name: "More for the message from Unknown sender" })
          .click();
        await page.locator("[data-row-menu]").waitFor();
        await capture(page, "staff-inbox-row-menu", scheme);
      });

      // The other half of the same feature: one diver's conversation on their
      // own record, reached through the inbox row that opens it. It is the one
      // file group rendering both directions — what they wrote and what the
      // shop wrote back — with the composer beneath, and it opens itself
      // because this diver is waiting on an answer.
      test(`a diver's conversation renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/inbox");
        await page.getByRole("link", { name: "Open the record for Priya Sharma" }).click();
        await page.getByRole("heading", { level: 1, name: "Priya Sharma" }).waitFor();
        await page
          .getByRole("region", { name: "Conversation" })
          .getByText(/today.s reef boat/)
          .waitFor();
        await capture(page, "staff-diver-conversation", scheme);
      });

      // **Saved answers** (fifth loop, item 15), where the shop keeps them: the
      // foot of the Inbox, holding the two the seed saves, one with both
      // markers. The chips above the reply box are in the capture above.
      test(`the inbox's saved answers render true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/inbox");
        const saved = page.getByRole("region", { name: "Saved answers" });
        await saved.getByText("Wetsuit sizes").waitFor();
        await saved.scrollIntoViewIfNeeded();
        await capture(page, "staff-inbox-saved-answers", scheme);
      });

      // Shop-wide discount codes: the codes as one ledger shelved live /
      // scheduled / ended, with the trip deals as their own ledger beneath
      // (slice 9g of ADR 20260827-the-shops-shelves; codes themselves are ADR
      // 20260729-shop-promo-codes). The seed holds a live code and an expired
      // one, so two shelves render and the windows and redemption counts sit on
      // the rows. The demo has no Stripe account and never connects one, so
      // nothing stands above the ledger: no Connect ask and no "New code" door
      // that would open only on one (fourth review, item 53).
      test(`the discount codes page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/promos");
        await page.getByRole("heading", { level: 1, name: "Money" }).waitFor();
        // The shelves are what changed; wait for one rather than for the
        // header, which paints with the static shell.
        await page.getByRole("heading", { level: 2, name: "Live" }).waitFor();
        await capture(page, "staff-promos", scheme);
      });

      // H-13: a Night-trip seat booked through a shared inbox under a name that
      // doesn't match the person on file shows the fail-closed "Confirm
      // identity" affordance and blocker until staff vouch for it — a
      // safety-critical state worth a baseline.
      test(`the roster identity gate renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/schedule/board");
        await openTripFromBoard(page, "Night Dive — City of Washington");
        await openTripTab(page, "Trip");
        await page.getByText("Booked as Hana Park with June Park’s email.").first().waitFor();
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
        const row = page
          .locator("#roster li")
          .filter({ hasText: "Booked as Hana Park" })
          .filter({ visible: true })
          .first();
        await row.getByText("Booked as Hana Park", { exact: false }).waitFor();
        await openRosterDetails(row);
        // The line that stands in for the withheld fields — waited on rather
        // than the panel, because the panel is open either way and it is this
        // sentence the baseline exists for.
        await expect(
          row.getByText("Medical and gear details stay hidden until you confirm"),
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
        // Same background-save settle the departure capture waits on, so this
        // isn't racing that async write either.
        await offlineCopySaved(page);
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        // Scoped to the diver list: the crew section above it carries controls
        // with the same words, for a crew member rather than a diver.
        // Two deliberate steps, the way a crew records it (ADR
        // 20260827-the-departure-is-two-working-surfaces, decision 3): the
        // claim lives in the person's own panel, never on the row.
        const missingRow = page.locator("#roll-call-list > ul > li").first();
        await openManifestPerson(missingRow);
        const markNotBack = page
          .getByRole("dialog")
          .getByRole("button", { name: "Mark not back aboard" });
        await markNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await markNotBack.click();
        await expect(
          page.getByRole("dialog").getByRole("button", { name: "Not back aboard", exact: true }),
        ).toBeVisible();
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
        await page.mouse.move(0, 0);
        await capture(page, "manifest-not-back-aboard", scheme);
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
      test(`the manifest's plan-change fields render true to the design (${scheme})`, async ({
        page,
      }) => {
        // Board → trip → Manifest, then a checkpoint switch and a disclosure.
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        await offlineCopySaved(page);
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        // The log's own summary line, which only this checkpoint renders.
        await page.getByText("Dive 1 — not recorded yet").click();
        // Waits on a control the open form renders and the closed one does not.
        await page.getByLabel("Why the plan changed").waitFor();
        await page.mouse.move(0, 0);
        await capture(page, "manifest-plan-change", scheme);
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
        await offlineCopySaved(page);
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
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
        await seen.getByRole("button", { name: "Goliath grouper", exact: true }).click();
        await expect(seen.getByRole("listitem")).toHaveCount(2);
        await page.mouse.move(0, 0);
        await capture(page, "manifest-seen", scheme);
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
        await offlineCopySaved(page);
        const row = page.locator("#roll-call-list > ul > li").first();
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
        await offlineCopySaved(page);
        await page
          .getByRole("link", { name: "After dive 1" })
          .evaluate((link: HTMLElement) => link.click());
        await page.waitForURL(/checkpoint=after_dive_1/);
        // `manifestRow` anchors on the row's own summary — the name column the
        // person's panel opens from. A bare `hasText` also matches whichever
        // *other* row carries the name in a printed buddy label, which is what
        // the old `<h3>` anchor was guarding against before the name became the
        // row's own summary.
        const tomRow = manifestRow(page, "Tom Okafor");
        const lenaRow = manifestRow(page, "Lena Fischer");
        const boardTom = tomRow.getByRole("button", { name: "Mark boarded" });
        await boardTom.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await boardTom.click();
        await openManifestPerson(lenaRow);
        const lenaNotBack = page
          .getByRole("dialog")
          .getByRole("button", { name: "Mark not back aboard" });
        await lenaNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
        await lenaNotBack.click();
        await expect(
          page.getByRole("dialog").getByRole("button", { name: "Not back aboard", exact: true }),
        ).toBeVisible();
        // Closed again: this capture is about what the list says, not what a
        // panel holds — that is `manifest-person-panel`'s job.
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Close person details" })
          .click();
        await expect(tomRow.getByText("Lena not back aboard")).toBeVisible();
        await page.mouse.move(0, 0);
        await capture(page, "manifest-buddy-divergence", scheme);
      });

      /**
       * The buddy-teams panel itself — the team builder (ADR
       * 20260804-buddy-teams). Worth its own capture because it is where the
       * model became visible: a team of any size, a crew member marked as crew
       * on the divemaster-led trio, per-member removal, and a checkbox builder
       * in place of the two dropdowns that could only ever express a pair. The
       * whole panel is `print:hidden`, so no other capture covers it.
       */
      test(`the manifest's buddy-team builder renders true to the design (${scheme})`, async ({
        page,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await openReefTrip(page);
        await openTripTab(page, "Manifest");
        const panel = page.locator("section", {
          has: page.getByRole("heading", { name: "Buddy teams" }),
        });
        // The panel rests collapsed behind its summary line — the capture is
        // of the panel itself, so open it the way a staffer would.
        await page.getByRole("heading", { name: "Buddy teams" }).click();
        await expect(panel.getByText("Keiko Tanaka (crew)")).toBeVisible();
        await panel.scrollIntoViewIfNeeded();
        await capture(page, "manifest-buddy-teams-panel", scheme);
      });

      // H-08: a site deeper than a diver's certification trains for. Warning
      // tone and *outside* the red blocker list, because it never blocks — an
      // instructor may be keeping that diver shallower on purpose. Nothing in
      // the seed reaches this state (every seeded site sits within its divers'
      // ceilings), so the depth is raised for the capture.
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
        await page.getByRole("link", { name: "Molasses Reef" }).first().click();
        await page.waitForURL(/\/dive-sites\//);
        await page.getByLabel(/Maximum depth/).fill("105");
        await page.getByRole("button", { name: "Save dive site" }).click();
        await page.getByText("Dive site saved.").waitFor();

        await openReefTrip(page);
        await openTripTab(page, "Trip");
        await page
          .getByText(/deeper than the/)
          .first()
          .waitFor();
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
        const row = page.locator("#roster li").filter({ visible: true }).first();
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
        await page.getByText("Private note deleted.").waitFor();
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
       * The seeded scenarios come from `src/db/seed-cert-gates.ts`, whose whole
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
        await page.getByRole("button", { name: "Add Diego Alvarez to the trip" }).click();
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
        await page.getByRole("button", { name: "Add Odile Marchand to the trip" }).click();
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
        await page.goto(`/shop/blue-mantis/trips/${tripId}`);
        await openTripAbout(page);
        await page
          .locator("details#requirements")
          .getByText(/never blocks? enrollment/)
          .first()
          .waitFor();
        await capture(page, "trip-manage-course-requirements", scheme);
      });

      // The shop's own dive-site library, which had no baseline at all until
      // it gained a search band and a pager. One grouped ledger since ADR
      // 20260827-the-shops-shelves — difficulty groups easiest first, the
      // requirement words on the rows that carry one, and the DiveDay catalog
      // as the quiet door at its tail.
      test(`the dive-site library renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/dive-sites");
        await waitForSiteLibrary(page);
        // Leaflet measures pan progress with Date; let its animation clock
        // advance from the harness instant while this case changes map sizes.
        await page.clock.install({ time: E2E_FROZEN_CLOCK });
        await capture(page, "dive-sites-library", scheme);

        // Use a real standalone pin from this viewport; a cluster's count
        // does not identify which named sites it contains.
        await page.locator(".leaflet-container").scrollIntoViewIfNeeded();
        const firstPin = page.locator(".leaflet-site-marker button").first();
        await expect(firstPin).toBeVisible();
        const pinName = await firstPin.getAttribute("aria-label");
        if (!pinName) throw new Error("Site marker has no accessible name");
        const mapPin = page
          .locator(".leaflet-site-marker")
          .getByRole("button", { name: pinName, exact: true });
        await expect(mapPin).toBeVisible();
        await mapPin.hover();
        await expect(page.locator(".leaflet-site-tooltip")).toContainText(pinName);
        const pinBox = await mapPin.boundingBox();
        const mapBox = await page.locator(".leaflet-container").boundingBox();
        const viewport = page.viewportSize();
        if (!pinBox || !mapBox || !viewport) throw new Error("Map target has no viewport bounds");
        expect(pinBox.x).toBeGreaterThanOrEqual(Math.max(0, mapBox.x));
        expect(pinBox.y).toBeGreaterThanOrEqual(Math.max(0, mapBox.y));
        expect(pinBox.x + pinBox.width).toBeLessThanOrEqual(
          Math.min(viewport.width, mapBox.x + mapBox.width),
        );
        expect(pinBox.y + pinBox.height).toBeLessThanOrEqual(
          Math.min(viewport.height, mapBox.y + mapBox.height),
        );
        const scrollBeforePinSelection = await page.evaluate(() => window.scrollY);
        // The target is fully visible; use physical input so this assertion
        // measures selection without the driver's ancestor-scroll preparation.
        await page.mouse.click(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2);
        await expect(mapPin).toHaveClass(/ring-4/);
        const selectedPopup = page
          .locator(".leaflet-site-popup")
          .filter({ has: page.getByRole("heading", { name: pinName, exact: true }) })
          .last();
        await expect(selectedPopup).toBeVisible();
        expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforePinSelection);
        await capture(page, "dive-sites-library-pin-selected", scheme, {
          beforeShot: async () => {
            const footer = selectedPopup.locator(".leaflet-site-card__link");
            await expect
              .poll(async () => (await footer.boundingBox())?.height ?? 0)
              .toBeGreaterThanOrEqual(44);
            await selectedPopup.locator(".leaflet-popup-close-button").focus();
            await page.keyboard.press("Shift+Tab");
            await expect(footer).toBeFocused();
            expect(
              await footer.evaluate((link) => {
                const style = getComputedStyle(link);
                return link.matches(":focus-visible") && Number.parseFloat(style.outlineWidth) > 0;
              }),
            ).toBe(true);
            await expect
              .poll(async () => {
                const card = await selectedPopup.boundingBox();
                const map = await page.locator(".leaflet-container").boundingBox();
                if (!card || !map) return Number.NEGATIVE_INFINITY;
                return Math.min(
                  card.x - map.x,
                  card.y - map.y,
                  map.x + map.width - card.x - card.width,
                  map.y + map.height - card.y - card.height,
                );
              })
              .toBeGreaterThanOrEqual(0);
          },
        });
      });

      // The gear register on a calm morning (ADR 20260827-the-shops-shelves,
      // slice 9d): the kind chips, one "On the wall" group of hairline rows
      // carrying their reserved-for and service sentences, the register's own
      // coral line — nothing is out — and the add-a-unit form. The three stat
      // tiles and the Returns panel that used to sit above this are gone; the
      // groups are the states now.
      test(`the gear register renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        // The last seeded tank's row — the ledger below the fold has settled.
        await page.getByRole("link", { name: "AL63-02" }).waitFor();
        await capture(page, "gear-register", scheme);
      });

      // The bench on an ordinary Monday (ADR 20261008-gear-work-orders): the
      // Gear section's two tabs, the open statuses in counter order with
      // their late and ready badges, and the collected tail under them.
      test(`the work-order board renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page.getByRole("heading", { level: 1, name: "Work orders" }).waitFor();
        // The last seeded group's row — the board below the fold has settled.
        await page
          .getByRole("link", { name: /Battery hatch leaked/ })
          .first()
          .waitFor();
        await capture(page, "work-order-board", scheme);
      });

      // One ticket, whole: the moves, the job, the pieces, the Work done
      // form, the parts and labor with their running total, and the
      // history. The seeded in-progress ticket is the one carrying all of
      // them at once.
      test(`a work order renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Breathes wet at depth/ })
          .first()
          .click();
        await page.getByRole("heading", { level: 2, name: "Parts and labor" }).waitFor();
        await capture(page, "work-order-ticket", scheme);
      });

      // A collected ticket: no moves left, and the Work done record read
      // back (how the job ended, each check, the next due date it set).
      test(`a collected work order renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Battery hatch leaked/ })
          .first()
          .click();
        await page.getByRole("heading", { level: 2, name: "Work done" }).waitFor();
        await capture(page, "work-order-ticket-collected", scheme);
      });

      // The shop's own unit on the bench: off the wall while it is here, and
      // the Work done form carrying the unit's own interval forward.
      test(`a work order on a shop unit renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Second stage free-flows on the surface/ })
          .first()
          .click();
        await page.getByRole("heading", { level: 2, name: "Work done" }).waitFor();
        await capture(page, "work-order-ticket-unit", scheme);
      });

      // Opening a ticket, with the diver chosen: the pieces of theirs on file
      // as the checklist of what came in, and the job block under it.
      test(`the new work-order form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders/new?diverq=Diego+Alvarez");
        await page.getByRole("link", { name: "Diego Alvarez" }).first().click();
        await page.getByRole("heading", { level: 2, name: "The job" }).waitFor();
        await capture(page, "work-order-new", scheme);
      });

      // The claim tag as it prints: what we have, what you told us, and when
      // to come back — no total and nothing to sign (the rental slip's
      // posture, ADR 20261008-gear-work-orders).
      test(`a work order's claim tag renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Breathes wet at depth/ })
          .first()
          .click();
        await page.getByRole("link", { name: "Print claim tag" }).click();
        await page.getByRole("heading", { level: 2, name: "What we have" }).waitFor();
        await capture(page, "work-order-claim-tag", scheme);
      });

      // What the customer hears and what they owe (ADR
      // 20261008-work-order-follow-up), on a shop that can take money: the
      // ready message still to come and the bill's own button. The calm
      // ticket capture above shows the unconnected shape ("collected at the
      // counter"); this is the other one.
      test(`a work order's bill renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-stripe-account");
        await page.goto("/shop/blue-mantis/gear/work-orders");
        await page
          .getByRole("link", { name: /Inflator sticks open/ })
          .first()
          .click();
        await page.getByRole("button", { name: "Send the bill" }).waitFor();
        await capture(page, "work-order-bill", scheme);
      });

      // The bench running behind, on Today: a ticket past its promised day and
      // one ready for a week that nobody has collected, through the opt-in
      // `?bench=1` trouble state (never seeded into blue-mantis).
      test(`Today asks about the bench (${scheme})`, async ({ page, request }) => {
        await request.post("/api/test/seed-trouble-states?bench=1");
        await page.goto("/shop/blue-mantis");
        await page.getByRole("listitem").filter({ hasText: "not ready yet." }).first().waitFor();
        await page
          .getByRole("listitem")
          .filter({ hasText: "and not collected." })
          .first()
          .waitFor();
        await capture(page, "today-bench", scheme);
      });

      // One unit's record — chosen for the tank whose seeded visual
      // inspection lands inside the due-soon window, so the clock grammar
      // (amber state line + per-clock list) is in frame alongside the
      // service log form and history.
      test(`a gear unit's record renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("link", { name: "AL80-03" }).click();
        await page.getByRole("heading", { level: 1, name: "AL80-03" }).waitFor();
        await capture(page, "gear-unit", scheme);
      });

      // **A unit already on the bench that came home with a concern** (issue
      // #2570, #2540): the status card names the return and its words. Reg #4
      // is the demo's benched regulator; the opt-in `?gearConcern=1` state
      // gives it a rental that came home yesterday, never seeded standing.
      test(`a benched unit's record names the concern it came home with (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?gearConcern=1");
        expect(seeded.ok()).toBe(true);
        const { gearConcern } = (await seeded.json()) as {
          gearConcern?: { gearItemId: string; label: string };
        };
        if (!gearConcern)
          throw new Error("seed-trouble-states could not return Reg #4 with a concern");
        await page.goto(`/shop/blue-mantis/gear/${gearConcern.gearItemId}`);
        await page.getByRole("heading", { level: 1, name: gearConcern.label }).waitFor();
        await page.getByText(/^Returned .+ with a concern: /).waitFor();
        await capture(page, "gear-unit-concern", scheme);
      });

      // Renting gear out at the counter (ADR 20260815-minimal-gear-register,
      // amended 2026-10-08; redrawn 2026-10-09): the person chosen, today's
      // window, the free units of one kind as tiles, the bill with its total,
      // and how they pay. Priya has signed nothing, so the person step also
      // holds the unsigned waiver line and its Send waiver (issue #2346).
      test(`the rent-out form renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/rentals/new?q=Priya");
        await page.getByRole("link", { name: "Rent to Priya Sharma" }).click();
        await page.getByRole("group", { name: "Kind of gear" }).waitFor();
        // Two picks and a payment, so the bill, its total and the bar are in frame.
        for (const [kind, label] of [
          ["Mask", /^Mask #1\b/],
          ["Fins", /^Fins #1\b/],
        ] as const) {
          await page
            .getByRole("group", { name: "Kind of gear" })
            .getByRole("button", { name: new RegExp(`^${kind}\\b`) })
            .click();
          await page.getByRole("button", { name: label }).click();
        }
        await page.getByRole("button", { name: "Remove Fins #1" }).waitFor();
        await page.getByRole("radio", { name: /^Cash/ }).check();
        await capture(page, "counter-rental-form", scheme);
        // The bar at the foot, which a full-page capture cannot paint where it
        // stands: how many items and how much, beside Rent out.
        await captureStickyFoot(page, "counter-rental-form-foot", scheme);
      });

      // The ticket the person walks off with: who, the tags, the back-by
      // date, and on screen the acts. Rented here rather than seeded so the
      // capture is the ticket a counter lands on, notice and all. Priya has
      // signed nothing at blue-mantis, so the frame also holds the unsigned
      // waiver line and its Send waiver (issue #2261, H-108).
      test(`a counter rental's ticket renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear/rentals/new?q=Priya");
        await page.getByRole("link", { name: "Rent to Priya Sharma" }).click();
        for (const [kind, label] of [
          ["Mask", /^Mask #1\b/],
          ["Fins", /^Fins #1\b/],
        ] as const) {
          await page
            .getByRole("group", { name: "Kind of gear" })
            .getByRole("button", { name: new RegExp(`^${kind}\\b`) })
            .click();
          await page.getByRole("button", { name: label }).click();
        }
        await page.getByRole("button", { name: "Remove Fins #1" }).waitFor();
        await page.getByRole("radio", { name: /^Cash/ }).check();
        await page.getByRole("button", { name: "Rent out", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "Payment recorded." }).waitFor();
        await page.getByRole("button", { name: "Hand over" }).waitFor();
        await page.getByText("Waiver: Not signed").waitFor();
        await capture(page, "counter-rental-ticket", scheme);
      });

      // The way back to a deleted unit (ADR 20260820-every-delete-is-soft):
      // the Deleted chip in the filter band, and the list whose one act is
      // Restore. Photographed after deleting a unit rather than seeding one —
      // the shop's demo fleet is what a shop should see, and a permanently
      // deleted regulator in it would be a worse demo.
      test(`the gear register's deleted units render true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("link", { name: "Reg #5", exact: true }).click();
        await page.getByRole("heading", { level: 1, name: "Reg #5" }).waitFor();
        await page.getByRole("button", { name: "Delete unit" }).click();
        await page.getByRole("status").filter({ hasText: "Unit deleted." }).waitFor();

        await page.goto("/shop/blue-mantis/gear?view=deleted");
        await page.getByRole("button", { name: "Restore Reg #5" }).waitFor();
        await capture(page, "gear-register-deleted", scheme);
      });

      // The same unit's own record while it is deleted (issue #614): the
      // Deleted badge in the header, the service clocks and the unfolded
      // paper trail that are the reason the row survived the delete, and a
      // page carrying no control but Restore. The read-only shape is what
      // this watches — a write form creeping back in is invisible in a diff
      // of the page, which branches in five places.
      test(`a deleted unit's record renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("link", { name: "Reg #5", exact: true }).click();
        await page.getByRole("heading", { level: 1, name: "Reg #5" }).waitFor();
        const record = page.url();
        await page.getByRole("button", { name: "Delete unit" }).click();
        await page.getByRole("status").filter({ hasText: "Unit deleted." }).waitFor();

        await page.goto(record);
        await page.getByRole("button", { name: "Restore unit" }).waitFor();
        await capture(page, "gear-unit-deleted", scheme);
      });

      // The register on a working morning, through /api/test/seed-trouble-states
      // (never seeded into blue-mantis, whose whole fleet is calm): all three
      // of the register's groups in one frame — a unit out with a diver and due
      // back today at a named time, a checked-out unit gone overdue carrying
      // the warning word and its drawn mark, and the wall beneath them with a
      // lapsed tank inspection in its service sentence. `?gearOut=1` is opt-in
      // because a unit due back today is also a row on Today (ADR
      // 20260827-the-shops-shelves, slice 9d).
      test(`the gear register's out and overdue groups render true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?gearOut=1");
        await page.goto("/shop/blue-mantis/gear");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        // Both group headings, so the capture can never land on a half-built
        // ledger — and the wall's own rows are what the `AL63-02` wait below
        // proves have arrived.
        await page.getByRole("heading", { level: 2, name: /^Out/ }).waitFor();
        await page.getByRole("heading", { level: 2, name: /^Overdue/ }).waitFor();
        await page.getByRole("link", { name: "AL63-02" }).waitFor();
        await capture(page, "gear-register-trouble", scheme);
      });

      // The register's fleet-wide service reading (ADR 20260827-the-shops-shelves,
      // slice 9d as amended after review): the one question the three groups
      // do not answer, reached from the band's own chip. Two shapes in one
      // frame off the calm demo fleet — Reg #4 pulled off the wall and leading
      // because it is stopped now, and AL80-03's visual inspection three weeks
      // out, which is the month-ahead heads-up Today's six-day queue never
      // mentions. No trouble seed: this is a shop having an ordinary week.
      test(`the register's service-due view renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/gear?view=service");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        // The last row of the list, so the capture cannot land half-built.
        await page.getByRole("link", { name: "AL80-03" }).waitFor();
        await capture(page, "gear-register-service-due", scheme);
      });

      // **Who has the shop's gear** (plan `rental-tracking`, layer 2): the
      // register's Rentals view, every open rental under the person holding
      // it. Through the trouble seed with `?gearOut=1`, so one frame holds the
      // three things the view says: a set gone overdue leading the page, one
      // of its units dragged onto today and saying its own state beside its
      // tag, and a set still reserved for the wreck trip below it.
      test(`the register's rentals view renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-trouble-states?gearOut=1");
        await page.goto("/shop/blue-mantis/gear?view=rentals");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        const rentals = page.getByRole("region", { name: "Rentals" });
        // Both sets, so the capture cannot land on half a list.
        await rentals.getByRole("link", { name: "BCD #2" }).waitFor();
        await rentals.getByRole("link", { name: "BCD #5" }).waitFor();
        await capture(page, "gear-register-rentals", scheme);
      });

      // **A counter rental out to someone with no waiver on file** (issue
      // #2570, #2261): the Rentals list's "Waiver: …" word in the warning ink.
      // The opt-in `?rentalWaiverWarning=1` state lends Mask #1 to a new person.
      test(`the rentals view warns about a holder's waiver (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post(
          "/api/test/seed-trouble-states?gearOut=1&rentalWaiverWarning=1",
        );
        expect(seeded.ok()).toBe(true);
        await page.goto("/shop/blue-mantis/gear?view=rentals");
        await page.getByRole("heading", { level: 1, name: "Gear" }).waitFor();
        const rentals = page.getByRole("region", { name: "Rentals" });
        await rentals.getByRole("link", { name: "Mask #1" }).waitFor();
        await rentals
          .getByText(/^Waiver: /)
          .first()
          .waitFor();
        await capture(page, "gear-register-rentals-waiver", scheme);
      });

      // The front desk's invoice builder. It redirects to Divers for a shop
      // that can't take money, so mark the demo shop connected first:
      // /api/test/seed-stripe-account is a pure DB write that never calls
      // Stripe (same use as the recap tip section above), and no order is
      // created here — this is the empty form, which is the whole surface.
      // Its own test also keeps that connected-shop write off every other
      // capture: a connected shop changes what several staff surfaces render.
      test(`the invoice builder renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        await request.post("/api/test/seed-stripe-account");
        await page.goto("/shop/blue-mantis/orders/new");
        await page.getByRole("heading", { level: 1, name: "New order" }).waitFor();
        await capture(page, "orders-new", scheme);
      });

      // DiveDay's published dive-site templates, in the same ledger grammar as
      // the library they feed (ADR 20260827-the-shops-shelves): the row is the
      // preview door, Import is its one act. It is the
      // library's own catalog *view* rather than a route of its own
      // (ADR 20260806-dive-site-catalog-is-a-view), so this navigates through
      // the redirect the old URL still serves and keeps the
      // `dive-sites-catalog` capture name.
      test(`the dive-site catalog renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/dive-sites/catalog");
        await page.getByRole("heading", { level: 1, name: "DiveDay common dive sites" }).waitFor();
        await waitForSiteMap(page);
        await capture(page, "dive-sites-catalog", scheme);
      });

      /**
       * The staff command palette and the app's not-found backstop — surfaces
       * that are *states*, not routes, and so had no baseline at all.
       *
       * The palette is hosted on `/settings/calendar` rather than Today. It is
       * `position: fixed`, and a `fullPage` shot renders a fixed element once,
       * at the top, above however much page happens to sit underneath — so
       * hosting it on the tall dashboard would bank a baseline that re-diffs
       * every time Today's queue changes, for a change that has nothing to do
       * with the overlay. The calendar settings page is the shortest read-only
       * staff surface there is (two panels, no seeded rows, nothing minted
       * until a button is pressed), so almost all of the image is the overlay
       * itself.
       *
       * It closes its overlay before finishing: an overlay left open leaks
       * into whatever the same page does next.
       */
      // The command palette on open, with no query typed: a Client Component,
      // so wait for the control it only renders once mounted *and* focused
      // rather than for anything the server rendered. An empty query lists
      // every "Go to" destination the registry offers this role — no search
      // request, nothing debounced, nothing that could land differently
      // between runs.
      test(`the command palette renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        // The keypress is lost if it lands before the palette's listener is
        // attached; the fixture's `goto` waits for its trigger to say it is
        // (issue #2366, `settleStaffHydration` in e2e/fixtures.ts).
        await page.keyboard.press("ControlOrMeta+k");
        const box = page.getByRole("combobox", { name: /Search divers/ });
        await expect(box).toBeFocused();
        await capture(page, "command-palette", scheme);
        await page.keyboard.press("Escape");
        await expect(box).toBeHidden();
      });

      // The same panel with results in it, which is the half no baseline had:
      // searched groups draw their own glyph in the same rail as the "Go to"
      // rows (issue #773), and only a query shows them. Waits for a real
      // option rather than for the request — the input is debounced, so the
      // rendered row is the only honest signal that the answer landed.
      test(`the command palette with results renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        await page.getByRole("button", { name: "Create subscription link" }).first().waitFor();
        // The keypress is lost if it lands before the palette's listener is
        // attached; the fixture's `goto` waits for its trigger to say it is
        // (issue #2366, `settleStaffHydration` in e2e/fixtures.ts).
        await page.keyboard.press("ControlOrMeta+k");
        const box = page.getByRole("combobox", { name: /Search divers/ });
        await expect(box).toBeFocused();
        await box.fill("reef");
        await expect(page.getByRole("option", { name: /Reef/ }).first()).toBeVisible();
        await capture(page, "command-palette-results", scheme);
        await page.keyboard.press("Escape");
        await expect(box).toBeHidden();
      });

      test(`the command palette with a failed search renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/calendar");
        await page.route("**/api/search?q=zz-unavailable", (route) =>
          route.fulfill({ status: 503, body: "" }),
        );
        await page.keyboard.press("ControlOrMeta+k");
        await page.getByRole("combobox", { name: /Search divers/ }).fill("zz-unavailable");
        await expect(
          page.getByRole("button", { name: staffCopy("shared.commandPalette.retry"), exact: true }),
        ).toBeVisible();
        await capture(page, "command-palette-search-failed", scheme);
      });

      // The app-wide `notFound()` backstop (src/app/not-found.tsx) — a stale
      // email link or a typo'd URL. Captured under a staff session because
      // that is who reaches it on a `/shop` URL; signed out the same address
      // is an auth redirect, never this page.
      test(`the not-found page renders true to the design (${scheme})`, async ({ page }) => {
        await page.goto("/shop/blue-mantis/no-such-page");
        await page.getByRole("heading", { level: 1, name: "We couldn’t find that page" }).waitFor();
        await capture(page, "not-found", scheme);
      });

      /**
       * **Four dense surfaces, read in Spanish** (issues #1681, #2407).
       *
       * Every other capture in this file signs in with an English reader, so no
       * baseline had ever seen an `es-ES` string in a layout — in a product
       * whose Spanish is systematically longer and whose word choices are
       * recorded and guarded (`src/i18n/locales/es-ES/README.md`). What no
       * check held was whether the chosen word *fits*.
       *
       * Four, not everything: the surfaces where length is most likely to
       * break something are the dense fixed-width ones, and these are the four
       * reviews have pointed at. Each costs four screenshots and a triage
       * burden on every future pull request, which is why the set is named here
       * rather than derived.
       *
       * One block, because `test.use` is describe-scoped — so these sit
       * together instead of beside their English siblings, which is the one
       * place this file's "one surface, one test" layout bends.
       *
       * The phone width is the one that matters. Every finding these are here
       * to catch is a string that fits at 1280 and does not at 390.
       */
      test.describe("read in Spanish", () => {
        test.use({ locale: SPANISH });

        /**
         * **The missing-divers grid, whose chips are 80px wide.**
         *
         * The question that raised the issue: a blocked diver's chip carries
         * the offline page's qualified readiness word — "Blocked when saved",
         * which was measured and accepted at two wrapped lines — and the
         * Spanish is "Bloqueado cuando se guardó", four words and none of them
         * short, in a tile a fixed 80px wide (`w-20`). The chip **wraps** rather than
         * truncating, on purpose (`MissingDiversGrid.tsx`: a clipped
         * "Blocked wh…" says less than the bare word it replaced), so the cost
         * lands as tile height inside a `flex-wrap` row.
         *
         * This is the baseline that lets that be looked at rather than argued
         * about. It is also the only one of the three whose Spanish does not
         * come from a request at all: this view renders offline from IndexedDB
         * and reads `navigator.language`.
         */
        test(`the offline roll call reads in Spanish (${scheme})`, async ({ page }) => {
          // Board → trip → Manifest, then the saved copy. By URL, which is
          // also what `openTripTab` does now that the departure has no tab
          // strip; spelling it here keeps the flow readable as a URL walk.
          test.setTimeout(FLOW_TIMEOUT_MS);
          await openReefTrip(page);
          await page.goto(`${new URL(page.url()).pathname}/manifest`);
          await settleOfflineShellWorker(page);
          await openOnThisPhone(page);
          await page.getByRole("link", { name: "Abrir pase de lista sin conexión" }).click();
          await page.waitForURL(/offline-manifest/);
          await expect(page.getByRole("heading", { name: "Priya Sharma" })).toBeVisible();
          // The grid itself, by its own heading — the roster above it renders
          // first, so a wait on a diver's name is not a wait on this.
          await expect(
            page.getByRole("heading", { name: /^Pendientes de embarcar/ }),
          ).toBeVisible();
          await capture(page, "offline-manifest-roll-call", scheme, { locale: SPANISH });
        });

        /**
         * **The manifest's checkpoint track**, whose tabs carry a checkpoint
         * name and a state word in a row that has to stay one line: "Punto de
         * control activo" against "Active checkpoint", and "No embarcado"
         * against "Not boarded" on every row's control.
         */
        test(`a trip's manifest reads in Spanish (${scheme})`, async ({ page }) => {
          await openReefTrip(page);
          await page.goto(`${new URL(page.url()).pathname}/manifest`);
          await page.getByRole("heading", { level: 1, name: /Two-Tank Reef/ }).waitFor();
          // The same background save the English sibling waits out, in this
          // reader's words: `offlineCopySaved` matches "(Fresh|Aging|Stale)
          // copy" and would wait forever here. These are the manifest
          // manager's own words (`trips.offlineManifestManager.freshness*`),
          // which is what this page renders — not the offline viewer's "Copia
          // reciente / antigua / caducada" (`shared.offlineManifest.
          // freshnessPill.*`), a different surface saying the same thing at a
          // different URL.
          await expect(
            page.getByText(/Copia (actualizada|envejeciendo|desactualizada)/),
          ).toBeVisible();
          // The track, not the page: it is what this capture is for, and the
          // heading above it is true before the checkpoints render.
          await expect(page.getByText("Punto de control activo").first()).toBeVisible();
          await capture(page, "manifest", scheme, { locale: SPANISH });
        });

        /**
         * **The after-dive buddy alert, in Spanish** (#2407). "Compañero sin
         * regresar a bordo" was measured by hand at about 229px against the
         * roughly 246px capsule line a phone gives it; this is the baseline
         * that holds it there. The same state as the English
         * `manifest-buddy-divergence`: Tom aboard, his teammate Lena recorded
         * not back.
         */
        test(`the manifest's split buddy team reads in Spanish (${scheme})`, async ({ page }) => {
          test.setTimeout(FLOW_TIMEOUT_MS);
          await openReefTrip(page);
          await page.goto(`${new URL(page.url()).pathname}/manifest`);
          await expect(
            page.getByText(/Copia (actualizada|envejeciendo|desactualizada)/),
          ).toBeVisible();
          await page
            .getByRole("link", { name: "Después de la inmersión 1" })
            .evaluate((link: HTMLElement) => link.click());
          await page.waitForURL(/checkpoint=after_dive_1/);
          const tomRow = manifestRow(page, "Tom Okafor");
          const lenaRow = manifestRow(page, "Lena Fischer");
          const boardTom = tomRow.getByRole("button", { name: "Marcar embarcado" });
          await boardTom.evaluate((button) => button.scrollIntoView({ block: "center" }));
          await boardTom.click();
          await openManifestPerson(lenaRow);
          const dialog = page.getByRole("dialog");
          const lenaNotBack = dialog.getByRole("button", { name: "Marcar sin regresar a bordo" });
          await lenaNotBack.evaluate((button) => button.scrollIntoView({ block: "center" }));
          await lenaNotBack.click();
          await expect(
            dialog.getByRole("button", { name: "Sin regresar a bordo", exact: true }),
          ).toBeVisible();
          await dialog.getByRole("button", { name: "Cerrar detalles de la persona" }).click();
          await expect(tomRow.getByText("Lena sin regresar a bordo")).toBeVisible();
          await page.mouse.move(0, 0);
          await capture(page, "manifest-buddy-divergence", scheme, { locale: SPANISH });
        });

        /**
         * **The staffing week's gap chips**, two words in English ("No
         * divemaster") and two in Spanish ("Sin divemaster") inside a day
         * cell whose width is a seventh of the grid.
         *
         * Through the same trouble-states route its English sibling uses: a
         * demo shop permanently short-handed is a worse demo.
         */
        test(`the staffing week's crew gap reads in Spanish (${scheme})`, async ({
          page,
          request,
        }) => {
          await request.post("/api/test/seed-trouble-states?crewGap=1");
          await page.goto("/shop/blue-mantis/staffing");
          await page.getByText("Sin divemaster").first().waitFor();
          await capture(page, "staffing-week-gap", scheme, { locale: SPANISH });
        });
      });
    });
  });
}

/**
 * The capture harness's own escape hatch, exercised on purpose.
 *
 * `withRendererBound` exists for a stall that has never reproduced outside CI,
 * so without this nothing in any run ever takes the branch — the degrade could
 * rot into a `throw`, or the probe into a hang, and the first anyone would know
 * is the next red shard, which is precisely the failure it was written to
 * prevent. Shoots nothing, so it costs the baseline nothing.
 */
test.describe("capture harness", () => {
  test.describe("lazy site maps", () => {
    signedInAsOwner();
    // The actual lazy-library request must reach Playwright's route handler.
    test.use({ serviceWorkers: "block" });

    for (const surface of [
      {
        name: "catalog",
        path: "/shop/blue-mantis/dive-sites?view=catalog",
        heading: "DiveDay common dive sites",
        pins: DIVE_SITE_TEMPLATES.filter(
          ({ briefing }) => briefing.forecastLatitude != null && briefing.forecastLongitude != null,
        ).length,
        ready: waitForSiteMap,
      },
      {
        name: "library",
        path: "/shop/blue-mantis/dive-sites",
        heading: "Dive-site library",
        pins: 8,
        ready: waitForSiteLibrary,
      },
    ]) {
      test(`${surface.name} capture waits for Leaflet after its content is visible`, async ({
        page,
      }) => {
        let releaseLeaflet = () => {};
        let libraryHeld = false;
        let mapReady: Promise<void> | undefined;
        const release = new Promise<void>((resolve) => {
          releaseLeaflet = resolve;
        });
        // Discover the emitted library before navigation, then hold its real
        // request before delivery rather than inspecting a fetched response.
        const libraryChunks = new Set(
          readdirSync(".next/static/chunks", { recursive: true, encoding: "utf8" })
            .filter(
              (file) =>
                file.endsWith(".js") &&
                readFileSync(`.next/static/chunks/${file}`, "utf8").includes(
                  "https://leafletjs.com",
                ),
            )
            .map((file) => `/_next/static/chunks/${file.replaceAll("\\", "/")}`),
        );
        expect(
          libraryChunks.size,
          "The production build contains the Leaflet library",
        ).toBeGreaterThan(0);
        await page.route(
          (url) => libraryChunks.has(url.pathname),
          async (route) => {
            libraryHeld = true;
            await release;
            await route.continue();
          },
        );
        const contentReady = async () => {
          await page.getByRole("heading", { level: 1, name: surface.heading }).waitFor();
          if (surface.name === "library") {
            await page.getByRole("link", { name: "Molasses Reef", exact: true }).waitFor();
            await page.getByRole("link", { name: "Browse the DiveDay catalog" }).waitFor();
          }
        };
        try {
          // A held script also holds load; the fixture still settles React
          // hydration after DOM content arrives, before interaction.
          await page.goto(surface.path, { waitUntil: "domcontentloaded" });
          await expect.poll(() => libraryHeld).toBe(true);
          await contentReady();
          await expect(page.locator(".leaflet-control-zoom-in")).toHaveCount(0);
          let ready = false;
          mapReady = surface.ready(page).then(() => {
            ready = true;
          });
          // Join the original promise in finally, including the failure path.
          void mapReady.catch(() => undefined);
          // Content can settle independently; capture readiness must remain
          // held by Leaflet rather than returning with the visible ledger.
          await contentReady();
          expect(ready).toBe(false);
          releaseLeaflet();
          await mapReady;
          await expect
            .poll(async () => {
              const pinCount = await page.locator(".leaflet-site-marker button").count();
              const clusterCounts = await page
                .locator("button.leaflet-site-cluster")
                .allTextContents();
              return pinCount + clusterCounts.reduce((total, count) => total + Number(count), 0);
            })
            .toBe(surface.pins);
          await expect(page.locator(".leaflet-control-zoom-in")).toBeVisible();
          await expect(page.locator(".leaflet-control-attribution")).toBeVisible();
        } finally {
          releaseLeaflet();
          await mapReady;
        }
      });
    }
  });

  test("a pass that never settles is bounded, reported, and degraded", async ({ page }) => {
    await page.goto("/");
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (message: string) => {
      warnings.push(message);
    };
    let degraded: number;
    try {
      degraded = await withRendererBound(
        page,
        "a wait that never settles",
        1_000,
        // Never resolves — and is still pending when the test ends, which is
        // the other half of what this proves: `withRendererBound` must absorb
        // the rejection Playwright raises when it tears the context down,
        // rather than leaking it into whichever test runs next.
        //
        // The resolver is rooted on `globalThis` so V8 cannot collect the
        // promise. A `new Promise(() => {})` whose resolvers are referenced
        // nowhere is unreachable the moment it is created, and when Chromium
        // collects it Playwright rejects the evaluate with "Resulting promise
        // was garbage collected" — which `withRendererBound` then rethrows,
        // correctly, since a pass that *throws* is a broken page and must not
        // be swallowed. That made this test a race between GC and the 1s
        // budget, red whenever GC won. Rooting the resolver keeps it genuinely
        // pending, which is what the test means by "never settles"; nothing
        // ever calls it.
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              (globalThis as { __neverSettles?: (value: number) => void }).__neverSettles = resolve;
            }),
        ),
        -1,
      );
    } finally {
      console.warn = realWarn;
    }
    expect(degraded).toBe(-1);
    const reported = warnings.join("\n");
    expect(reported).toContain("did not return within 1000ms");
    // This page is perfectly healthy — only the promise above never settled —
    // so the probe has to be able to say so. A wedged renderer is the *other*
    // sentence, and telling them apart is the whole point of asking.
    expect(reported).toContain("the page is alive");
  });

  /**
   * **The guard for issues #1245 and #1276** — the 608px flap at 390 and the
   * mid-fade colour step at 1280, which the measurements on both tickets
   * resolved to one `::details-content` transition.
   *
   * Two things are asserted, because two different mistakes each reintroduce
   * the bug and only one of them is visible in a diff:
   *
   * 1. **`getAnimations()` cannot see this transition.** That is why
   *    `screenshotOrGiveUp`'s `animations: "disabled"` — which drives exactly
   *    that list — was in place throughout and never helped. Pinned here so a
   *    future reader deleting `withTransitionsOff` in favour of "Playwright
   *    already disables animations" is told why that is false before they find
   *    out from a flaky baseline.
   * 2. **The switch-off actually reaches the pseudo-element**, and holds the
   *    document at one height across the resize. `*, *::before, *::after` does
   *    not match `::details-content`, so the explicit selector is load-bearing
   *    and silently droppable.
   *
   * Priya's record rather than a built one: `seed-diver-trail.ts` gives her the
   * file groups whose bodies are what the `40rem` rule lays out, and a seeded
   * diver costs no form-filling. The frame samples need no timeout — 25 frames
   * outlast a 200ms transition on any renderer that is drawing at all, and a
   * renderer that is not drawing produces no samples and fails on the count.
   */
  test.describe("the disclosure transition, which no screenshot may catch running", () => {
    signedInAsOwner();
    test.use({ viewport: { width: 1280, height: 800 } });

    const heightsAcrossResize = (page: Page) =>
      page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const heights: number[] = [];
            const tick = () => {
              heights.push(document.documentElement.scrollHeight);
              if (heights.length < 25) requestAnimationFrame(tick);
              else resolve(heights);
            };
            requestAnimationFrame(tick);
          }),
      );

    test("is invisible to getAnimations(), so only the switch-off settles it", async ({ page }) => {
      await openDiverProfile(page, "Priya", "Priya Sharma");
      await page.getByRole("region", { name: "The story" }).waitFor();

      // Crossing 40rem downward is what starts it — the same resize `capture()`
      // performs on its first viewport.
      await page.setViewportSize({ width: 390, height: 844 });
      const running = await page.evaluate(() =>
        document.getAnimations().map((animation) => animation.constructor.name),
      );
      expect(
        running.filter((name) => name === "CSSTransition"),
        "a CSSTransition is running at the moment `capture()` resizes, and there are two " +
          "readings. Either Chromium has started listing ::details-content transitions, in " +
          'which case Playwright\'s animations: "disabled" may now settle this on its own — ' +
          "re-measure before trusting it, and keep the switch-off until it does. Or something " +
          "*else* on this page transitions across a breakpoint, which is its own capture bug: " +
          "a screenshot taken during that fade catches the property half-applied. Print the " +
          "animations' transitionProperty and target to tell them apart — on 2026-09-20 it was " +
          "the header search button's four border-color longhands, from a `sm:border` meeting " +
          "a `transition-colors` that covered it",
      ).toEqual([]);
    });

    test("holds the document at one height when the switch-off is installed", async ({ page }) => {
      await openDiverProfile(page, "Priya", "Priya Sharma");
      await page.getByRole("region", { name: "The story" }).waitFor();

      const settled = await withTransitionsOff(page, async () => {
        // Read the pseudo-element directly: the universal selector does not
        // reach it, so this is the assertion that the explicit entry in
        // CAPTURE_TRANSITIONS_OFF is doing the work.
        const duration = await page.evaluate(() => {
          const disclosure = document.querySelector("details");
          return disclosure
            ? getComputedStyle(disclosure, "::details-content").transitionDuration
            : "no disclosure on the page — this guard needs one";
        });
        expect(duration.split(", ")).not.toContain("0.2s");

        await page.setViewportSize({ width: 390, height: 844 });
        return heightsAcrossResize(page);
      });

      expect(settled).toHaveLength(25);
      // One height for the whole window. Measured without the switch-off on the
      // same record, this reports two heights ~677px apart, held for the first
      // thirteen frames — the flap #1245 measured as 608px before the page grew.
      expect(new Set(settled).size).toBe(1);
    });
  });

  test("a pass that fails still throws, rather than degrading silently", async ({ page }) => {
    await page.goto("/");
    await expect(
      withRendererBound(
        page,
        "a wait that throws",
        10_000,
        page.evaluate(() => {
          throw new Error("boom");
        }),
        "degraded",
      ),
    ).rejects.toThrow("boom");
  });
});

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
    // **The packet marks its chrome, and paper honours the mark.** This used to
    // count the two tab strips the composed surfaces brought with them; slice
    // 23c deleted the strip (ADR 20260919-one-idea), and what is left to keep
    // off paper is each composed header's way back up plus the rental-ticket
    // door on an assigned gear row — a count the seed decides, so the rule is
    // the assertion rather than a number that drifts with the fixture.
    //
    // A CSS locator, deliberately: `getByRole` reads the accessibility tree,
    // `display:none` is not in it, and a role locator here finds nothing and
    // passes for the wrong reason.
    const chrome = page.locator('a[class*="print:hidden"]');
    await expect(chrome).not.toHaveCount(0);
    for (const link of await chrome.all()) await expect(link).not.toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await capturePrint(page, "trip-packet");
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
    await page.getByRole("heading", { name: "New here? Scan this." }).waitFor();
    await capturePrint(page, "paper-counter-card");
  });
});

/**
 * **The emergency card with nothing in it.**
 *
 * The one panel on a safety surface that renders *because* the shop has not
 * answered a question — a red-bordered prompt where five phone numbers should
 * be, read by a crew at the rail. Every other capture in this file sees the
 * seeded shop, which fills the field in deliberately ("an unseeded shop would
 * photograph its own empty state on every capture of that page", `seed.ts`),
 * so this state had never been looked at and the settings capture above
 * claimed, wrongly, that it had been.
 *
 * A private shop, because clearing the reference is shop-wide configuration —
 * the reset restores the schedule, not the settings, so doing this to
 * blue-mantis would hand a blank emergency card to whichever spec ran next in
 * this worker (ADR 20260815-per-test-private-shops).
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — the unanswered emergency reference`, () => {
    // **A pinned identity, or this capture is noise.** The minted shop's name
    // renders in the staff header and its slug-derived owner email in the dev
    // banner, and `generateDemoShopIdentity` draws both at random — so without
    // this the capture reported as changed on the very next pull request,
    // "Verdant Trench Dive Co" against "Verdant Lagoon Dive Center", with
    // nothing about the page itself different. Masking those two lines is the
    // other way out and the repo refuses it: a masked capture cannot catch what
    // it covers.
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "harbour-lantern-dive-co",
    });

    /**
     * **The one first-run question a trading shop can still have open.**
     *
     * A minted shop is the only fixture that can honestly show this: it has a
     * board and has never answered the units question, which is exactly the
     * shape issue #835 is about. The canonical demo finishes its onboarding in
     * the seed, so it has no row — and arranging one on it would not work
     * anyway, because `/api/test/reset` restores the schedule and **not** the
     * `shops` columns, so a nulled `units_confirmed_at` would follow the worker
     * into every later test in the run. A test that writes shop-wide settings
     * takes a shop of its own (AGENTS.md); this one does not have to write
     * anything at all.
     */
    test(`the queue still asks an unanswered setup question (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // The home itself, and nothing to open. The question is bound to no
      // departure, and it ranks in Today's one "Needs you" list, which
      // the spine renders unfolded — where the old `?view=urgency` queue put it
      // inside a "This week" band a reader had to expand. That queue is gone
      // (ADR 20260827-clearwater-surface-language), `?view=` 308s here, and
      // "This week" is a folded disclosure beside Tomorrow.
      await page.goto(`/shop/${privateShop.slug}`);
      // The row's own words, not a timing guess.
      await page.getByText(/picked for where you are/).waitFor();
      await capture(page, "today-units-unconfirmed", scheme);
    });

    /**
     * **A dive site with the shop's own planning note on it** (issue #1204),
     * in the editor that writes it and on the library row that carries it.
     *
     * Its own shop: the note is written onto a dive-site row, and
     * `/api/test/reset` restores the schedule rather than the library.
     */
    test(`a dive site's planning note renders true to the design (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/shop/${privateShop.slug}/dive-sites`);
      await page.getByRole("heading", { level: 1, name: "Dive-site library" }).waitFor();
      await page.getByRole("link", { name: "Molasses Reef", exact: true }).first().click();
      await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
      await page
        .getByLabel("What to remember about running this site")
        .fill("The entry silted up after the storm. Brief the swim-through before you go in.");
      await page.getByRole("button", { name: "Save dive site" }).click();
      // **Wait for the save's own redirect, not for the text we just typed.**
      // The frame worth keeping is one navigation on from the form — the note
      // in the list a shop plans against — and the assertion that used to
      // stand here read the field back for the value it had been filled with a
      // line earlier. It therefore passed instantly, whether or not the write
      // had landed, and the `goto` below tore the page down with the action
      // still in flight: the trace shows the POST to the site page ending at
      // status -1, and the library rendering the row without a note. This is
      // the `action-race` shape `.claude/rules/e2e.md` names, wearing an
      // `expect` that satisfies `check:e2e-hygiene` while waiting for nothing.
      // `?notice=saved` is written by `revalidateAndRedirect` only once the row
      // is durably saved.
      await page.waitForURL(/[?&]notice=saved/);
      await page.goto(`/shop/${privateShop.slug}/dive-sites`);
      await page.getByText("The entry silted up after the storm").waitFor();
      await capture(page, "dive-site-planning-note", scheme);
    });

    /**
     * **The shore contact's address, refused without its consent** (H-118).
     * An address DiveDay sends to saves only with the box that records the
     * shore contact agreed; this is the refusal a staff member meets when
     * they type one and leave the box clear, on the page they were editing.
     * A shop of its own, because a saved address would follow the worker. Its
     * descriptions carry the review's words: confirmed by a link first, and
     * (a minted shop being a demo shop) that demo shops send nothing.
     */
    test(`the emergency reference refuses a shore address without consent (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      test.setTimeout(FLOW_TIMEOUT_MS);
      await page.goto(`/shop/${privateShop.slug}/settings/emergency-reference`);
      await page.locator("#emergency-alerts summary").click();
      await page.getByLabel("Shore contact’s email for roll-call alerts").fill("shore@example.com");
      await page.getByRole("button", { name: "Save emergency reference" }).click();
      await page.getByText(staffCopy("settings.main.notice.shoreAlertConsentMissing")).waitFor();
      await capture(page, "settings-emergency-shore-consent-missing", scheme);
    });

    /**
     * **The one state on this page where an absence *is* the information**
     * (issue #1363), photographed on both surfaces that render it.
     *
     * The staffed capture is read by a manager at a desk, who can go and fix
     * it. The offline one is read by a divemaster at the rail from cache, with
     * no signal and usually no permission to open Settings at all — which is
     * why the string underneath stopped handing them an errand. Neither frame
     * existed before, and the populated card sits inside
     * `offline-manifest-roll-call` already, so this is the half that was
     * photographed nowhere.
     *
     * One test, not two: clearing the reference through the shop's own form is
     * the expensive half, and the offline snapshot is primed from the staff
     * manifest *after* the clear has landed, so the copy the shell reads back
     * carries it.
     */
    test(`the manifest prompts for an emergency reference nobody filled in (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // Settings → clear → manifest → the saved copy, in one flow.
      test.setTimeout(FLOW_TIMEOUT_MS);
      await page.goto(`/shop/${privateShop.slug}/settings/emergency-reference`);
      await page
        .getByRole("button", { name: staffCopy("settings.main.emergency.submit") })
        .waitFor();
      // A private shop may start with no contacts. Open and clear only
      // existing rows; the next unused slot is already empty.
      const contactSummaries = page.locator(
        'details[id^="emergency-contact-"]:not(#emergency-contact-new) > summary',
      );
      const contactCount = await contactSummaries.count();
      for (let index = 0; index < contactCount; index += 1) {
        await contactSummaries.nth(index).click();
      }
      for (const id of ["emergency-response", "emergency-alerts"]) {
        const editor = page.locator(`#${id}`);
        if ((await editor.getAttribute("open")) === null) await editor.locator("summary").click();
      }
      const alertAddress = page.locator('input[name="shoreAlertEmail"]');
      const hadAlertAddress = (await alertAddress.inputValue()).trim().length > 0;
      // Clear through the shop's form whether the reference started empty
      // or populated, including any independently configured alert address.
      const fields = page
        .locator(
          'input[name^="emergencyLabel-"], input[name^="emergencyPhone-"], ' +
            'input[name="emergencyVessel"], input[name="emergencyShoreContact"], ' +
            'input[name="shoreAlertEmail"]',
        )
        .filter({ visible: true });
      await expect(fields).not.toHaveCount(0);
      for (const field of await fields.all()) await field.fill("");
      await page
        .getByRole("checkbox", { name: staffCopy("settings.main.emergency.shoreAlertConsent") })
        .uncheck();
      await page.locator('textarea[name="emergencyPlan"]').fill("");
      await page.getByRole("button", { name: "Save emergency reference" }).click();
      // Observe the completed save before the manifest/offline empty-state
      // assertions. Clearing an address has its own saved outcome.
      await page
        .getByText(
          staffCopy(
            hadAlertAddress
              ? "settings.main.notice.shoreAlertCleared"
              : "settings.main.notice.emergencySaved",
          ),
        )
        .waitFor();

      await page.goto(`/shop/${privateShop.slug}/schedule/board`);
      await openTripFromBoard(page, REEF_TRIP);
      await openTripTab(page, "Manifest");
      await page
        .getByRole("button", { name: "Emergency numbers & response plan" })
        .filter({ visible: true })
        .click();
      // The line itself, not just the heading — the whole point of the
      // capture is the state where there is nothing under it.
      await page.getByText("No emergency numbers recorded").waitFor();
      await capture(page, "manifest-emergency-empty", scheme);

      // The same absence, on the copy the boat falls back to. Straight to the
      // route with the trip's own id rather than through the manifest's "On
      // this phone" group: the capture above has already resized this page
      // through three viewports, and the disclosure does not reopen reliably
      // afterwards. `offlineCopySaved` is the honest precondition either way —
      // it waits on the freshness pill, which is the summary line's own report
      // that a copy exists.
      await settleOfflineShellWorker(page);
      await offlineCopySaved(page);
      const tripId = new URL(page.url()).pathname.match(/\/trips\/([^/?]+)/)?.[1];
      await page.goto(`/offline-manifest?trip=${tripId}`);
      // The empty state's own words, not a timeout: the snapshot is primed in the
      // background from the staff manifest, and if it had been written before
      // the clear landed this frame would photograph a *populated* card under
      // an "empty" name. Waiting on the rendered text makes that loud.
      await page.getByText("No emergency numbers recorded").waitFor();
      await capture(page, "offline-manifest-emergency-empty", scheme);
    });

    /**
     * **A shop with no packages on sale** (issue #2418): the page answers with
     * an empty state and a door back to the schedule rather than a 404. Photographed
     * before the capture below adds one, so the same minted shop shows both.
     */
    test(`the public packages page with nothing on sale renders true to the design (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/s/${privateShop.slug}/packages`);
      await page.getByRole("heading", { name: "No packages right now" }).waitFor();
      await capture(page, "public-packages-empty", scheme);
    });

    /**
     * **The packages a diver can buy online** (owner decision 2026-10-09).
     * Its own shop: a package is shop configuration, which `/api/test/reset`
     * leaves standing, so writing one into blue-mantis would follow the worker
     * into every later capture of that shop's public pages — the new Packages
     * tab included.
     */
    test(`the public packages page renders true to the design (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/shop/${privateShop.slug}/promos/packages`);
      await page.locator("#package-new summary").click();
      await page.getByLabel("What you call it").fill("Ten-dive card");
      await page.getByLabel("Dives included").fill("10");
      await page.getByLabel("Price").fill("450");
      await page.getByRole("button", { name: "Add package" }).click();
      await page.getByText("Package added.").waitFor();
      await page.goto(`/s/${privateShop.slug}/packages`);
      await page.getByRole("heading", { level: 1, name: "Dive packages" }).waitFor();
      await page.getByRole("button", { name: "Buy for $450" }).waitFor();
      await capture(page, "public-packages", scheme);
    });
  });
}

/**
 * **A shop that doesn't fill nitrox.**
 *
 * With the catalog off and no live request left on the departure, Total and Air
 * collapse into a single tile — there is nothing for a second number to
 * distinguish. The reef charter is the fixture that can show it: unlike the
 * wreck charter it never had a nitrox request seeded onto it, so turning the
 * catalog off leaves no live data to keep the tile alive (the same premise
 * `e2e/nitrox.spec.ts` asserts on).
 *
 * **A shop of its own, because this writes shop-wide configuration.**
 * `shops.rental_items` is not restored by the per-test reset — it puts back
 * three `shops` columns and no others — so this used to bracket the capture in
 * a `try/finally` that turned blue-mantis's catalog back on. That is the shape
 * AGENTS.md and ADR 20260815-per-test-private-shops refuse, and on 2026-08-23
 * it failed exactly as predicted: the capture hit the known unattributed
 * Chromium wedge, both paint waits and the screenshot burned the test's
 * ceiling, and the timeout landed on the **first line of the `finally`** — so
 * the revert never ran and blue-mantis was left not filling nitrox for every
 * later test in that worker. A `finally` is not isolation: it competes for the
 * same clock as the failure it is there for, and it does not run at all when
 * the worker dies. `e2e/nitrox.spec.ts` moved off this pattern for the same
 * reason; this capture was the one site left on it, and its comment still
 * pointed at that file as the precedent.
 *
 * The wedge itself is unchanged and unfixed by this — a wedged renderer still
 * fails the test, and ci.yml's visual job still reruns the failed captures once
 * on the probe's "wedged, not slow" verdict. What changes is the blast radius:
 * the failure now costs one capture instead of quietly re-premising the rest of
 * the shard.
 *
 * **A pinned identity**, for the same reason `manifest-emergency-empty` has
 * one: the minted shop's name renders in the staff header and its slug-derived
 * owner email in the dev banner, and `generateDemoShopIdentity` draws both at
 * random — so an unpinned capture reports as changed on the very next pull
 * request with nothing about the page itself different.
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — a shop that stops filling nitrox`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "slack-tide-dive-charters",
    });

    test(`the prep page's tank tile collapses with nitrox off (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // The mint and the live sign-in the fixture pays for, then one settings
      // round-trip and board → trip → Prep before the capture.
      test.setTimeout(FLOW_TIMEOUT_MS);
      await page.goto(`/shop/${privateShop.slug}/settings/rentals`);
      await page.getByRole("checkbox", { name: "Nitrox fills" }).uncheck();
      await page.getByRole("button", { name: "Save rentals" }).click();
      // The page comes back with its saved notice — the destination's own
      // render, not a timing guess.
      await page.getByText("Rentals saved.").waitFor();

      await page.goto(`/shop/${privateShop.slug}/schedule/board`);
      await openTripFromBoard(page, REEF_TRIP);
      await openTripTab(page, "Prep");
      await page.getByRole("heading", { name: "Tanks" }).waitFor();
      await capture(page, "prep-no-nitrox", scheme);
    });
  });
}

/**
 * **The shop profile row with a logo and a cover photo on file** (the K-247
 * follow-up and the K-13 review): the logo in the square the storefront crops
 * it to, its tick on the tile's corner and its caption under it; the cover
 * photo in a gallery cell; the two photo pickers; and the badges' fieldset
 * with its hint.
 *
 * No other capture opens this row, and no seeded shop has a logo. Blue Mantis
 * has a cover photo and badges but no logo, and giving it one would put a logo
 * in the header of every staff capture. So this takes a shop of its own,
 * minted in Blue Mantis's brand plus a logo (`privateShopBrand`). It writes
 * nothing: the shop is only the fixture that can hold a logo.
 *
 * **A pinned identity**, for the same reason `manifest-emergency-empty` has
 * one: the minted shop's name renders in the staff header and its slug-derived
 * owner email in the dev banner.
 */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode — the shop profile with a logo on file`, () => {
    test.use({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "reef-light-divers",
      privateShopBrand: true,
    });

    test(`the profile row's stored photos and pickers render true to the design (${scheme})`, async ({
      page,
      privateShop,
    }) => {
      // A page of its own since #1854.
      await page.goto(`/shop/${privateShop.slug}/settings/profile`);
      await page.getByRole("button", { name: "Save profile" }).waitFor();
      // The stored photos' own boxes: a mint that lost its brand fails here,
      // rather than photographing the empty row under this name.
      await page.getByRole("checkbox", { name: "Remove current logo" }).waitFor();
      await page.getByRole("checkbox", { name: "Remove the cover photo" }).waitFor();
      await capture(page, "settings-profile", scheme);
    });
  });
}
