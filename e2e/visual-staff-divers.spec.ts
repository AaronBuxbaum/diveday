/**
 * Visual captures: the diver roster and a diver's record.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import { expect, signedInAsOwner, test } from "./fixtures";
import { openDiverFileGroup, openPaperWaiverForm, openTripFromBoard, openTripTab } from "./helpers";
import {
  capture,
  captureFolded,
  installVisualBuildGuard,
  openDiverProfile,
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

      test(`a card type check renders (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Priya", "Priya Sharma");
        await openDiverFileGroup(page, "Certification records");
        await page.getByText(staffCopy("divers.certifications.juniorCardChange")).first().click();
        await expect(
          page.getByLabel(staffCopy("divers.certifications.juniorCardSelect")).first(),
        ).toHaveValue("");
        await capture(page, "diver-card-type-check", scheme);
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

      test(`later departures stay open on the diver record (${scheme})`, async ({ page }) => {
        await openDiverProfile(page, "Priya", "Priya Sharma");
        await page
          .locator("summary", { hasText: staffCopy("divers.bookActivity.bookDeparture") })
          .click();
        await page
          .getByRole("link", { name: staffCopy("divers.bookActivity.laterDepartures") })
          .click();
        await page.waitForURL(/bookingPage=2/);
        await expect(
          page.getByRole("combobox", { name: staffCopy("divers.bookActivity.courseOrDiveLabel") }),
        ).toBeVisible();
        await page.getByRole("region", { name: "The story" }).waitFor();
        await capture(page, "diver-booking-later", scheme);
      });

      test(`a diver's agency verification targets render true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Mateo Duarte", "Mateo Duarte");
        await openDiverFileGroup(page, "Certification records");
        await page.getByRole("link", { name: "Check with SSI", exact: true }).waitFor();
        await capture(page, "diver-agency-verification-link", scheme);
        await page.evaluate(() => {
          document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
          window.dispatchEvent(new Event("diveday-cert-check-ready"));
        });
        await page.getByRole("button", { name: "Check with SSI", exact: true }).waitFor();
        await capture(page, "diver-agency-verification-action", scheme);
      });

      test(`the drysuit observation form keeps its input and action level (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Priya", "Priya Sharma");
        const gear = await openDiverFileGroup(page, "Gear and sizes");
        await gear.getByText("Edit", { exact: true }).click();
        await gear.getByRole("radio", { name: "Own drysuit", exact: true }).check();
        await gear.getByRole("button", { name: "Save rental fit" }).click();
        await page.getByText(staffCopy("divers.notices.profileSaved"), { exact: true }).waitFor();
        await gear.locator(":scope > summary").click();
        await openDiverFileGroup(page, "Certification records");
        await page.getByLabel("What you saw").fill("Own drysuit, three shore dives with us");
        await capture(page, "diver-drysuit-observation-form", scheme);
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
        await page.getByRole("region", { name: "Gear they own" }).waitFor();
        await openDiverFileGroup(page, "Gear they own");
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
        await Promise.all([
          page.waitForURL(/notice=diver-clear/),
          page.getByRole("button", { name: "Record paper signature" }).click(),
        ]);
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

      test(`additional duplicate candidates render true to the design (${scheme})`, async ({
        page,
        request,
      }) => {
        const seeded = await request.post("/api/test/seed-trouble-states?mergeCandidates=1");
        expect(seeded.ok()).toBe(true);
        const { mergeCandidates } = (await seeded.json()) as {
          mergeCandidates: { sourceId: string; candidateIds: string[] };
        };
        await page.goto(`/shop/blue-mantis/divers/${mergeCandidates.sourceId}`);
        const panel = page.locator("#merge");
        await expect(panel.getByRole("link", { name: /Compare with/ })).toHaveCount(5);
        await capture(page, "diver-profile-merge-more", scheme);
        await panel.getByRole("button", { name: staffCopy("divers.merge.showMore") }).click();
        await expect(panel.getByRole("link", { name: /Compare with/ })).toHaveCount(8);
        await expect(
          panel.getByRole("link", {
            name: staffCopy("divers.merge.compareWith", { name: "Mara Duplicate 06" }),
          }),
        ).toBeFocused();
        await page.mouse.move(0, 0);
        await capture(page, "diver-profile-merge-expanded", scheme);
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
        await page.getByText("Diver deleted").waitFor();
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
        await page.getByText("Diver deleted").waitFor();
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

      test(`a recorded paper release and its signature log render true to the design (${scheme})`, async ({
        page,
      }) => {
        await openDiverProfile(page, "Priya", "Priya Sharma");
        const personId = page.url().match(/\/divers\/([^/?#]+)/)?.[1];
        if (!personId) throw new Error("paper capture needs the diver identity");
        await openDiverFileGroup(page, "Waiver");
        await openPaperWaiverForm(page);
        await page
          .getByLabel("I have this diver’s signed release on file", { exact: false })
          .check();
        await Promise.all([
          page.waitForURL(/notice=waiver-paper-recorded/),
          page.getByRole("button", { name: "Record paper signature" }).click(),
        ]);
        const signed = page.locator(`a[href*="/divers/${personId}/waivers/"]`).first();
        await expect(signed).toBeVisible();
        const href = await signed.getAttribute("href");
        const recordId = href?.split("/").at(-1);
        if (!href || !recordId) throw new Error("paper capture needs the actual recorded release");
        await page.goto(href);
        await page.getByText(staffCopy("waiversStaff.record.paperEvidence")).waitFor();
        await capture(page, "signed-paper-waiver-record", scheme);
        await page.goto(`/shop/blue-mantis/waivers/signatures?record=${recordId}`);
        await page
          .locator(`#waiver-record-${recordId}`)
          .getByText(staffCopy("waiversStaff.signatures.paperRecorded"), { exact: true })
          .waitFor();
        await capture(page, "waiver-signatures-paper-record", scheme);
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
    });
  });
}
