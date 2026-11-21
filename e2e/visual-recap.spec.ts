/**
 * Visual captures: the post-trip recap.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import type { Page } from "@playwright/test";
import { AFTER_STATE_TEST_IDS } from "../src/app/(token)/ready/[token]/_components/after-state-test-ids";
import { DEMO_RECAP_BOOKING_ID } from "../src/db/seed/identifiers";
import { diverTranslator } from "../src/i18n/messages";
import { signRecapToken } from "../src/lib/recap-links";
import { expect, makeActivitySafe, test } from "./fixtures";
import { openSettingsRow } from "./helpers";
import { stabilizeRecapPhoto } from "./recap-photo-fixture";
import { seedFacts } from "./shop-facts";
import {
  capture,
  diverCopy,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  SPANISH,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

async function expectProfileLabelsInsideChart(page: Page, stopLabel: string) {
  const chart = page.getByTestId(AFTER_STATE_TEST_IDS.computerDives).locator("svg");
  await expect(chart).toHaveCount(1);
  await expect(chart.locator("text").filter({ hasText: stopLabel })).toHaveCount(1);
  const labels = await chart.locator("text").evaluateAll((elements) =>
    elements.map((element) => {
      const text = element as SVGTextElement;
      const bounds = text.getBBox();
      const viewport = text.ownerSVGElement?.viewBox.baseVal;
      if (!viewport) throw new Error("Profile label has no chart viewport");
      return {
        label: text.textContent,
        left: bounds.x,
        right: bounds.x + bounds.width,
        min: viewport.x,
        max: viewport.x + viewport.width,
      };
    }),
  );
  for (const label of labels) {
    expect(label.left, `${label.label} fits the chart's left edge`).toBeGreaterThanOrEqual(
      label.min,
    );
    expect(label.right, `${label.label} fits the chart's right edge`).toBeLessThanOrEqual(
      label.max,
    );
  }
}

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test.describe("public", () => {
      test.beforeEach(async ({ page }) => {
        await stabilizeRecapPhoto(page);
      });

      test.describe("Spanish personal recordings", () => {
        test.use({ locale: SPANISH });
        test("personal computer recordings remain separate and unlinked", async ({ page }) => {
          const t = diverTranslator(SPANISH);
          await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
          const recordings = page.getByTestId(AFTER_STATE_TEST_IDS.computerDives);
          await expect(recordings.getByText(t("recap.profile.unlinked"))).toBeVisible();
          await expect(
            page
              .getByTestId(AFTER_STATE_TEST_IDS.record)
              .getByTestId(AFTER_STATE_TEST_IDS.computerDives),
          ).toHaveCount(0);
          await capture(page, "recap", scheme, {
            locale: SPANISH,
            beforeScreenshot: () =>
              expectProfileLabelsInsideChart(page, t("recap.profile.stop", { minutes: 4 })),
          });
        });
      });
      /**
       * **The thread's after-state**, reached through the recap token: the same
       * surface `/ready` renders once the boat is home (ADR
       * 20260827-the-divers-thread, decision 4 — slice 7d folded `/recap` into
       * it), minted for the pinned demo booking (src/db/seed/index.ts) so the marquee
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
       * rather than a clause naming the shop (H-20260904-reef-go-all-way c), the record's footer
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
       * whether STRIPE_SECRET_KEY is set — so the `stripeAccount` fact
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
        await reviewSettingsPage.getByText("Review link saved").filter({ visible: true }).waitFor();
        await reviewSettingsContext.close();

        await seedFacts(request, ["stripeAccount"]);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
        await page.getByRole("heading", { name: /Welcome back/ }).waitFor();
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        await expect(
          page
            .getByTestId(AFTER_STATE_TEST_IDS.computerDives)
            .getByText(diverCopy("recap.profile.unlinked")),
        ).toBeVisible();
        // The tip door renders at all only for a shop that can take a tip, and
        // that is what the seed-stripe-account write above buys — so waiting on
        // it is what proves the whole run of doors is in the frame.
        await page.getByText("Tip the crew", { exact: true }).waitFor();
        await capture(page, "recap", scheme, {
          beforeScreenshot: () =>
            expectProfileLabelsInsideChart(page, diverCopy("recap.profile.stop", { minutes: 4 })),
        });
      });

      /**
       * **A one-tap thanks to the crew, waiting for the shop** (issue #4261).
       * The diver taps a crew member on the review form and adds a line; the
       * recap keeps the tapped pill, and the owner's review queue holds the
       * thanks under "Needs you" with Pass thanks on its row, because nothing
       * reaches the crew until staff pass it on. Written through the real
       * form on the worker's own database, which the next test's reset puts back.
       */
      test(`a thanks to the crew waits in the review queue (${scheme})`, async ({
        page,
        browser,
        workerBaseURL,
        staffStorageState,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
        const thanks = page.getByRole("group", { name: diverCopy("reviews.thanksLegend") });
        await thanks.getByRole("radio").first().check();
        await page
          .getByRole("textbox", { name: diverCopy("reviews.thanksLine") })
          .fill("Thanks for spotting the turtle");
        await page
          .getByRole("radio", { name: diverCopy("reviews.ratingOption", { rating: 5 }) })
          .check();
        await page.getByRole("button", { name: diverCopy("reviews.submit") }).click();
        await page.getByText(diverCopy("reviews.savedPublished")).first().waitFor();
        await capture(page, "recap-crew-thanks", scheme);

        const ownerContext = await browser.newContext({
          baseURL: workerBaseURL,
          storageState: await staffStorageState("owner"),
        });
        const ownerPage = makeActivitySafe(await ownerContext.newPage());
        await ownerPage.goto("/shop/blue-mantis/reviews");
        await ownerPage.getByRole("region", { name: /^Needs you/ }).waitFor();
        await ownerPage.getByRole("button", { name: "Pass thanks to the crew" }).first().waitFor();
        await capture(ownerPage, "staff-reviews-crew-thanks", scheme);
        await ownerContext.close();
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
        await seedFacts(request, ["changedDiveSite"]);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
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
        await seedFacts(request, ["observedSpecies"]);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        // Waiting on the line itself, not on the page: photographing the calm
        // variant twice is the failure this exists to avoid.
        await page.getByTestId(AFTER_STATE_TEST_IDS.seen).filter({ visible: true }).waitFor();
        await capture(page, "recap-seen-on-the-day", scheme);
      });

      /**
       * **The sharer's own photo, shared with the boat** (H-20261014-share-photo-with-boat, issue #2806):
       * marked as shared, with "Stop sharing" under it. Through a test route
       * because an e2e build has no media store to upload to; the demo's own
       * recap stays the unshared one photographed above.
       */
      test(`a recap with a photo the diver shared renders true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await seedFacts(request, ["sharedRecapPhoto"]);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
        await page.getByRole("heading", { name: "Dive log entry" }).waitFor();
        await page
          .getByRole("button", { name: "Stop sharing" })
          .filter({ visible: true })
          .waitFor();
        await capture(page, "recap-shared-photo", scheme);
      });

      test(`the secondary demo diver can stop sharing a seeded recap photo (${scheme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        const { secondarySharedPhoto } = await seedFacts(request, ["secondarySharedPhoto"]);
        const { bookingId } = secondarySharedPhoto as { bookingId: string };
        expect(bookingId).not.toBe(DEMO_RECAP_BOOKING_ID);
        await page.goto(`/recap/${signRecapToken(bookingId, 0)}`);
        await expect(page.getByRole("heading", { name: "Dive log entry" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Stop sharing" })).toBeVisible();
        await capture(page, "recap-secondary-demo-shared-photo", scheme);
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
        await seedFacts(request, ["certifiedRecap"]);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
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
        await seedFacts(request, ["diveTimes"]);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
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
       * Molasses and French both carry a seeded guide (`seed/dive-sites.ts`),
       * so no test route is needed — this is the demo shop's ordinary state.
       */
      test(`the recap's field guide renders true to the design (${scheme})`, async ({ page }) => {
        test.setTimeout(FLOW_TIMEOUT_MS);
        await page.goto(`/recap/${signRecapToken(DEMO_RECAP_BOOKING_ID, 0)}`);
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
    });
  });
}
