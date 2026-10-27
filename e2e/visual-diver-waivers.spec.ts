/**
 * Visual captures: the diver's release, the doctor's page and the guardian's half.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { RSTC_QUESTIONNAIRE } from "../src/lib/medical";
import { expect, makeActivitySafe, test } from "./fixtures";
import {
  daysFromNow,
  openDiverFileGroup,
  openFirstRosterRowWith,
  waiverLinkFromResult,
  waiverLinkFromToast,
} from "./helpers";
import {
  capture,
  capturePrint,
  diverCopy,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  REEF_TRIP,
  SURFACE_TIMEOUT_MS,
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
         * 3 of 4 with Release, Medical and the shop's Questions settled and Sign still open, the
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
        await page.getByTestId("waiver-step-rail").getByText("3 of 4 done").waitFor();
        await capture(page, "waiver-rail", scheme);

        /**
         * The same page one honest answer later. "I am over 45 years of age" is
         * the most ordinary yes on a dive boat and it puts Box B's four
         * required questions on the page: the Box's own rule beside the
         * questions it opened, the outcome line saying they are still to
         * answer, and the rail dropping back to 1 of 4 because the medical step
         * is open again. Every capture before this one answers "No" to
         * everything, so no Box had ever been photographed (2026-08-28 review).
         */
        await page
          .getByRole("group", { name: /I am over 45 years of age/ })
          .getByRole("radio", { name: "Yes" })
          .check();
        await page.getByTestId("waiver-step-rail").getByText("1 of 4 done").waitFor();
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
        await expect(page.getByText(diverCopy("waiver.medicalReferralNext"))).toBeVisible();
        await capture(page, "waiver-medical-held", scheme);

        await page.getByRole("link", { name: "Take this to your doctor" }).click();
        await page.getByTestId("doctor-evaluation-form").waitFor();
        await page.mouse.move(0, 0);
        await expect(
          page.getByRole("link", { name: diverCopy("waiver.doctor.formLink") }),
        ).toHaveAttribute("href", RSTC_QUESTIONNAIRE.published.url);
        await expect(
          page.getByRole("button", { name: diverCopy("waiver.doctor.print") }),
        ).toBeVisible();
        await capture(page, "waiver-doctor", scheme);
        if (scheme === "light") {
          await page.setViewportSize({ width: 816, height: 1056 });
          await capturePrint(page, "waiver-doctor-evaluation");
        }
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
    });
  });
}
