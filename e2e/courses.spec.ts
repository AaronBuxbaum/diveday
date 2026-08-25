import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  acceptAgeAttestation,
  createTrip,
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  publicTripUrl,
} from "./helpers";

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
  // The course session line links out to the course page (a crawlable
  // inbound link for SEO), mirroring the link the schedule list already
  // carries — never just a bare name.
  const courseLink = page.getByRole("link", { name: "Discover Scuba Diving" });
  await expect(courseLink).toHaveAttribute("href", /\/courses\//);
  await expect(courseLink).toHaveAttribute("href", "/s/blue-mantis/courses/discover-scuba-diving");
  await expect(page.getByRole("link", { name: "Add to calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share with a buddy" })).toBeVisible();
  const calendar = await page.request.get(`${new URL(page.url()).pathname}/calendar`);
  expect(calendar.ok()).toBe(true);
  expect(calendar.headers()["content-type"]).toContain("text/calendar");
  expect(await calendar.text()).toContain("BEGIN:VCALENDAR");

  // The booking form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill("nora@example.com");
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’re on the boat, Nora/ })).toBeVisible();

  await page.getByLabel("BCD size").selectOption("L");
  await page.getByLabel("Wetsuit size").selectOption("XL");
  await page.getByRole("button", { name: "Save rental fit" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
});

test("a signed-out visitor browses the public course catalog, with the editor still gated", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis/courses");
  await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Open Water Diver", exact: true }),
  ).toBeVisible();
  // No staff affordance renders at all — not disabled, absent (AGENTS.md
  // hard rule: gate by not rendering).
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Hide|^Show/ })).toHaveCount(0);

  // Certification paths are gone entirely (ADR
  // 20260805-remove-certification-paths) — no link out to them from the
  // catalog, and nothing left at the URL they used to hold. Asserted on the
  // rendered not-found boundary rather than the raw status: `paths` now falls
  // through to the course-slug route, whose cold first byte can still be 200
  // under cacheComponents (e2e/marketing.spec.ts documents that limitation).
  await expect(page.getByRole("link", { name: /certification paths/i })).toHaveCount(0);
  await page.goto("/s/blue-mantis/courses/paths");
  // Inside a shop's namespace the refusal is the shop's own, framed by its
  // chrome and pointing back at its schedule (issue #765).
  await expect(page.getByRole("heading", { name: "That page isn’t here any more" })).toBeVisible();
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
    await page.getByRole("button", { name: "Save course page" }).click();
    await expect(page.getByRole("status")).toContainText("Course page saved");

    // The two items are billed separately, so the public page states the single
    // payment the diver makes for both.
    await page.goto("/s/blue-mantis/courses/discover-scuba-diving");
    await expect(page.getByText("$249")).toBeVisible();

    // Back on the roster, the worded Hide toggle takes the course off
    // scheduling lists. No banner and no navigation — the toggle's own word
    // and the "Hidden" badge update in place, which is also what keeps the
    // click from jumping the page.
    await page.goto("/shop/blue-mantis/courses");
    // The per-row Preview icon is gone: the roster's one door to the diver's
    // catalog is the header action, and a single course's live page is named
    // on its own editor ("Live at …").
    await expect(row.getByRole("link", { name: "Preview Discover Scuba Diving" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View public page" })).toHaveAttribute(
      "href",
      "/s/blue-mantis/courses",
    );
    await row.getByRole("button", { name: "Hide Discover Scuba Diving" }).click();
    const row2 = page.getByRole("listitem").filter({ hasText: "Discover Scuba Diving" });
    await expect(row2.getByText("Hidden")).toBeVisible();
    await expect(row2.getByRole("button", { name: "Show Discover Scuba Diving" })).toBeVisible();
  });

  test("the roster reads in progression order and filters by agency tab", async ({ page }) => {
    await page.goto("/shop/blue-mantis/courses");

    // The order a counter conversation walks, not the alphabet: a first taste,
    // then the entry card, then what it opens. Alphabetical would have opened
    // on "Advanced Open Water Diver" — the one course a beginner cannot take.
    // Rows, not title spans: the "Hidden" badge is a `font-semibold` span too,
    // and a sibling test in this file hides a course — matching on the row that
    // *starts* with the title keeps the order readable either way.
    // Issue 623 expanded the published catalog beyond one screenful. Walk the
    // real pager so this assertion covers the whole PADI ladder while keeping
    // the roster's deliberate 20-row page size.
    const rows: string[] = [];
    for (;;) {
      rows.push(...(await page.locator("main ul > li").allInnerTexts()));
      const next = page.getByRole("navigation", { name: "Pages" }).getByRole("link", {
        name: "Next",
      });
      if ((await next.count()) === 0) break;
      // Read the server-rendered destination before navigating. A client-side
      // click can leave the old pager in the DOM during the RSC transition,
      // making the next iteration race a disappearing link on a long catalog.
      const href = await next.getAttribute("href");
      if (!href) break;
      await page.goto(href);
    }
    const at = (title: string) => rows.findIndex((row) => row.trimStart().startsWith(title));
    expect(at("Discover Scuba Diving")).toBeGreaterThanOrEqual(0);
    expect(at("Discover Scuba Diving")).toBeLessThan(at("Open Water Diver"));
    expect(at("Open Water Diver")).toBeLessThan(at("Advanced Open Water Diver"));
    expect(at("Advanced Open Water Diver")).toBeLessThan(at("Rescue Diver"));
    expect(at("Rescue Diver")).toBeLessThan(at("Divemaster"));

    await page.goto("/shop/blue-mantis/courses");

    // Agency is a tab, not a pill repeated on every row — and there is no
    // "All". Progression order is the order a shop *teaches*, which only means
    // anything inside one agency's ladder; "All" interleaved two of them into
    // one column where an Open Water sat next to an Open Water. The shop's
    // first agency is the default, so the bare URL stays canonical.
    const tabs = page.getByRole("navigation", { name: "Filter courses by agency" });
    await expect(tabs.getByRole("link", { name: "All" })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "PADI" })).toHaveAttribute("aria-current", "true");

    await tabs.getByRole("link", { name: "SSI" }).click();
    await expect(page).toHaveURL("/shop/blue-mantis/courses?agency=ssi");
    const roster = page.locator("main ul > li");
    await expect(roster.filter({ hasText: "SSI Open Water Diver" })).toHaveCount(1);
    // Divemaster is PADI-only in the seeded catalog, so the SSI tab drops it.
    await expect(roster.filter({ hasText: "Divemaster" })).toHaveCount(0);
    await expect(tabs.getByRole("link", { name: "SSI" })).toHaveAttribute("aria-current", "true");

    // The tab survives a reload (it is a real URL), and the default tab brings
    // the rest back on the canonical URL.
    await page.reload();
    await expect(roster.filter({ hasText: "Divemaster" })).toHaveCount(0);
    await tabs.getByRole("link", { name: "PADI" }).click();
    await expect(page).toHaveURL("/shop/blue-mantis/courses");
    const padiRows: string[] = [];
    for (;;) {
      padiRows.push(...(await page.locator("main ul > li").allInnerTexts()));
      const next = page.getByRole("navigation", { name: "Pages" }).getByRole("link", {
        name: "Next",
      });
      if ((await next.count()) === 0) break;
      const href = await next.getAttribute("href");
      if (!href) break;
      await page.goto(href);
    }
    expect(padiRows.filter((row) => row.includes("Divemaster"))).toHaveLength(1);
  });

  test("a course row schedules a session of itself, opening the board's add panel", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/courses");
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByText("Rescue Diver", { exact: true }) });

    await row.getByRole("link", { name: "Schedule a session of Rescue Diver" }).click();
    // The one trip-creation path, not a second one (ADR
    // 20260806-one-trip-create-form) — the panel opens with the course
    // preselected and the title placeholder already shaped for it.
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/schedule\/board\?course=[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible();
    // By name, not label: every board row carries an aria-label naming the
    // departure ("Copy Open Water Diver — …"), and a substring label match
    // sweeps those up alongside the panel's own select.
    const course = page.locator('select[name="courseId"]');
    await expect(course).toHaveValue(/[0-9a-f-]{36}/);
    // The preselected course is the one whose row was clicked, not the first
    // in the list — the whole point of arriving here from the catalog.
    await expect(course).toContainText("Rescue Diver");
    await expect(page.getByLabel("What is it")).toHaveAttribute(
      "placeholder",
      /Rescue Diver — Session 1/,
    );
  });

  test("staff edit a seeded course page, toggle it live, and a signed-out diver reads it", async ({
    page,
  }) => {
    // Chains several sequential navigations and status-toast waits — same
    // aggregate-cost reasoning as visual.spec.ts's test.setTimeout:
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
    await page.getByRole("button", { name: "Save course page" }).click();
    await expect(page.getByRole("status")).toContainText("Course page saved");

    // The editor is a save form and nothing else: visibility lives on the
    // roster's eye toggle, and the "Live at" link above already opens the page
    // the removed Preview button opened.
    await expect(page.getByRole("button", { name: /^Hide$|^Show$/ })).toHaveCount(0);
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
    await expect(
      page.getByText("cannot take bookings until one assigned crew member has the instructor role"),
    ).toBeVisible();
    // Per-person assign, the same mutation Today's departure board uses
    // (Lens 17 task 139) — not a checkbox roster with a single submit.
    // The crew picker is controlled: a pick before hydration silently no-ops
    // (the DOM changes, no action fires), so wait for the marker first.
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
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    const diver = `Ravi ${e2eNow().getTime()}`;
    await page.getByLabel("Name").fill(diver);
    await page.getByLabel("Email").fill(`ravi-${e2eNow().getTime()}@example.com`);
    await acceptAgeAttestation(page);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Ravi/ })).toBeVisible();
  });

  // PADI's published entry-level in-water ratio (H-08, src/lib/course-ratios.ts):
  // a solo instructor seats at most 8 students, independent of the trip's own
  // stated capacity. Set the trip's capacity well above 8 so the ratio — not
  // capacity — is what blocks the 9th booking.
  test("a solo-instructor course session refuses a booking past the 8-seat ratio", async ({
    page,
  }) => {
    // Two full booking rounds (6 divers, then 2 more) plus the session setup
    // and a third ratio-refused attempt — same aggregate-cost reasoning as
    // visual.spec.ts's test.setTimeout: many real, sequential steps under
    // 2-worker load add up past the default 15s budget even though no
    // individual step is stuck.
    test.setTimeout(30_000);
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
    await expect(page.getByLabel("Assign crew")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" }); // the seeded instructor
    await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
    const tripUrl = page.url();

    await page.context().clearCookies();
    const stamp = e2eNow().getTime();
    const bookSlots = async (count: number, offset: number) => {
      await page.goto(publicTripUrl(tripUrl));
      const partySize = page.getByLabel("Number of divers");
      await expect(partySize).toHaveAttribute("data-hydrated", "true");
      await partySize.selectOption(String(count));
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
        await emailField.fill(`ratio-${stamp}-${label}@example.com`);
      }
      await acceptAgeAttestation(page);
      await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
      await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toBeVisible();
    };

    // Two party bookings fill the 8-seat ratio (6 + 2); the trip's own
    // capacity (12) still has four seats open.
    await bookSlots(6, 0);
    await bookSlots(2, 6);

    // The 9th diver hits the ratio, not capacity.
    await page.goto(publicTripUrl(tripUrl));
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill(`Ratio Diver ${stamp}-9`);
    await page.getByLabel("Email", { exact: true }).fill(`ratio-${stamp}-9@example.com`);
    await acceptAgeAttestation(page);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
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
    await page.getByLabel("Subhead").fill("Plan every dive to {depth18}");
    await page.getByRole("button", { name: "Save course page" }).click();
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
    await page.getByLabel("Subhead").fill("Plan every dive to {depth 18}");
    await page.getByRole("button", { name: "Save course page" }).click();
    // Filtered, not bare: Next's own route announcer is a `role="alert"` too.
    await expect(page.getByRole("alert").filter({ hasText: "depth markers" })).toContainText(
      "is broken, so nothing saved",
    );

    // Refused means refused: the previously saved sentence is still what a
    // diver reads.
    await page.goto("/s/blue-mantis/courses/wreck-diver");
    await expect(page.getByText(/Plan every dive to/)).toContainText(/(18 meters|60 feet)/);
  });
});

test("a diver with no workable date reaches the shop, and is offered one way to do it", async ({
  page,
}) => {
  // Signed out: this is the composer a prospective diver meets, not staff.
  await page.goto("/s/blue-mantis/courses/open-water-diver");

  const inquiry = page.getByRole("region", { name: "Get in touch" });
  await inquiry.scrollIntoViewIfNeeded();
  await page.getByLabel("Your name").fill("Mira Delgado");
  await page.getByLabel("Your email").fill("mira.delgado.e2e@example.com");
  await page.getByLabel("How many divers").fill("3");
  // One free-text answer, as exact or as loose as the diver wants — the date
  // picker beside it is gone, because a date typed here is a request the shop
  // answers, never a hold the picker implied.
  await page.getByLabel("When suits you").fill("the week of 12 August");
  // The option's value is now the code ("never"), not its rendered label —
  // src/lib/course-inquiry.ts returns codes, and the diver bundle supplies
  // the sentence.
  await page.getByLabel("Where you are up to").selectOption("never");
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

  await inquiry.getByRole("button", { name: "Send inquiry" }).click();
  await expect(inquiry.getByText("Inquiry sent")).toBeVisible();
  await expect(inquiry.getByRole("link", { name: "hello@demo.invalid" })).toBeVisible();
});

test("a blank inquiry is rejected, not defaulted — experience and a way to reply are required", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis/courses/open-water-diver");
  const inquiry = page.getByRole("region", { name: "Get in touch" });
  await inquiry.scrollIntoViewIfNeeded();

  // Nothing filled in: both refusals land at once rather than one after the
  // other, so a diver fixes the form in one pass instead of two.
  await inquiry.getByRole("button", { name: "Send inquiry" }).click();
  await expect(inquiry.getByText("Let us know where you are up to before sending.")).toBeVisible();
  await expect(
    inquiry.getByText("Leave an email or a phone number so we can reply."),
  ).toBeVisible();
  await expect(inquiry.getByText("Inquiry sent")).toHaveCount(0);

  // Experience alone is not enough — a lead with no address and no number is
  // a question nobody can answer.
  await page.getByLabel("Where you are up to").selectOption("never");
  await inquiry.getByRole("button", { name: "Send inquiry" }).click();
  await expect(
    inquiry.getByText("Leave an email or a phone number so we can reply."),
  ).toBeVisible();
  await expect(inquiry.getByText("Inquiry sent")).toHaveCount(0);

  // A phone number on its own clears it: either one, never both.
  await page.getByLabel("Your phone").fill("+1 305 555 0177");
  await inquiry.getByRole("button", { name: "Send inquiry" }).click();
  await expect(inquiry.getByText("Inquiry sent")).toBeVisible();
});

test("a diver's inquiry is recorded server-side and the shop's details stay reachable after sending", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis/courses/open-water-diver");
  const inquiry = page.getByRole("region", { name: "Get in touch" });
  await inquiry.scrollIntoViewIfNeeded();
  await page.getByLabel("Your name").fill("Sena Okafor");
  await page.getByLabel("Your email").fill("sena.okafor.e2e@example.com");
  await page.getByLabel("Your phone").fill("+1 305 555 0199");
  // One diver is already in the box — nobody fills in a field to say the
  // obvious.
  await expect(page.getByLabel("How many divers")).toHaveValue("1");
  await page.getByLabel("When suits you").fill("any weekend this autumn");
  await page.getByLabel("Where you are up to").selectOption("certified");

  await inquiry.getByRole("button", { name: "Send inquiry" }).click();

  // The composer collapses into a confirmation — task 7's server-recorded
  // send, not just the mailto fallback — and still leaves the shop's own
  // contact details on screen underneath it.
  await expect(inquiry.getByText("Inquiry sent")).toBeVisible();
  await expect(inquiry.getByText("hello@demo.invalid")).toBeVisible();
});

/**
 * The public pages' spine. Before this the catalog was structurally
 * unreachable: `publicCoursesPath` was linked only from inside the courses
 * subtree, so a diver who landed on the schedule had no way to discover that
 * the shop teaches anything at all. The header carries the map on every public
 * page, so the walk works from wherever a diver came in.
 */
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
    await first.getByRole("button", { name: "Save course page" }).click();
    await expect(first.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    // The second tab is holding the page as it was before that save.
    await second.locator('[name="summary"]').fill("Saved by the second tab");
    await second.getByRole("button", { name: "Save course page" }).click();

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
    await summary.fill("Half a thought, never saved");
    // The bar says so, pinned to the bottom edge rather than four thousand
    // pixels down where Save used to be the only sign this was a form.
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();

    for (const tab of ["Divers", "Board", "Close-out", "Check-in"]) {
      await page.getByRole("link", { name: tab, exact: true }).first().click();
      await page.waitForURL((candidate) => !candidate.pathname.endsWith("/edit"));
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    }

    // Back the way a person would come back: through the nav, not history.
    await page.locator("header summary").filter({ hasText: "More" }).click();
    await page.getByRole("link", { name: "Courses" }).first().click();
    await page.waitForURL(/\/courses$/);
    await page.getByRole("link", { name: "Discover Scuba Diving" }).first().click();
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
  await page.getByRole("button", { name: "Add a question" }).click();
  await page
    .getByLabel(/^Question \d+$/)
    .last()
    .fill("Do I need my own gear?");

  // Half a pair is refused, and says which half — the old textarea dropped an
  // unanswered question silently, so the writer saved, saw it gone, and had no
  // way to tell whether it had ever been there.
  await page.getByRole("button", { name: "Save course page" }).click();
  await expect(page.getByText("Every question needs an answer")).toBeVisible();
  await expect(page.getByLabel(/^Question \d+$/).last()).toHaveValue("Do I need my own gear?");

  await page.getByLabel("Answer").last().fill("No — every rental is part of the fee.");
  await page.getByRole("button", { name: "Save course page" }).click();
  await expect(page.getByRole("status")).toContainText("Course page saved");

  await page.goto(`/s/${privateShop.slug}/courses/rescue-diver`);
  // The answer is behind its own disclosure, the way a diver meets it.
  await page.getByText("Do I need my own gear?").click();
  await expect(page.getByText("No — every rental is part of the fee.")).toBeVisible();
});
