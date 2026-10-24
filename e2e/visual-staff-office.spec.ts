/**
 * Visual captures: courses, reports, the waiver surface, reviews, date requests, the inbox and discount codes.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { expect, signedInAsOwner, test } from "./fixtures";
import { openRosterDetails, seededTripId } from "./helpers";
import { PAYMENT_HISTORY_CSV } from "./payment-history-fixture";
import {
  capture,
  captureStickyFoot,
  diverCopy,
  installVisualBuildGuard,
  REEF_TRIP,
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

      test(`course follow-up disclosures share the compact row grammar (${scheme})`, async ({
        page,
        request,
      }) => {
        // The existing recap fixture issues a real shop AOW card, and the
        // diver has not taken the next course, so the ladder's follow-up
        // disclosure is populated. The fleet's frozen July clock is before the
        // card-processing stamp's migration, so no card is set apart as
        // "certified before" it (`cardProcessingSince`, PR #2918 item 1d):
        // that disclosure is absent here, and its grammar is held by
        // CardsToProcess.test.tsx under a clock past the cut.
        const seeded = await request.post("/api/test/seed-certified-recap");
        expect(seeded.ok(), await seeded.text()).toBe(true);
        await page.goto("/shop/blue-mantis/courses");
        // The first ladder row: the demo now seeds two shop-certified cards
        // of its own (H-148), so "See who" is on more than one step.
        const people = page.getByText("See who", { exact: true }).first();
        await people.waitFor();
        await expect(page.locator("#cards-to-process-earlier")).toHaveCount(0);
        await capture(page, "course-follow-ups-closed", scheme);
        await people.click();
        await capture(page, "course-follow-ups-open", scheme);
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
        // The sections are client components; the hydration flag is what says
        // they have mounted (the rail that framed this composition is gone,
        // visual review 2026-10-24, A11).
        await page.locator('[data-hydrated="true"]:has([name="summary"])').waitFor();
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
        await page.locator('[data-hydrated="true"]:has([name="summary"])').waitFor();
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

      test(`imported payment history keeps its report review door visible (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/settings/import");
        await expect(page.locator('input[type="file"]:visible')).toHaveAttribute(
          "data-hydrated",
          "true",
        );
        await page.setInputFiles('input[type="file"]', {
          name: "payment-history.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(PAYMENT_HISTORY_CSV, "utf-8"),
        });
        await page.getByRole("button", { name: "Import 1 contact" }).click();
        await page
          .getByText(
            staffCopy("settings.import.wizard.result.paymentHistoryLineOther", { count: 2 }),
          )
          .waitFor();
        await page.goto("/shop/blue-mantis/reports?month=2026-03");
        await page.getByRole("region", { name: "Unverified imported history" }).waitFor();
        await capture(page, "reports-imported-history", scheme);
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
    });
  });
}

test.describe("light mode — course date requests without a shop email", () => {
  test.use({ colorScheme: "light", privateShopSlug: "course-date-requests-no-email" });

  test("a course with no sessions keeps its request form (light)", async ({
    page,
    privateShop,
  }) => {
    await page.goto(`/shop/${privateShop.slug}/settings#contact`);
    await page.getByLabel(staffCopy("settings.main.contact.emailLabel")).fill("");
    await page.getByLabel(staffCopy("settings.main.contact.phoneLabel")).fill("");
    await page.getByRole("button", { name: staffCopy("settings.main.contact.submit") }).click();
    await expect(
      page.getByText(staffCopy("settings.main.notice.contactSaved"), { exact: true }),
    ).toBeVisible();

    // PADI Rescue has a seeded session; this catalog-only course proves the empty state.
    await page.goto(`/s/${privateShop.slug}/courses/sdi-rescue-diver`);
    await expect(page.getByText(diverCopy("course.noDatesLead"), { exact: false })).toBeVisible();
    await expect(page.getByRole("region", { name: diverCopy("inquiry.getInTouch") })).toBeVisible();
    await capture(page, "course-request-no-email", "light");
  });
});
