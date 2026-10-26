/**
 * Visual captures: the diver's booking: confirmation, the readiness thread, bearer links and the party pages.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { expect, makeActivitySafe, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  choosePartySize,
  createTrip,
  daysFromNow,
  e2eNow,
  openRosterDetails,
  openThreadStep,
  openTripAbout,
  openTripAboutRow,
  publicTripUrl,
  saveDiveIntent,
  seededTripId,
  signInAsOwner,
  signOut,
  threadStatus,
} from "./helpers";
import {
  bookAVisualRegressionSeat,
  capture,
  diverCopy,
  EASING_BACK_TRIP,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  publicReefCard,
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

    test.describe("public", () => {
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
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
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

      if (scheme === "light") {
        test("the thread names its assigned helper at readable size (light)", async ({ page }) => {
          // Real booking, request, staff assignment and completion, then both viewport captures.
          test.setTimeout(FLOW_TIMEOUT_MS);
          const name = "Visual Regression Diver";
          await bookAVisualRegressionSeat(page, "light");
          const readyPath = new URL(page.url()).pathname;
          await openThreadStep(page, "dayof");
          await page.getByRole("radio", { name: diverCopy("ready.helpCarryGear") }).check();
          await page.getByRole("button", { name: diverCopy("ready.dayOfSave") }).click();
          await expect(
            page.getByRole("status").filter({ hasText: diverCopy("ready.dayOfSaved") }),
          ).toBeVisible();

          await signInAsOwner(page);
          await page.goto("/shop/blue-mantis");
          const row = page
            .getByRole("listitem")
            .filter({ hasText: name })
            .filter({
              has: page.getByText(staffCopy("today.actionKind.helpRequest"), { exact: true }),
            });
          await row
            .getByRole("button", { name: staffCopy("today.helpRequest.arrangeHelp") })
            .click();
          const crew = row.getByLabel(staffCopy("today.helpRequest.crewSelector"));
          const helperName = "Keiko Tanaka";
          await expect(crew.locator("option").filter({ hasText: helperName })).toHaveText(
            helperName,
          );
          await crew.selectOption({ label: helperName });
          await row
            .getByRole("button", { name: staffCopy("today.helpRequest.confirmHelper") })
            .click();
          await expect(
            row.getByRole("button", { name: staffCopy("today.helpRequest.markHandled") }),
          ).toBeVisible();
          await signOut(page);
          await page.goto(readyPath);
          await openThreadStep(page, "dayof");
          const promise = page.getByText(`${helperName} will help you`, { exact: false });
          const readableHelper = async () => {
            await expect(promise).toBeVisible();
            expect(
              await promise.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
            ).toBeGreaterThanOrEqual(16);
          };
          await capture(page, "thread-named-helper", "light", { beforeScreenshot: readableHelper });

          await signInAsOwner(page);
          await page.goto("/shop/blue-mantis");
          await row
            .getByRole("button", { name: staffCopy("today.helpRequest.markHandled") })
            .click();
          await expect(
            page.getByText(staffCopy("today.helpRequest.completed"), { exact: true }),
          ).toBeVisible();
          await signOut(page);
          await page.goto(readyPath);
          await openThreadStep(page, "dayof");
          await capture(page, "thread-completed-helper", "light", {
            beforeScreenshot: async () => {
              // A handled request names nobody: the helper may have left the boat.
              await expect(promise).toHaveCount(0);
              const status = page.getByText(diverCopy("ready.helpHandled"), { exact: true });
              await expect(status).toBeVisible();
              expect(
                await status.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize)),
              ).toBeGreaterThanOrEqual(16);
            },
          });
        });
      }

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
        await page.getByRole("heading", { name: /This link no longer works/ }).waitFor();
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
       * the way to the schedule, a short list of the preparation that
       * survived (those records are filed against the person and the shop, not
       * the seat, so they are still there), and one boat to ask to move to.
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
          await staff.getByRole("heading", { level: 1, name: "Cancellation record" }).waitFor();
        } finally {
          await staffContext.close();
        }

        await page.goto(threadUrl);
        await page.getByRole("heading", { level: 1, name: "This trip was canceled" }).waitFor();
        await page.getByText("Still on file for you").waitFor();
        // The boat it offers (UX sheet 2026-10-22, item 5): the demo runs
        // another reef boat at the charter's price or less with seats free.
        await page.getByRole("button", { name: /^Ask to move to / }).waitFor();
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
        if (scheme === "light") await capture(page, "seat-claim-sent", scheme);
        await page.goto(claimPath ?? "/");
        await page.getByRole("heading", { name: /This link no longer works/ }).waitFor();
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
          await openTripAboutRow(staff, "Who can book");
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
        const receipt = page.locator("#move-ask");
        await expect(
          receipt.getByText(diverCopy("ready.moveAsk.asked", { shop: "Blue Mantis Divers" })),
        ).toBeVisible();
        await expect(receipt.getByText("Any Saturday in August", { exact: true })).toBeVisible();
        await expect(receipt.getByText(diverCopy("ready.moveAsk.bookingUnchanged"))).toBeVisible();
        await expect(receipt.locator("time")).toHaveAttribute("datetime", e2eNow().toISOString());
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
    });
  });
}
