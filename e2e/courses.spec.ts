import type { APIRequestContext, Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { expect, makeActivitySafe, READ_ONLY, signedInAs, signedInAsOwner, test } from "./fixtures";
import {
  acceptAgeAttestation,
  choosePartySize,
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openIfClosed,
  openRosterDetails,
  openThreadStep,
  openTripAbout,
  openTripTab,
  publicTripUrl,
} from "./helpers";

/**
 * Open one of the course editor's closed sections (visual review 2026-10-24,
 * A11): pitch, pricing, at a glance and the day-by-day stand open; the rest are
 * closed rows whose controls still post with the one Save.
 */
const openCourseSection = (page: Page, id: string) =>
  openIfClosed(page.locator(`details#${id}`).filter({ visible: true }));

/**
 * **"More details" on the date-request composer** (2026-09-17). An alternative
 * date, where the diver is up to and anything else sit behind one disclosure —
 * closed at rest, and still inside the form, because a `<details>` hides its
 * content without taking it out of the submission.
 *
 * `page.locator("summary")` rather than a role query: Playwright gives
 * `<summary>` no implicit role.
 */
const openMoreDetails = (page: Page) =>
  page.locator("summary").filter({ hasText: "More details" }).click();

/**
 * **The course editor's own hydration flag**, not "whatever carries
 * `data-hydrated`". The staff header's Search button publishes the same flag
 * (#2366), so a bare `[data-hydrated]` matches two elements and fails strict
 * mode. The guard's wrapper is the one that holds the editor's fields.
 */
const editorHydrated = (page: Page) => page.locator('[data-hydrated="true"]:has([name="summary"])');

test("an uncertified visitor can enroll in an instructor-staffed Discover Scuba session and save rental preferences", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  await page.getByRole("link", { name: /Discover Scuba — Pool & Reef/ }).click();
  // Wait for the navigation before asserting on text. `click()` returns as soon
  // as the click is dispatched, so the next assertion can still run against the
  // schedule — where "Course session · Discover Scuba Diving" appears once per
  // seeded session. A strict-mode violation is thrown immediately rather than
  // retried, so that race fails the test outright instead of settling.
  await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}/);
  await expect(page.getByText("Course session · Discover Scuba Diving")).toBeVisible();
  // Her afternoon and her gear, under The day, off the course's own row (UX
  // sheet 2026-10-22, item 3): the seed's Discover Scuba includes its gear.
  const coursePlan = page.getByTestId("trip-course-plan");
  await expect(coursePlan.getByText("Your afternoon")).toBeVisible();
  await expect(coursePlan.getByText("Gear is included.")).toBeVisible();
  // The course session line links out to the course page (a crawlable
  // inbound link for SEO), mirroring the link the schedule list already
  // carries — never just a bare name.
  // `exact` because the page now also carries "Also on the schedule", whose
  // ledger rows are overlay links labelled with the departure's own title —
  // and "Discover Scuba Diving — afternoon" contains this name. Two different
  // links, one a course and one a departure; this assertion is about the
  // course, so it names it exactly rather than by prefix.
  const courseLink = page.getByRole("link", { name: "Discover Scuba Diving", exact: true });
  await expect(courseLink).toHaveAttribute("href", /\/courses\//);
  await expect(courseLink).toHaveAttribute("href", "/s/blue-mantis/courses/discover-scuba-diving");
  await expect(page.getByRole("link", { name: "Add to calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share with a buddy" })).toBeVisible();
  const calendar = await page.request.get(`${new URL(page.url()).pathname}/calendar`);
  expect(calendar.ok()).toBe(true);
  expect(calendar.headers()["content-type"]).toContain("text/calendar");
  expect(await calendar.text()).toContain("BEGIN:VCALENDAR");

  // The booking form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill("nora@example.com");
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’ve got a seat, Nora/ })).toBeVisible();
  // The session's own afternoon rides along on her thread (issue #2795).
  await expect(page.getByRole("region", { name: "Your afternoon" })).toBeVisible();

  // Sizes live in the thread's "Gear and sizes" step, and at most one step is
  // open at rest (ADR 20260827-the-divers-thread, decision 3).
  await openThreadStep(page, "gear");
  await page.getByLabel("BCD size").selectOption("L");
  await page.getByLabel("Wetsuit size").selectOption("XL");
  await page.getByRole("button", { name: "Save rental fit" }).click();
  // The page-level notice the redirect carries, for the reason `nitrox.spec.ts`
  // gives: the form's own "Saved." is inside the gear step, which comes back shut.
  await expect(page.getByText("the crew will have your sizes")).toBeVisible();
});

/**
 * **A course whose fee includes the gear rents nothing at booking** (issue
 * #2795). With cards taken and gear priced online, an ordinary departure's
 * booking form asks "Need rental gear?" and prices each piece; the seed's
 * Discover Scuba session, whose course includes its gear, asks nothing and
 * prices nothing, so the card is charged the course fee alone. A shop of its
 * own: connecting Stripe is shop configuration.
 */
test("a gear-included course session quotes no rental at booking", async ({
  page,
  request,
  privateShop,
}) => {
  const diver = diverTranslator("en-US");
  const SHOP = privateShop.slug;
  const connected = await request.post(
    `/api/test/seed-stripe-account?slug=${encodeURIComponent(SHOP)}`,
  );
  expect(connected.ok()).toBe(true);
  await page.context().clearCookies();

  await page.goto(`/s/${SHOP}`);
  await page
    .getByRole("link", { name: /Night Dive — City of Washington/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/);
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  await expect(page.getByLabel(diver("bookingGear.needGear"))).toBeVisible();

  await page.goto(`/s/${SHOP}`);
  await page
    .getByRole("link", { name: /Discover Scuba — Pool & Reef/ })
    .first()
    .click();
  await expect(page.getByText("Course session · Discover Scuba Diving")).toBeVisible();
  await expect(page.getByLabel("People", { exact: true })).toHaveAttribute("data-hydrated", "true");
  // Pay at booking is on here too: the button says so.
  await expect(page.getByRole("button", { name: /^Book and pay/ })).toBeVisible();
  await expect(page.getByLabel(diver("bookingGear.needGear"))).toHaveCount(0);
  await expect(page.locator("#book").getByText(/Gear for this diver/)).toHaveCount(0);
});

test("a signed-out visitor browses the public course catalog, with the editor still gated", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis/courses");
  await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
  // Rows are h3 under the prerequisite group's own h2 ("Start here",
  // "Requires Open Water or higher") — the ladder grouping from the
  // 2026-08-28 diver-views review, finding 13.
  await expect(page.getByRole("heading", { level: 2, name: "Start here" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "Open Water Diver", exact: true }),
  ).toBeVisible();
  // When each course next runs, as the storefront's shelf says it (fourth
  // review, item 33), and a door to ask on a course with nothing on the board.
  const openWater = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Open Water Diver", exact: true }) });
  await expect(openWater).toContainText(/Next \w{3},\s\w{3}\s\d{1,2}/);
  const ask = page.getByRole("link").filter({ hasText: "Ask for a date" }).first();
  await expect(ask).toHaveAttribute("href", /^\/s\/blue-mantis\/courses\/[^#]+#get-in-touch$/);
  // No staff affordance renders at all — not disabled, absent (AGENTS.md
  // hard rule: gate by not rendering).
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Hide|^Show/ })).toHaveCount(0);

  // Certification paths are gone entirely (ADR
  // 20260805-remove-certification-paths) — no link out to them from the
  // catalog, and nothing left at the URL they used to hold. `paths` falls
  // through to the course-slug route, where no such course exists, so the
  // status is the proxy's refusal above the streaming boundary (ADR
  // 20260912-the-public-namespace-refuses-at-the-edge). Asserted as a status
  // as well as a heading: while this only read the heading, the retired URL
  // answered 200 and stayed indexable, which is the whole of what "gone
  // entirely" was supposed to mean.
  await expect(page.getByRole("link", { name: /certification paths/i })).toHaveCount(0);
  expect((await page.request.get("/s/blue-mantis/courses/paths")).status()).toBe(404);
  await page.goto("/s/blue-mantis/courses/paths");
  // Inside a shop's namespace the refusal is the shop's own, framed by its
  // chrome and pointing back at its schedule (issue #765).
  await expect(page.getByRole("heading", { name: "That page isn’t here" })).toBeVisible();
});

/**
 * The agency toggle a diver gets, the same control the staff roster wears.
 * A shop teaches to one agency's standards at a time and the catalog reads in
 * progression order, which only means anything inside one agency's ladder — so
 * the diver-facing list is one ladder with a way to switch, never both
 * interleaved.
 */
test("a diver reads one agency's ladder at a time and can switch between them", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis/courses");
  const tabs = page.getByRole("navigation", { name: "Show courses by agency" });
  await expect(tabs.getByRole("link", { name: "PADI" })).toHaveAttribute("aria-current", "true");

  // The shop's first agency keeps the bare URL canonical, so what a diver
  // lands on and what a search engine indexes are the same page.
  const list = page.getByRole("listitem");
  await expect(list.filter({ hasText: "Open Water Diver" }).first()).toBeVisible();
  await expect(list.filter({ hasText: "SSI Open Water Diver" })).toHaveCount(0);

  await tabs.getByRole("link", { name: "SSI" }).click();
  await expect(page).toHaveURL("/s/blue-mantis/courses?agency=ssi");
  await expect(list.filter({ hasText: "SSI Open Water Diver" })).toHaveCount(1);
  await expect(tabs.getByRole("link", { name: "SSI" })).toHaveAttribute("aria-current", "true");

  // The per-row agency pill is gone with the arrival of the tabs — the same
  // trade the staff roster made: a badge on every row repeating one of two
  // answers, replaced by the control that acts on it.
  await expect(list.first().getByText("SSI", { exact: true })).toHaveCount(0);
});

test.describe("staff", () => {
  signedInAsOwner();

  /**
   * **A course is sessions on days** (ADR 20260919-one-idea, decision I · Tide,
   * slice 23g). Until this, the staff roster was a catalog with no time in it:
   * a diver reading `/s/<shop>/courses/<slug>` could see when a course next ran
   * and the shop teaching it could not.
   *
   * Both halves are asserted on one page because they are one reading — a
   * scannable column of dates is only useful if the gaps in it are legible, and
   * "Not scheduled" is the state the row's own Schedule act answers.
   */
  test("the course roster says when each course next runs, and where it does not", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/courses");
    await page.getByRole("heading", { level: 1, name: "Courses" }).waitFor();

    // The seed seats this one on the board, so its row carries a date.
    const scheduled = page.getByRole("listitem").filter({ hasText: "Discover Scuba Diving" });
    await expect(scheduled).toContainText(/Next /);

    // And at least one course in the catalog has no session ahead of it, which
    // is the row state the Schedule act exists for. Paired with the positive
    // above so neither passes on a string the page stopped rendering
    // (`.claude/rules/e2e.md`).
    await expect(page.getByText("Not scheduled").first()).toBeVisible();
  });

  test("staff set course pricing on the page and hide the course from scheduling", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/courses");
    const row = page.getByRole("listitem").filter({ hasText: "Discover Scuba Diving" });
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/courses\/discover-scuba-diving\/edit/);

    // Pricing now lives on the course page, beside the copy it prices.
    await page.getByLabel("Instruction fee").fill("149.00");
    await page.getByLabel("e-Learning fee").fill("100.00");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Course page saved");

    // The two items are billed separately, so the public page states the single
    // payment the diver makes for both.
    await page.goto("/s/blue-mantis/courses/discover-scuba-diving");
    await expect(page.getByText("$249")).toBeVisible();

    // Taking the course off the diver's catalog is the editor's own rare act,
    // below the save bar — not a standing button on all 55 roster rows. No
    // banner and no navigation: the button's own word and the header's
    // "Hidden from divers" line both flip in place.
    await page.goto("/shop/blue-mantis/courses/discover-scuba-diving/edit");
    await page.getByRole("button", { name: "Hide from the catalog" }).click();
    await expect(page.getByText("Hidden from divers")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show in the catalog" })).toBeVisible();

    // And the roster says so, where the badge is the one exceptional state it
    // marks. The per-row Preview icon is gone too: the roster's one door to
    // the diver's catalog is the header action, and a single course's live
    // page is named on its own editor ("Live at …").
    await page.goto("/shop/blue-mantis/courses");
    const row2 = page.getByRole("listitem").filter({ hasText: "Discover Scuba Diving" });
    await expect(row2.getByText("Hidden")).toBeVisible();
    await expect(row.getByRole("link", { name: "Preview Discover Scuba Diving" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View public page" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/courses",
    );
    // Nothing on the row changes visibility any more — the row carries no
    // standing control at all.
    await expect(row2.getByRole("button")).toHaveCount(0);
  });

  test("the roster reads as one ledger, agency by agency, in progression order", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/courses");

    // The order a counter conversation walks, not the alphabet: a first taste,
    // then the entry card, then what it opens. Alphabetical would have opened
    // on "Advanced Open Water Diver" — the one course a beginner cannot take.
    // Rows, not title spans: the "Hidden" badge is its own element too, and a
    // sibling test in this file hides a course — matching on the row that
    // *starts* with the title keeps the order readable either way.
    // Issue 623 expanded the published catalog beyond one screenful. Walk the
    // real pager so this assertion covers the whole PADI ladder while keeping
    // the roster's deliberate 20-row page size.
    const rows: string[] = [];
    const headings: string[] = [];
    let visited = 0;
    let pageCount = 0;
    for (;;) {
      // **Wait for the pager before reading anything off the page.** This route
      // is `instant = true`, so a navigation paints the segment's `loading.tsx`
      // first and the roster streams in behind it; `count()` and
      // `allInnerTexts()` are the two locator calls that do *not* retry, so
      // reading either against that skeleton answers 0 and `[]` truthfully
      // about a page that simply has not arrived. The pager is the right anchor
      // because it renders on every page of a multi-page list, last one
      // included (`Pager` returns null only when `pageCount <= 1`), so its
      // presence means the streamed body is here — after which the reads below
      // are answers about the roster rather than about the skeleton.
      //
      // That is not hypothetical. On 2026-09-04 this walk broke one page early
      // on CI and the suite reported a *missing agency* — `["PADI", "SDI"]`
      // against an expected `["PADI", "SDI", "SSI"]` — because SSI sorts last
      // and therefore lives on the last page. The same non-retrying `count()`
      // had already been root-caused in `openTripTab` two days before.
      const pager = page.getByRole("navigation", { name: "Pages" });
      await expect(pager).toBeVisible();
      const position = (await pager.getByText(/^Page \d+ of \d+/).innerText()).match(
        /^Page (\d+) of (\d+)/,
      );
      expect(position, "the pager did not state its position").not.toBeNull();
      pageCount = Number(position?.[2]);
      visited += 1;

      // The roster's own agency groups only: the follow-ups below it ("Cards to
      // process", "Next steps") are h2s and lists too, and the demo seeds both.
      rows.push(
        ...(await page.locator('main ul[aria-labelledby^="agency-"] > li').allInnerTexts()),
      );
      headings.push(...(await page.locator('main h2[id^="agency-"]').allInnerTexts()));

      const next = pager.getByRole("link", { name: "Next" });
      if ((await next.count()) === 0) break;
      // Read the server-rendered destination before navigating. A client-side
      // click can leave the old pager in the DOM during the RSC transition,
      // making the next iteration race a disappearing link on a long catalog.
      const href = await next.getAttribute("href");
      if (!href) break;
      await page.goto(href);
    }
    // The guard that makes a truncated walk say so. Without it, stopping early
    // is indistinguishable from a group that genuinely is not there, and the
    // failure lands on an assertion two screens further down.
    expect(visited, `the pager walk stopped after ${visited} of ${pageCount} pages`).toBe(
      pageCount,
    );
    const at = (title: string) => rows.findIndex((row) => row.trimStart().startsWith(title));
    expect(at("Discover Scuba Diving")).toBeGreaterThanOrEqual(0);
    expect(at("Discover Scuba Diving")).toBeLessThan(at("Open Water Diver"));
    expect(at("Open Water Diver")).toBeLessThan(at("Advanced Open Water Diver"));
    expect(at("Advanced Open Water Diver")).toBeLessThan(at("Rescue Diver"));
    expect(at("Rescue Diver")).toBeLessThan(at("Divemaster"));

    // Slice 9g of ADR 20260827-the-shops-shelves: agency is a group heading,
    // never a tab and never a pill down every row. The whole catalog is on one
    // Pager, so a shop teaching two ladders reads both — which the tab strip
    // made impossible — and the query sorts agency-major, so each agency is
    // named once across the whole walk rather than resuming below the next.
    // A group that spans a page boundary re-renders its heading on the next
    // page — that is the grouping composing with the Pager rather than
    // replacing it. What must never happen is a group *resuming* after
    // another one, so consecutive repeats collapse and the runs are compared.
    const runs = headings
      .map((heading) => heading.trim())
      .filter((heading, index, all) => heading !== all[index - 1]);
    expect(runs).toEqual(["PADI", "SDI", "SSI"]);
    // Matched on the row's own opening title. These were written against one
    // agency's tab, where a substring was unambiguous; on one ungrouped walk
    // "Divemaster" also catches SDI's own "SDI Divemaster" — two real courses at
    // different prices, not a duplicated row — and a prerequisite line ("Rescue
    // Diver or higher") can carry another course's title through the middle of a
    // row. The third line is new: it pins SDI's ladder into the same check
    // rather than letting it fall out of the assertion.
    const rowsTitled = (title: string) => rows.filter((row) => row.trimStart().startsWith(title));
    expect(rowsTitled("SSI Open Water Diver")).toHaveLength(1);
    expect(rowsTitled("Divemaster")).toHaveLength(1);
    expect(rowsTitled("SDI Divemaster")).toHaveLength(1);

    // No filter survives: `?agency=` was a real URL and is now an ignored one,
    // which must show the same catalog rather than an empty roster.
    await page.goto("/shop/blue-mantis/courses?agency=ssi");
    await expect(page.getByRole("navigation", { name: "Filter courses by agency" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "PADI" })).toBeVisible();
  });

  test("a course page schedules a session of itself, opening the board's add panel", async ({
    page,
  }) => {
    // A course the shop runs: the seed seats Discover Scuba Diving on the
    // board, so its page offers "Schedule a session" in its header (third UX
    // review, item 35; the row's own action moved there in visual review
    // 2026-10-24, A39, so a row is one link).
    await page.goto("/shop/blue-mantis/courses");
    await page.getByRole("link", { name: "Edit Discover Scuba Diving", exact: true }).click();
    await expect(page).toHaveURL(/\/courses\/discover-scuba-diving\/edit$/);
    await page.getByRole("link", { name: "Schedule a session", exact: true }).click();
    // The one trip-creation path, not a second one (ADR
    // 20260806-one-trip-create-form) — the panel opens with the course
    // preselected and the title placeholder already shaped for it.
    await expect(page).toHaveURL(
      /\/shop\/blue-mantis\/schedule\/board\/new\?course=[0-9a-f-]{36}$/,
    );
    await expect(page.getByRole("heading", { level: 1, name: "Add a departure" })).toBeVisible();
    // By name, not label: every board row carries an aria-label naming the
    // departure ("Copy Open Water Diver — …"), and a substring label match
    // sweeps those up alongside the panel's own select.
    const course = page.locator('select[name="courseId"]');
    await expect(course).toHaveValue(/[0-9a-f-]{36}/);
    // The preselected course is the one whose row was clicked, not the first
    // in the list — the whole point of arriving here from the catalog.
    await expect(course).toContainText("Discover Scuba Diving");
    await expect(page.getByLabel("What is it")).toHaveAttribute(
      "placeholder",
      /Discover Scuba Diving — Session 1/,
    );
  });

  /**
   * **55 courses, findable in one line** (third UX review, item 35): a title
   * search and Scheduled / Not yet / Hidden views, and "Schedule" only on a
   * course the shop runs rather than on every catalog entry.
   */
  test("the roster searches by title and narrows to a view", async ({ page }) => {
    await page.goto("/shop/blue-mantis/courses");
    const search = page.getByRole("searchbox", { name: "Search courses" });
    await search.fill("Drift");
    await search.press("Enter");
    await page.waitForURL(/[?&]q=Drift/);
    const drift = page
      .getByRole("listitem")
      .filter({ has: page.getByText("Drift Diver", { exact: true }) });
    await expect(drift).toBeVisible();
    // Copied from the catalog and never on the board (the seed runs no Drift
    // Diver session): a door to its editor, no Schedule.
    await expect(drift.getByRole("link", { name: /^Schedule a session of/ })).toHaveCount(0);

    const views = page.getByRole("navigation", { name: "Course views" });
    await views.getByRole("link", { name: "Scheduled" }).click();
    await page.waitForURL(/[?&]view=scheduled/);
    await expect(page.getByText("No courses match")).toBeVisible();

    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).not.toHaveURL(/[?&]q=/);
    const scheduled = page
      .getByRole("listitem")
      .filter({ has: page.getByText("Discover Scuba Diving", { exact: true }) });
    await expect(scheduled).toContainText(/Next /);
    await expect(page.getByText("Not scheduled")).toHaveCount(0);
  });

  test("staff edit a seeded course page, toggle it live, and a signed-out diver reads it", async ({
    page,
  }) => {
    // Chains several sequential navigations and status-toast waits — same
    // aggregate-cost reasoning as the visual specs' test.setTimeout:
    // legitimate per-step cost under 2-worker CI load can sum past the
    // default 15s test budget even when no individual step is stuck.
    test.setTimeout(30_000);
    await page.goto("/shop/blue-mantis/courses");
    // Every course ships pre-filled and visible — there is no catalog to import
    // from. Open Rescue Diver straight from the roster. Match the title exactly:
    // the Divemaster row names "Rescue Diver or higher" in its prerequisite line.
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByText("Rescue Diver", { exact: true }) });
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/courses\/rescue-diver\/edit/);

    // "Live at" names the URL a diver actually has, not the deprecated
    // /shop/** one that only still resolves through a 308 (ADR
    // 20260803-public-shop-namespace) — the shop copies this into its own
    // links and posts.
    const liveAt = page.getByRole("link", { name: "/s/blue-mantis/courses/rescue-diver" });
    await expect(liveAt).toHaveAttribute("href", "/s/blue-mantis/courses/rescue-diver");

    await page.getByRole("button", { name: "Add day" }).click();
    await page.getByLabel("Day 4 title").fill("Day 4");
    await page.getByLabel("Day 4 start time").fill("09:00");
    await page.getByLabel("Day 4 end time").fill("12:00");
    // One textarea, one item per line — the same shape as Included / Not
    // included above it, not a row of inputs with their own Add/Remove pair.
    await page.getByLabel("Day 4 — what happens").fill("Scenario retest\nDebrief and paperwork");
    // Two boxes per pair now, not one textarea carrying a blank-line format
    // (issue #815). The seeded course already has questions; this adds one.
    await openCourseSection(page, "faq");
    await page.getByRole("button", { name: "Add a question" }).click();
    await page
      .getByLabel(/^Question \d+$/)
      .last()
      .fill("Do I need my own gear?");
    await page.getByLabel("Answer").last().fill("No — we provide everything.");
    // No "this is a taster session" box to tick. Which courses are tasters is
    // DiveDay's own catalogue fact, not a shop's claim, and the flag picks the
    // tighter 2:1 in-water ratio — a checkbox on the marketing form was a way
    // to switch that cap off on a boat full of first-timers.
    await expect(page.getByRole("checkbox", { name: /taster session/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Course page saved");

    // The editor's one primary is Save; visibility is a quiet `secondary`
    // beneath it, and the "Live at" link above already opens the page the
    // removed Preview button opened. A *hidden* course is the one exception
    // and grows a Preview link of its own, because its public URL answers 404
    // to anyone carrying no signed capability (issue #1735) — Rescue Diver is
    // live here, so there is still nothing to find.
    await expect(page.getByRole("button", { name: "Hide from the catalog" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Preview" })).toHaveCount(0);

    // A diver arrives with no session at all.
    await page.context().clearCookies();
    await page.goto("/s/blue-mantis/courses/rescue-diver");
    await expect(page.getByRole("heading", { name: "Rescue Diver", level: 1 })).toBeVisible();
    // Admission is stated once, in the block that also owns the shop's own
    // prerequisite prose — labelled separately so the two can never be read as
    // one continuous claim. The spec chips carry logistics only.
    const admission = page.getByRole("region", { name: "Who can enroll" });
    await expect(admission.getByText("Advanced Open Water or higher")).toBeVisible();
    await expect(admission.getByRole("heading", { name: "From the shop" })).toBeVisible();
    await expect(page.getByLabel("At a glance")).not.toContainText("Advanced Open Water or higher");
    await expect(page.getByRole("heading", { name: "Day 4" })).toBeVisible();
    // Both typed lines survived the textarea round trip as separate items.
    await expect(page.getByText("Scenario retest")).toBeVisible();
    await expect(page.getByText("Debrief and paperwork")).toBeVisible();
    await expect(page.getByText("Do I need my own gear?")).toBeVisible();

    // The editor stays closed to that same visitor — and so does the staff
    // roster, which is now an ordinary /shop page (ADR
    // 20260803-public-shop-namespace). The diver's catalog index lives in the
    // public namespace instead, and carries no edit affordance.
    await page.goto("/shop/blue-mantis/courses/rescue-diver/edit");
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/shop/blue-mantis/courses/new");
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/shop/blue-mantis/courses");
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/s/blue-mantis/courses");
    await expect(page).not.toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  });

  test("oversize and over-limit course photos are rejected client-side (CR-011)", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/courses");
    const row = page.getByRole("listitem").filter({ hasText: "Discover Scuba Diving" });
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/courses\/discover-scuba-diving\/edit/);

    await openCourseSection(page, "photos");
    const heroInput = page.locator('input[name="heroImageFile"]').filter({ visible: true });
    await heroInput.setInputFiles({
      name: "hero.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(6 * 1024 * 1024), // over the 5 MB course-photo limit
    });
    await expect(page.getByRole("alert").filter({ hasText: "over 5 MB" })).toBeVisible();
    await expect(heroInput).toHaveValue("");

    // The gallery accepts new photos in small batches (next.config.ts's Server
    // Actions body limit is sized for that batch, not an unbounded multi-file
    // body) — picking more than the batch cap at once is rejected the same way.
    const galleryInput = page.locator('input[name="galleryImageFiles"]').filter({ visible: true });
    await galleryInput.setInputFiles([
      { name: "one.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) },
      { name: "two.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) },
      { name: "three.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) },
    ]);
    await expect(
      page.getByRole("alert").filter({ hasText: "up to 2 photos at a time" }),
    ).toBeVisible();
    await expect(galleryInput).toHaveValue("");
  });

  test("a diver books a course session from its public page", async ({ page }) => {
    // Creates its session through the board's add panel (ADR
    // 20260806-one-trip-create-form) and then walks staff crewing, a public
    // catalog page, and a booking — aggregate per-navigation cost across a long
    // sequence, not a hang; same reasoning as the sibling tests above.
    test.setTimeout(30_000);
    // Schedule this run's own session rather than spending a seeded seat: the e2e
    // database persists across runs, so a test that books the demo session works
    // exactly six times and then fails as "full".
    const sessionTitle = `Open Water Diver — session ${e2eNow().getTime()}`;
    await createTrip(page, {
      course: "Open Water Diver",
      title: sessionTitle,
      // Keep the test-created class clear of the seeded Deep Diver session,
      // which spans into day 21 and intentionally exercises crew overlap rules.
      date: daysFromNow(24),
      departsAt: "08:00",
      returnsAt: "17:00",
    });

    // A course session refuses bookings until an instructor is on its crew — the
    // rule that makes this flow safe, and the reason the seeded session works.
    // Anchored to the full accessible name: an unpriced trip's card also
    // carries a "Set a price for {title}, ..." link whose name contains the
    // session title as a substring, so an unanchored pattern matches both.
    await (await findTripOnBoard(page, "blue-mantis", new RegExp(`^${sessionTitle}$`))).click();
    await openTripAbout(page);
    await expect(
      page.getByText("cannot take bookings until one assigned crew member has the instructor role"),
    ).toBeVisible();
    // Per-person assign, the same mutation Today's departure board uses
    // (Lens 17 task 139) — not a checkbox roster with a single submit.
    // The crew picker is controlled: a pick before hydration silently no-ops
    // (the DOM changes, no action fires), so wait for the marker first.
    await openTripAbout(page);
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
    await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
    await expect(
      page.getByText("cannot take bookings until one assigned crew member has the instructor role"),
    ).toBeHidden();

    await page.context().clearCookies();
    await page.goto("/s/blue-mantis/courses/open-water-diver");
    await expect(page.getByRole("heading", { name: "Upcoming dates" })).toBeVisible();
    // Sessions are listed soonest first, so the one just scheduled 21 days out is
    // the last — and the only one this test may consume a seat from.
    await page.getByRole("link", { name: "Book this date" }).last().click();
    await expect(page.getByText("Course session · Open Water Diver")).toBeVisible();

    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    const diver = `Ravi ${e2eNow().getTime()}`;
    await page.getByLabel("Name").fill(diver);
    await page.getByLabel("Email").fill(`ravi-${e2eNow().getTime()}@example.com`);
    await acceptAgeAttestation(page);
    await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
    await expect(page.getByRole("heading", { name: /You’ve got a seat, Ravi/ })).toBeVisible();
  });

  // PADI's published entry-level in-water ratio (H-08, src/lib/course-ratios.ts):
  // a solo instructor seats at most 8 students, independent of the trip's own
  // stated capacity. Set the trip's capacity well above 8 so the ratio — not
  // capacity — is what blocks the 9th booking.
  test("a solo-instructor course session refuses a booking past the 8-seat ratio", async ({
    page,
  }) => {
    // Two full booking rounds (6 divers, then 2 more) plus the session setup
    // and a third ratio-refused attempt: many real, sequential steps, none
    // stuck. Measured 2026-10-24: 24.0s locally at one worker (4.2s of it the
    // per-test reset, every booking round about 3s), 30.6s of 30 on CI.
    test.setTimeout(45_000);
    const sessionTitle = `Ratio test session ${e2eNow().getTime()}`;
    await createTrip(page, {
      course: "Open Water Diver",
      title: sessionTitle,
      date: daysFromNow(22),
      departsAt: "08:00",
      returnsAt: "17:00",
      capacity: 12,
    });

    // Anchored to the full accessible name: an unpriced trip's card also
    // carries a "Set a price for {title}, ..." link whose name contains the
    // session title as a substring, so an unanchored pattern matches both.
    await (await findTripOnBoard(page, "blue-mantis", new RegExp(`^${sessionTitle}$`))).click();
    // The crew picker is controlled: a pick before hydration silently no-ops
    // (the DOM changes, no action fires), so wait for the marker first.
    await openTripAbout(page);
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" }); // the seeded instructor
    await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
    const tripUrl = page.url();

    await page.context().clearCookies();
    const stamp = e2eNow().getTime();
    const bookSlots = async (count: number, offset: number) => {
      await page.goto(publicTripUrl(tripUrl));
      await choosePartySize(page, count);
      for (let i = 0; i < count; i++) {
        const label = offset + i;
        const nameField =
          i === 0
            ? page.getByLabel("Name", { exact: true })
            : page.getByLabel(`Diver ${i + 1} name`);
        const emailField =
          i === 0
            ? page.getByLabel("Email", { exact: true })
            : page.getByLabel(`Diver ${i + 1} email`);
        await nameField.fill(`Ratio Diver ${label}`);
        if (i > 0) {
          await page
            .getByLabel("Use the main contact’s email for this diver")
            .nth(i - 1)
            .uncheck();
        }
        await emailField.fill(`ratio-${stamp}-${label}@example.com`);
      }
      await acceptAgeAttestation(page);
      await page
        .getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ })
        .click();
      await expect(page.getByRole("heading", { name: /You’ve got a seat/ })).toBeVisible();
    };

    // Two party bookings fill the 8-seat ratio (6 + 2); the trip's own
    // capacity (12) still has four seats open.
    await bookSlots(6, 0);
    await bookSlots(2, 6);

    // The 9th diver hits the ratio, not capacity.
    await page.goto(publicTripUrl(tripUrl));
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("People", { exact: true })).toHaveAttribute(
      "data-hydrated",
      "true",
    );
    await page.getByLabel("Name", { exact: true }).fill(`Ratio Diver ${stamp}-9`);
    await page.getByLabel("Email", { exact: true }).fill(`ratio-${stamp}-9@example.com`);
    await acceptAgeAttestation(page);
    await page.getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ }).click();
    await expect(
      page.getByText("This session is at its instructor-to-student ratio limit"),
    ).toBeVisible();
  });

  test("a depth marker follows the shop's unit, and a broken one is refused rather than published", async ({
    page,
  }) => {
    // Course prose is the shop's own free text, so a depth in it could never
    // follow `shops.depth_unit` — a Key Largo shop read "No deeper than 12
    // meters" on its own page. `{depth18}` resolves at render instead
    // (ADR 20260814-course-depth-markers).
    await page.goto("/shop/blue-mantis/courses/wreck-diver/edit");
    // Wait for hydration before typing, the same signal and the same reason as
    // the save-bar test below (#1717) — this one typed blind on both of its
    // visits. React re-applies a `defaultValue` while it hydrates, so a `fill`
    // that lands first is thrown away and the box goes back to the row's own
    // text. Here that is silent: the save succeeds on the text the writer did
    // not type, and the assertion that fails is the *next* one.
    await expect(editorHydrated(page)).toBeVisible();
    await page.getByLabel("Subhead").fill("Plan every dive to {depth18}");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Course page saved");

    // Resolved on the way out, in whichever unit this shop is set to — never
    // the raw marker, which is the failure a diver would actually see.
    await page.goto("/s/blue-mantis/courses/wreck-diver");
    const subhead = page.getByText(/Plan every dive to/);
    await expect(subhead).toBeVisible();
    await expect(subhead).toContainText(/Plan every dive to (18 meters|60 feet)/);
    await expect(page.getByText("{depth")).toHaveCount(0);

    // A half-edited marker is refused at save, with the offending box focused
    // — the whole point of validating here is that nothing reaches a diver
    // with its own braces showing.
    await page.goto("/shop/blue-mantis/courses/wreck-diver/edit");
    // The visit that actually failed on CI (2026-09-16, shard 1/4): the broken
    // marker was thrown away by hydration, the *valid* text from the save above
    // was posted instead, and the refusal this asserts never happened — so the
    // wait burned its eight seconds and reported the alert as simply absent.
    await expect(editorHydrated(page)).toBeVisible();
    await page.getByLabel("Subhead").fill("Plan every dive to {depth 18}");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Filtered, not bare: Next's own route announcer is a `role="alert"` too.
    await expect(page.getByRole("alert").filter({ hasText: "depth markers" })).toContainText(
      "is broken, so nothing saved",
    );

    // Refused means refused: the previously saved sentence is still what a
    // diver reads.
    await page.goto("/s/blue-mantis/courses/wreck-diver");
    await expect(page.getByText(/Plan every dive to/)).toContainText(/(18 meters|60 feet)/);
  });

  /**
   * **On a phone the everyday sections stand open** (visual review
   * 2026-10-24, A11). The pitch, pricing, at a glance and day by day are what
   * the page is edited for, so they are open at 390 as on a desktop; the rest
   * are closed rows, and an edit in one still saves.
   */
  test("on a phone, the everyday sections stand open and a closed row's edit still saves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/shop/blue-mantis/courses/discover-scuba-diving/edit");
    await expect(editorHydrated(page)).toBeAttached();
    await expect(page.getByRole("navigation", { name: "Sections", exact: true })).toHaveCount(0);

    await page.getByLabel("Instruction fee").fill("151.00");
    await page.locator("#fee-covers > summary").click();
    await expect(page.locator("#fee-covers")).toHaveAttribute("open", "");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Course page saved");

    await page.goto("/shop/blue-mantis/courses/discover-scuba-diving/edit");
    await expect(page.getByLabel("Instruction fee")).toHaveValue(/151/);
  });

  /**
   * **The save bar names the section holding the edit** (ADR
   * 20260827-the-shops-shelves, decision 2): the sentence beside Save says
   * which section the writer changed rather than "Unsaved changes" about four
   * thousand pixels of form. The rail that once sat beside it is gone (visual
   * review 2026-10-24, A11).
   */
  test("the save bar names the section holding the edit", async ({ page }) => {
    test.setTimeout(30_000);
    await page.goto("/shop/blue-mantis/courses/open-water-diver/edit");
    await expect(page.getByRole("navigation", { name: "Sections", exact: true })).toHaveCount(0);

    // A clean form says nothing at all — the note is a consequence, not a label.
    await expect(page.getByText(/^Unsaved changes/)).toHaveCount(0);

    // Wait for hydration before typing. The dirty flag is the guard's
    // `onInputCapture`, so a keystroke landing before React attaches is a native
    // event nobody is listening to: the box holds the text and the bar never says
    // so, and nothing later in the test types again to recover it. The guard
    // renders `data-hydrated` for exactly this and the visual suite already waits
    // on the same signal; only this spec typed blind. Failed that way twice on CI
    // on 2026-09-11, on two different heads, passing on a re-run in between.
    await expect(editorHydrated(page)).toBeVisible();

    await page.getByLabel("Subhead").fill("Three days from pool to reef");
    await expect(page.getByText("Unsaved changes in The pitch")).toBeVisible();

    // A second section, and the note counts instead of listing: two names on
    // one line beside a button is a sentence nobody reads.
    await page.getByLabel("Duration").fill("Three days");
    await expect(page.getByText("Unsaved changes in 2 sections")).toBeVisible();
  });
});

test("a diver with no workable date reaches the shop, and is offered flexible timing", async ({
  page,
}) => {
  // Signed out: this is the composer a prospective diver meets, not staff.
  await page.goto("/s/blue-mantis/courses/open-water-diver");

  const inquiry = page.getByRole("region", { name: "Ask about this course" });
  await inquiry.scrollIntoViewIfNeeded();
  await page.getByLabel("Your name").fill("Mira Delgado");
  await page.getByLabel("Your email").fill("mira.delgado.e2e@example.com");
  await page.getByLabel("How many divers").fill("3");
  // The flexible option accepts an exact or loose answer; the date field
  // beside it is a first choice, never a hold.
  await page.getByLabel("Flexible timing").fill("the week of 12 August");
  // "Your diving experience", the alternative date and "Anything else" moved
  // behind one "More details" disclosure on 2026-09-17 — three answers a diver
  // almost never has, against a composer that met them with ten boxes. Closed,
  // they still submit; a spec that fills one opens it first.
  await openMoreDetails(page);
  // The option's value is now the code ("never"), not its rendered label —
  // src/lib/course-inquiry.ts returns codes, and the diver bundle supplies
  // the sentence.
  await page.getByLabel("Your diving experience").selectOption("never");
  await page.getByLabel("Anything else").fill("We are ashore only on the Tuesday.");

  // Send is the whole choice. "Open in your email app" and "Copy message"
  // stood beside it and both handed the diver a draft to send themselves —
  // no row recorded, no shop notified, and a silent dead end on a phone with
  // no mail client configured, which is the very case they were meant to
  // cover. What replaces them is what was always underneath: the shop's own
  // address and number, as live links.
  await expect(inquiry.getByRole("region", { name: "Your message so far" })).toHaveCount(0);
  await expect(inquiry.getByRole("link", { name: "Open in your email app" })).toHaveCount(0);
  await expect(inquiry.getByRole("button", { name: "Copy message" })).toHaveCount(0);

  await inquiry.getByRole("button", { name: "Send", exact: true }).click();
  await expect(inquiry.getByText("Sent", { exact: true })).toBeVisible();
  await expect(inquiry.getByRole("link", { name: "front.desk@mail.example" })).toBeVisible();
});

test("a blank inquiry is rejected, not defaulted — a way to reply is required", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis/courses/open-water-diver");
  const inquiry = page.getByRole("region", { name: "Ask about this course" });
  await inquiry.scrollIntoViewIfNeeded();

  // Nothing filled in: both refusals land at once rather than one after the
  // other, so a diver fixes the form in one pass instead of two.
  await inquiry.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    inquiry.getByText("Leave an email or a phone number so we can reply."),
  ).toBeVisible();
  await expect(inquiry.getByText("Sent", { exact: true })).toHaveCount(0);

  // Experience is useful context, but a request with no address and no number is
  // still a question nobody can answer.
  await openMoreDetails(page);
  await page.getByLabel("Your diving experience").selectOption("never");
  await inquiry.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    inquiry.getByText("Leave an email or a phone number so we can reply."),
  ).toBeVisible();
  await expect(inquiry.getByText("Sent", { exact: true })).toHaveCount(0);

  // A phone number on its own clears it: either one, never both.
  await page.getByLabel("Your phone").fill("+1 305 555 0177");
  await inquiry.getByRole("button", { name: "Send", exact: true }).click();
  await expect(inquiry.getByText("Sent", { exact: true })).toBeVisible();
});

test("a diver's inquiry is recorded server-side and the shop's details stay reachable after sending", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis/courses/open-water-diver");
  const inquiry = page.getByRole("region", { name: "Ask about this course" });
  await inquiry.scrollIntoViewIfNeeded();
  await page.getByLabel("Your name").fill("Sena Okafor");
  await page.getByLabel("Your email").fill("sena.okafor.e2e@example.com");
  await page.getByLabel("Your phone").fill("+1 305 555 0199");
  // One diver is already in the box — nobody fills in a field to say the
  // obvious.
  await expect(page.getByLabel("How many divers")).toHaveValue("1");
  await page.getByLabel("Flexible timing").fill("any weekend this autumn");
  await openMoreDetails(page);
  await page.getByLabel("Your diving experience").selectOption("certified");

  await inquiry.getByRole("button", { name: "Send", exact: true }).click();

  // The composer collapses into a confirmation — task 7's server-recorded
  // send, not just the mailto fallback — and still leaves the shop's own
  // contact details on screen underneath it.
  await expect(inquiry.getByText("Sent", { exact: true })).toBeVisible();
  await expect(inquiry.getByText("front.desk@mail.example")).toBeVisible();
});

/**
 * The public pages' spine. Before this the catalog was structurally
 * unreachable: `publicCoursesPath` was linked only from inside the courses
 * subtree, so a diver who landed on the schedule had no way to discover that
 * the shop teaches anything at all. The header carries the map on every public
 * page, so the walk works from wherever a diver came in.
 */
/**
 * The storefront's courses shelf and the display-scale h1 both land with slice
 * 6i of ADR 20260827-clearwater-surface-language, decision 8: courses follow
 * the week as a shelf, and the public h1 resolves the `text-2xl`/`text-[2.5rem]`
 * disagreement upward.
 */
test.describe("courses on the shopfront", () => {
  test("the shelf shows three rungs and a door to the rest", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/s/blue-mantis");
    const shelf = page.getByRole("region", { name: "Courses" });
    await expect(shelf).toBeVisible();
    // Three, and no more: a shelf that grew to the whole catalog would be a
    // second page glued under the first.
    const cards = shelf.getByRole("listitem");
    await expect(cards).toHaveCount(3);
    await expect(shelf.getByRole("link", { name: "All courses" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/courses",
    );
    await cards.first().getByRole("link").click();
    await expect(page).toHaveURL(/\/s\/blue-mantis\/courses\/[a-z0-9-]+$/);
  });

  test("both public course routes render their h1 at the display scale", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await page.goto("/s/blue-mantis/courses");
    await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toHaveClass(
      /text-\[2\.5rem\]/,
    );

    await page.goto("/s/blue-mantis/courses/open-water-diver");
    await expect(page.getByRole("heading", { level: 1 })).toHaveClass(/text-\[2\.5rem\]/);
  });
});

test.describe("the public header nav", () => {
  test("walks a diver from the schedule to the catalog and back", async ({ page }) => {
    await page.goto("/s/blue-mantis");
    const nav = page.getByRole("navigation", { name: "Shop pages" });
    await expect(nav.getByRole("link", { name: "Schedule" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await nav.getByRole("link", { name: "Courses" }).click();
    await expect(page).toHaveURL("/s/blue-mantis/courses");
    await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
    // The tab a diver is standing on says so, and only that one.
    await expect(nav.getByRole("link", { name: "Courses" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Schedule" })).not.toHaveAttribute("aria-current");

    await nav.getByRole("link", { name: "Schedule" }).click();
    await expect(page).toHaveURL("/s/blue-mantis");
  });

  test("reaches the catalog from a departure's booking page too", async ({ page }) => {
    // A diver who followed a shared trip link is the one most likely to be
    // wondering how to get certified in the first place.
    await page.goto("/s/blue-mantis");
    await page
      .locator("li")
      .filter({ hasText: "Two-Tank Reef — Molasses & French" })
      .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
      .click();
    await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}/);

    const nav = page.getByRole("navigation", { name: "Shop pages" });
    // A departure has no closer parent than the schedule it was found on.
    await expect(nav.getByRole("link", { name: "Schedule" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await nav.getByRole("link", { name: "Courses" }).click();
    await expect(page).toHaveURL("/s/blue-mantis/courses");
  });

  test("keeps the shop's phone and email in the footer, once", async ({ page }) => {
    await page.goto("/s/blue-mantis");
    const header = page.getByRole("banner");
    const footer = page.getByRole("contentinfo");
    await expect(footer.locator('a[href^="tel:"]')).toBeVisible();
    await expect(footer.locator('a[href^="mailto:"]')).toBeVisible();
    // The header used to repeat both on every page; it is the shop's name and
    // where you can go, nothing else.
    await expect(header.locator('a[href^="tel:"]')).toHaveCount(0);
    await expect(header.locator('a[href^="mailto:"]')).toHaveCount(0);
  });
});

/**
 * **A hidden course is a 404, and the editor is the door that still opens it**
 * (issue #1735).
 *
 * Course slugs are minted from a shared template catalogue, so while the edge
 * refused only slugs that named nothing, the status line separated a draft
 * (200, with the shop's refusal streamed under it) from a slug that never
 * existed (404) — and a stranger with a dozen guesses read a shop's
 * unpublished drafts off it. The previewer is told apart by what they carry.
 *
 * A shop of its own: this flips `courses.is_active`, which the per-test reset
 * does not put back.
 */
test("a hidden course answers 404 to a bare URL, and opens from the editor's Preview", async ({
  page,
  privateShop,
}) => {
  // Several sequential navigations; same aggregate-cost reasoning as the
  // toggle-live test above.
  test.setTimeout(30_000);
  const publicUrl = `/s/${privateShop.slug}/courses/discover-scuba-diving`;
  // Hiding is the editor's own rare act, below the save bar — the roster has
  // no per-row toggle. The button's word and the header's "Hidden from
  // divers" line flip in place, so that is the wait — never a navigation
  // straight off the click.
  await page.goto(`/shop/${privateShop.slug}/courses/discover-scuba-diving/edit`);
  await page.getByRole("button", { name: "Hide from the catalog" }).click();
  await expect(page.getByText("Hidden from divers")).toBeVisible();

  // The shop's own owner, at a bare URL, carrying nothing. The refusal is
  // decided above the streaming boundary, so this is a real 404 rather than a
  // 200 with a refusal in the payload — which is the whole point of the
  // status line, and what a `curl` was reading.
  expect((await page.goto(publicUrl))?.status()).toBe(404);

  // The door that works, and the only one: minted on the tap by a route that
  // has just proved this reader is this shop's live staff.
  await page.goto(`/shop/${privateShop.slug}/courses/discover-scuba-diving/edit`);
  await page.getByRole("link", { name: "Preview" }).click();
  await expect(page).toHaveURL(/\/courses\/discover-scuba-diving\?preview=/);
  await expect(
    page.getByRole("heading", { name: "Discover Scuba Diving", level: 1 }),
  ).toBeVisible();

  // And the capability is not an authorisation. A stranger handed that exact
  // link gets past the edge and meets the page's own live per-shop check,
  // which is the one that decides — so they read no course either way.
  const previewed = page.url();
  await page.context().clearCookies();
  await page.goto(previewed);
  await expect(page.getByRole("heading", { name: "Discover Scuba Diving", level: 1 })).toHaveCount(
    0,
  );
  expect((await page.goto(publicUrl))?.status()).toBe(404);
});

/**
 * The mint route is a `/shop/**` surface and carries that namespace's rules:
 * `requireShopSurface` reads the shop off the session and refuses a URL naming
 * any other, so a live staffer of one shop cannot mint a capability for
 * another's draft. That is the scope binding asserted at the door rather than
 * only in the signature (security review, issue #1735).
 */
test("the preview route refuses to mint for a shop the staffer is not in", async ({
  page,
  privateShop,
}) => {
  // `page.request` rather than `page.goto`: it carries this context's session
  // cookies and reads the status without rendering, and the refusals below are
  // body-less 404s that Chromium declines to paint at all.
  const mint = (path: string) => page.request.get(path);

  // Signed in as this private shop's owner, so its own course mints and the hop
  // lands on the public page.
  expect(
    (await mint(`/shop/${privateShop.slug}/courses/discover-scuba-diving/preview`)).status(),
  ).toBe(200);
  // blue-mantis is somebody else's shop, whatever this session is.
  expect((await mint("/shop/blue-mantis/courses/discover-scuba-diving/preview")).status()).toBe(
    404,
  );
  // And a course this shop does not hold is refused here rather than redirected
  // to a URL the edge would refuse one hop later.
  expect(
    (await mint(`/shop/${privateShop.slug}/courses/never-minted-course/preview`)).status(),
  ).toBe(404);
});

test("the course editor exposes private-session pricing alongside standard pricing", async ({
  privateShop,
  page,
}) => {
  test.setTimeout(30_000);
  // Private courses are no longer a separate visibility mode. The editor
  // keeps private-group pricing as an optional second price instead.
  await page.goto(`/shop/${privateShop.slug}/courses/rescue-diver/edit`);
  await expect(page.getByLabel("Private session price")).toBeVisible();
});

/**
 * **Two tabs, and the second one does not silently revert the first.**
 *
 * The editor posts its *whole* page, so a second writer did not overwrite one
 * field — they reverted every section, pricing, photos, the day-by-day plan and
 * the FAQ, to whatever the row held when their tab opened. No warning, and the
 * first writer's work gone with no record it had existed (issue #820). An owner
 * and a manager tidying the catalogue in one afternoon is enough.
 *
 * No test could see it because a test opens one page. This one opens two.
 */
test.describe("the course editor with two tabs open", () => {
  signedInAsOwner();

  test("a second tab's save is refused rather than reverting the first", async ({
    page,
    context,
  }) => {
    const url = "/shop/blue-mantis/courses/discover-scuba-diving/edit";
    const first = page;
    await first.goto(url);
    const summary = first.locator('[name="summary"]');
    await expect(summary).toBeVisible();

    // Both tabs load *before* either saves — the whole premise.
    const second = makeActivitySafe(await context.newPage());
    await second.goto(url);
    await expect(second.locator('[name="summary"]')).toBeVisible();

    await summary.fill("Saved by the first tab");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(first.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    // The second tab is holding the page as it was before that save.
    await second.locator('[name="summary"]').fill("Saved by the second tab");
    await second.getByRole("button", { name: "Save", exact: true }).click();

    // Refused, and it says so.
    await expect(
      second.getByRole("alert").filter({ hasText: "Somebody else changed this page" }),
    ).toBeVisible();
    // **And what they typed is still in the box** — the point of refusing rather
    // than redirecting, which would re-render the form from the database.
    await expect(second.locator('[name="summary"]')).toHaveValue("Saved by the second tab");

    // The first tab's work survives.
    await first.reload();
    await expect(first.locator('[name="summary"]')).toHaveValue("Saved by the first tab");
  });
});

/**
 * **Four hops away, and the afternoon is still there.**
 *
 * The editor is one long page with no autosave. Under Cache Components a
 * navigated-away page is *hidden* rather than unmounted, so one hop away and
 * back keeps the form on its own — but React's Activity holds three routes,
 * and past that the draft is evicted with nothing to say so. Which trip
 * crosses that line is invisible from the outside; that is the whole defect
 * (issue #815). The session draft is what covers it, so this walks the
 * distance rather than trusting the unit test's jsdom.
 */
test.describe("the course editor over a wander through the app", () => {
  signedInAsOwner();

  test("keeps an unsaved edit through four other pages, and says it put it back", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const url = "/shop/blue-mantis/courses/discover-scuba-diving/edit";
    await page.goto(url);
    const summary = page.locator('[name="summary"]');
    await expect(summary).toBeVisible();
    // The first keystroke after a navigation can land before React attaches
    // to the form — a native event the dirty flag never hears, so the bar
    // below never says "Unsaved changes". Wait for the guard to say it is
    // listening, the way the orders and counter searches are waited on.
    await editorHydrated(page).waitFor();
    await summary.fill("Half a thought, never saved");
    // The bar says so, pinned to the bottom edge rather than four thousand
    // pixels down where Save used to be the only sign this was a form — and it
    // names the section, since the rail arrived (ADR
    // 20260827-the-shops-shelves): "Unsaved changes" alone left the writer to
    // find which of eight sections it meant.
    await expect(page.getByText("Unsaved changes in The pitch", { exact: true })).toBeVisible();

    // **Four routes, and four is the point** — React's Activity holds three, so
    // a three-hop walk never reaches the eviction this test exists to cover.
    //
    // The walk goes the way a staffer's would: two of the sidebar's sections,
    // then two places the search finds (ADR 20261001-logbook). Today's
    // accessible name carries its blocked-diver badge, which is why it is
    // matched by prefix.
    const goByBar = async (name: RegExp) => {
      await page
        .getByRole("navigation", { name: "Main", exact: true })
        .getByRole("link", { name })
        .click();
    };
    const goBySearch = async (name: string) => {
      await page.locator("header").getByRole("button", { name: "Search" }).click();
      await page.getByRole("combobox").fill(name);
      await page
        .getByRole("option", { name: new RegExp(name) })
        .first()
        .click();
    };
    const settle = async () => {
      await page.waitForURL((candidate) => !candidate.pathname.endsWith("/edit"));
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    };
    await goByBar(/^Schedule$/);
    await settle();
    await goByBar(/^Today/);
    await settle();
    await goBySearch("Divers");
    await settle();
    await goBySearch("Crew schedule");
    await settle();

    // Back the way a person would come back: through the search, not history.
    await page.locator("header").getByRole("button", { name: "Search" }).click();
    await page.getByRole("combobox").fill("Courses");
    await page
      .getByRole("option", { name: /Courses/ })
      .first()
      .click();
    await page.waitForURL(/\/courses$/);
    // By the door's own accessible name. The row is one `LedgerRow` whose
    // stretched link is labelled "Edit {title}", and the Schedule act beside it
    // is "Schedule a session of {title}" — so a bare substring match on the
    // course title finds both and takes whichever comes first in the DOM, which
    // since slice 9g is the one that leaves for the board.
    await page.getByRole("link", { name: "Edit Discover Scuba Diving", exact: true }).click();
    await page.waitForURL(/\/edit/);

    await expect(page.locator('[name="summary"]')).toHaveValue("Half a thought, never saved");
    await expect(page.getByText("put back", { exact: false })).toBeVisible();
  });
});

/**
 * The FAQ used to be one textarea holding a format — blank lines between
 * pairs, first line the question — and a shop that forgot the blank line
 * published one enormous question. Two boxes per pair now, and the save
 * round-trips them.
 */
test("writes a FAQ pair through two boxes and shows it to a diver", async ({
  privateShop,
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(`/shop/${privateShop.slug}/courses/rescue-diver/edit`);
  await openCourseSection(page, "faq");
  await page.getByRole("button", { name: "Add a question" }).click();
  await page
    .getByLabel(/^Question \d+$/)
    .last()
    .fill("Do I need my own gear?");

  // Half a pair is refused, and says which half — the old textarea dropped an
  // unanswered question silently, so the writer saved, saw it gone, and had no
  // way to tell whether it had ever been there.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Every question needs an answer")).toBeVisible();
  await expect(page.getByLabel(/^Question \d+$/).last()).toHaveValue("Do I need my own gear?");

  await page.getByLabel("Answer").last().fill("No — every rental is part of the fee.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Course page saved");

  await page.goto(`/s/${privateShop.slug}/courses/rescue-diver`);
  // The answer is behind its own disclosure, the way a diver meets it.
  await page.getByText("Do I need my own gear?").click();
  await expect(page.getByText("No — every rental is part of the fee.")).toBeVisible();
});

/**
 * **Learning materials, from the editor to the student** (ADR
 * 20261008-course-learning-materials). A shop names one, is refused an http
 * link, saves an https one; a diver who books the course reads it on their
 * thread; the instructor ticks it done on the session's roster, and the
 * thread says so.
 *
 * `privateShop`, because it writes the course's own content.
 */
test("a course's learning materials reach the student's thread, and staff tick them done", async ({
  privateShop,
  page,
  browser,
  workerBaseURL,
}) => {
  test.setTimeout(90_000);
  const slug = privateShop.slug;
  await page.goto(`/shop/${slug}/courses/open-water-diver/edit`);
  await openCourseSection(page, "learningMaterialsJson");
  await page.getByRole("button", { name: "Add a material" }).click();
  await page
    .getByLabel(/^Material \d+$/)
    .last()
    .fill("Pool skills video");
  await page.getByLabel("Link").last().fill("http://example.com/pool");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Each link has to start with https://.")).toBeVisible();

  await page.getByLabel("Link").last().fill("https://example.com/pool");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Course page saved");

  // A diver, on their own browser profile, books the seeded three-day session.
  const diverContext = await browser.newContext({ baseURL: workerBaseURL });
  const diverPage = makeActivitySafe(await diverContext.newPage());
  await diverPage.goto(`/s/${slug}/courses/open-water-diver`);
  await diverPage.getByRole("link", { name: "Book this date" }).first().click();
  await expect(diverPage.getByLabel("People", { exact: true })).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  const diver = `Mira ${e2eNow().getTime()}`;
  await diverPage.getByLabel("Name").fill(diver);
  await diverPage.getByLabel("Email").fill(`mira-${e2eNow().getTime()}@example.com`);
  await acceptAgeAttestation(diverPage);
  await diverPage
    .getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ })
    .click();
  await expect(diverPage).toHaveURL(/\/ready\//);

  await expect(diverPage.getByRole("heading", { name: "Before your first day" })).toBeVisible();
  const material = diverPage.getByRole("link", { name: "Pool skills video" });
  await expect(material).toHaveAttribute("href", "https://example.com/pool");
  // The thread's URL is a bearer capability: a link out never carries it.
  await expect(material).toHaveAttribute("rel", /noreferrer/);
  await expect(diverPage.getByText("The shop has these marked done")).toHaveCount(0);

  // The instructor ticks it on the session's own roster.
  const trip = await findTripOnBoard(page, slug, /Open Water Diver — three-day course/);
  await trip.click();
  await openTripTab(page, "Trip");
  const row = page.locator('#roster li[id^="booking-"]').filter({ hasText: diver });
  await expect(row.getByText("Materials not done")).toBeVisible();
  await openRosterDetails(row);
  await row.getByRole("button", { name: "Mark materials done" }).click();
  await expect(page.getByText("Learning materials updated")).toBeVisible();
  await expect(row.getByText("Materials not done")).toHaveCount(0);

  await diverPage.reload();
  await expect(diverPage.getByText("The shop has these marked done")).toBeVisible();
  await expect(diverPage.getByRole("link", { name: "Pool skills video" })).toBeVisible();
  await diverContext.close();
});

/**
 * **A course whose fee includes the gear** (fifth-loop ideas, item 16). The
 * shop ticks the course's switch; a student who books a session is asked for
 * sizes with no rental price, and the bag list says the shop brings the set.
 *
 * `privateShop`, because it writes the course's own row.
 */
test("a course that includes its gear asks the student for sizes, not money", async ({
  privateShop,
  page,
  browser,
  workerBaseURL,
}) => {
  test.setTimeout(60_000);
  const slug = privateShop.slug;
  await page.goto(`/shop/${slug}/courses/open-water-diver/edit`);
  await expect(editorHydrated(page)).toBeVisible();
  await page.getByRole("checkbox", { name: "The scuba unit is part of the course fee" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Course page saved");
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "The scuba unit is part of the course fee" }),
  ).toBeChecked();

  const diverContext = await browser.newContext({ baseURL: workerBaseURL });
  const diverPage = makeActivitySafe(await diverContext.newPage());
  await diverPage.goto(`/s/${slug}/courses/open-water-diver`);
  await diverPage.getByRole("link", { name: "Book this date" }).first().click();
  await expect(diverPage.getByLabel("People", { exact: true })).toHaveAttribute(
    "data-hydrated",
    "true",
  );
  await diverPage.getByLabel("Name").fill(`Tove ${e2eNow().getTime()}`);
  await diverPage.getByLabel("Email").fill(`tove-${e2eNow().getTime()}@example.com`);
  await acceptAgeAttestation(diverPage);
  await diverPage
    .getByRole("button", { name: /^Book (this seat|\d+ seats|the last seat)$/ })
    .click();
  await expect(diverPage).toHaveURL(/\/ready\//);

  const gear = await openThreadStep(diverPage, "gear");
  await expect(
    gear.getByText(/^Your scuba unit \(BCD, regulator, tank, weights\) comes with the course\./),
  ).toBeVisible();
  await expect(gear.getByText(/Estimated rental/)).toHaveCount(0);
  // Personal gear is the student's own: not offered here, listed to bring.
  await expect(gear.getByRole("checkbox", { name: /^Mask/ })).toHaveCount(0);
  await expect(diverPage.getByText(/^Scuba unit \(BCD, regulator, tank, weights\)$/)).toBeVisible();
  await expect(diverPage.getByText("Snorkel", { exact: true })).toBeVisible();
  await diverContext.close();
});

/**
 * **The agency-wording door is for the staffer who can walk through it** (UX
 * review 2026-10-10, item 16). The course editor draws its Forms section only
 * for someone who may configure courses, so a divemaster reading the roster is
 * told the wording is missing and is offered no link into an editor with no
 * Forms in it. The demo's forms carry the shop's words (fourth review, item
 * 53), so each test first adds one the shop has named and not yet written.
 */
async function addUnwordedForm(request: APIRequestContext) {
  const seeded = await request.post("/api/test/seed-unworded-course-form");
  expect(seeded.ok(), await seeded.text()).toBe(true);
}

test.describe("the agency-wording notice on the course roster", () => {
  test.describe("for an owner", () => {
    signedInAsOwner();
    test("says what is missing and opens the first course's Forms", async ({ page, request }) => {
      await addUnwordedForm(request);
      await page.goto("/shop/blue-mantis/courses");
      const notice = page.getByText(/needs? (its|their) agency form wording/);
      await expect(notice).toBeVisible();
      await expect(page.getByRole("link", { name: /^Start with / })).toHaveAttribute(
        "href",
        /\/shop\/blue-mantis\/courses\/[^/]+\/edit#forms$/,
      );
    });
  });

  test.describe("for a divemaster", () => {
    signedInAs("divemaster");
    test("says what is missing and offers no door into a Forms section they cannot see", async ({
      page,
      request,
    }) => {
      await addUnwordedForm(request);
      await page.goto("/shop/blue-mantis/courses");
      await expect(page.getByText(/needs? (its|their) agency form wording/)).toBeVisible();
      await expect(page.getByRole("link", { name: /^Start with / })).toHaveCount(0);
    });
  });
});
