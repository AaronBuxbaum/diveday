/**
 * Visual captures: the schedule: the walk-in and Add-booking forms, the board, the move and add panels, blow-outs.
 *
 * One of the per-feature `e2e/visual-*.spec.ts` files; the capture mechanics are
 * `e2e/visual-harness.ts`, and the procedure is the e2e-and-visual skill.
 */
import type { Page, Request, Route } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { weekStartOf } from "../src/lib/week-board";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  createTrip,
  daysFromNow,
  e2eNow,
  openCounterFor,
  openTripAbout,
  openTripAboutRow,
  openTripFromBoard,
  publicTripUrl,
  seededTripId,
  tripPathByTitle,
  walkInFormPath,
} from "./helpers";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  openReefTrip,
  REEF_TRIP,
  SURFACE_TIMEOUT_MS,
  staffCopy,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

/** Force the cookie-writing action refresh that previously erased Undo's result. */
async function undoWithSessionRefresh(page: Page) {
  const url = new URL(page.url());
  const heldId = url.searchParams.get("held");
  if (!heldId) throw new Error("The reschedule page has no held notice");
  const isUndo = (request: Request) =>
    request.method() === "POST" &&
    Boolean(request.headers()["next-action"]) &&
    new URL(request.url()).pathname === url.pathname &&
    Boolean(request.postData()?.includes(heldId));
  const scope = (requestUrl: URL) => requestUrl.pathname === url.pathname;
  let delivered!: (proof: { cookieRefresh: boolean; revalidated: boolean }) => void;
  let failed!: (error: unknown) => void;
  const completion = new Promise<{ cookieRefresh: boolean; revalidated: boolean }>(
    (resolve, reject) => {
      delivered = resolve;
      failed = reject;
    },
  );
  const omitCache = async (route: Route) => {
    if (!isUndo(route.request())) return route.continue();
    const headers = await route.request().allHeaders();
    // Target this action alone: concurrent preflight reads may refresh the
    // browser cookie, but must not consume this regression's cache miss.
    headers.cookie = (headers.cookie ?? "")
      .split(";")
      .filter((part) => part.trim().split("=")[0] !== "better-auth.session_data")
      .join(";");
    // Browser continue cannot override Cookie; the request API can. Fulfill
    // with the real action response so its cookie and RSC refresh reach React.
    try {
      const response = await route.fetch({
        headers,
        timeout: VISUAL_STEP_BOUNDS.actionTimeout,
        maxRedirects: 0,
      });
      const returned = response.headers();
      const proof = {
        cookieRefresh: Boolean(returned["set-cookie"]?.includes("session_data=")),
        revalidated: Boolean(returned["x-action-revalidated"]),
      };
      await route.fulfill({ response });
      delivered(proof);
    } catch (error) {
      failed(error);
      await route.abort();
    }
  };
  await page.route(scope, omitCache);
  try {
    await test.step(
      "Undo refreshes its session cookie",
      async () => {
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        expect(await completion).toEqual({ cookieRefresh: true, revalidated: true });
      },
      { timeout: VISUAL_STEP_BOUNDS.actionTimeout },
    );
  } finally {
    await page.unroute(scope, omitCache);
  }
}

async function expectSettledRescheduleNotice(page: Page) {
  const message = staffTranslator("en-US")("shared.rescheduleHold.notTold");
  const notice = page.getByRole("status").filter({ hasText: message });
  await expect(notice).toBeVisible();
  // The notice is mounted with `rise-in`; visible copy alone can match while
  // its opacity animation is still in flight. Capture only its settled state.
  await expect(notice).toHaveCSS("opacity", "1");
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    // Base viewport for navigation and clicks; `capture` resizes to each entry
    // in VIEWPORTS for the screenshots and restores this afterward.
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test.describe("staff", () => {
      signedInAsOwner();

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
        await openTripAboutRow(page, "Timing");
        await page.getByLabel("Departs").fill("13:45");
        await page.getByLabel("Returns").fill("17:15");
        await page.getByRole("button", { name: "Save changes" }).click();
        await page.getByText(staffTranslator("en-US")("shared.rescheduleHold.telling")).waitFor();
        await undoWithSessionRefresh(page);
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
        await page.getByText(staffTranslator("en-US")("shared.rescheduleHold.telling")).waitFor();
        await undoWithSessionRefresh(page);
        await expectSettledRescheduleNotice(page);
        await capture(page, "schedule-builder-reschedule-hold", scheme);
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
        await page.getByRole("heading", { name: "Log a call" }).waitFor();
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
        await page.getByRole("heading", { name: "New booking", level: 1 }).waitFor();
        // The day headings are the composition; wait for the first one rather
        // than for the h1, which paints with the static shell.
        await page.getByRole("heading", { level: 3 }).first().waitFor();
        await capture(page, "booking-new", scheme);
      });

      test(`the Add-booking diver step renders true to the design (${scheme})`, async ({
        page,
      }) => {
        await page.goto("/shop/blue-mantis/bookings/new");
        await page.getByRole("heading", { name: "New booking", level: 1 }).waitFor();
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
        await page.waitForURL(/\/schedule\/board\/new/);
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

      test(`the multi-day course shows its first-session time (${scheme})`, async ({ page }) => {
        const week = weekStartOf(daysFromNow(9));
        await page.goto(`/shop/blue-mantis/schedule/board?week=${week}`);
        await boardListSettled(page);
        const course = page
          .locator("[data-week-board]")
          .getByRole("link", { name: "Open Water Diver — three-day course", exact: true })
          .locator("..");
        await expect(course.getByText("8:00 AM", { exact: true })).toBeVisible();
        await expect(course.getByText("3 days", { exact: true })).toBeVisible();
        await capture(page, "schedule-multi-day-course-time", scheme);
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
       * A week off the current one, because that is where the seeded interests
       * are: `seed-date-requests.ts` places them twelve and thirteen days out,
       * and the week board is seven days wide. Addressed by `?week=` rather
       * than by clicking the pager twice — the pager has its own coverage, and
       * a capture that has to navigate first is a capture that can fail for a
       * reason that is not about pixels.
       */
      test(`the week draws the days somebody asked for (${scheme})`, async ({ page }) => {
        // Derived from the fleet's frozen clock rather than written down: the
        // seed places these interests twelve days out, so a literal date here
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
        await page.getByLabel("New departure time (America/New_York)").fill("11:30");
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

        await page.locator(`summary[aria-label="Details for ${mixedBoat.rider}"]`).click();
        await page.getByText("Coming as: Rider", { exact: true }).click();
        await page.locator('select[name="participantType"]:visible').waitFor();
        await capture(page, "trip-coming-as-editor", scheme);

        await page.goto(`/shop/blue-mantis/trips/${mixedBoat.tripId}?view=details`);
        await expect(page.locator("details#participant-terms")).toBeVisible();
        await capture(page, "trip-details-participant-terms", scheme);

        await page.goto(`/shop/blue-mantis/trips/${mixedBoat.tripId}/manifest`);
        await page.getByRole("heading", { name: "Roll call" }).waitFor();
        await expect(page.getByText(/1 snorkeler · 1 rider/).first()).toBeVisible();
        await capture(page, "manifest-participant-types", scheme);
        const dismiss = page.getByRole("button", {
          name: staffCopy("manifest.catchUp.dismiss"),
          exact: true,
        });
        await capture(page, "manifest-catchup-focused", scheme, {
          // Re-establish real keyboard focus after every resize/probe so the
          // full target's ring is photographed at both light widths.
          beforeShot: async () => {
            await dismiss.focus();
            await page.keyboard.press("Shift+Tab");
            await page.keyboard.press("Tab");
            await expect(dismiss).toBeFocused();
            expect(await dismiss.evaluate((button) => button.matches(":focus-visible"))).toBe(true);
          },
        });
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
        await page.goto("/shop/blue-mantis/schedule/board/new?add=full");
        await page.getByRole("heading", { name: "Add a departure", level: 1 }).waitFor();
        await page.getByRole("button", { name: "Fewer options" }).waitFor();
        await addPanelSettled(page);
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
        await page.goto("/shop/blue-mantis/schedule/board/new?add=full");
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
        await openTripAboutRow(page, "Repeats");
        await page.getByRole("group", { name: "Repeats on" }).waitFor();
        await capture(page, "trip-repeating-cadence", scheme);

        // And what a diver reads on the same departure: the header's run line,
        // "Runs every … · next …" (fourth UX review, item 35).
        await page.goto(publicTripUrl(page.url().split(/[?#]/)[0] ?? page.url()));
        await page.getByText(/^Runs every /).waitFor();
        await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
          "data-hydrated",
          "true",
        );
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
        await capture(page, "blowout-day-review", scheme, {
          beforeScreenshot: async () => {
            // The preceding capture can return from its initial-paint tab and
            // start a live staff-session recheck. Photograph the review only
            // after the server confirms it, not the temporary session cover.
            await expect(page.locator('[data-staff-session-check="settled"]')).toHaveCount(1);
            await expect(page.locator("[data-staff-session-lock]")).toHaveCount(0);
            await expect(
              page.getByRole("heading", { level: 1, name: "Cancel these departures?" }),
            ).toBeVisible();
          },
        });
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
        await page.getByRole("heading", { level: 1, name: "Cancellation record" }).waitFor();
        await page
          .getByRole("region", { name: /^Unresolved/ })
          .getByRole("columnheader", { name: "Diver" })
          .waitFor();
        // The call's toast leaves on a real 4-second timer, so whether the
        // first width caught it depended on how long the capture took: two
        // one-worker runs of one tree disagreed at vw-390. The record is the
        // subject; photograph it once the toast has gone.
        const called = page
          .getByRole("status")
          .filter({ hasText: staffCopy("blowout.notices.called") });
        await expect(called).toBeVisible();
        await expect(called).toBeHidden();
        await capture(page, "blowout-cascade", scheme);
      });
    });
  });
}
