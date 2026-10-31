import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import {
  daysFromNow,
  e2eNow,
  findTripOnBoard,
  openIfClosed,
  openTripAbout,
  openTripAboutRow,
  openTripMore,
} from "./helpers";

const staffCopy = staffTranslator("en-US");

/**
 * Open one of the briefing's closed sections (visual review 2026-10-24, A11):
 * the site, the dive and certification stand open; every other section is a
 * closed row whose controls still post with Save.
 */
const section = (page: Page, id: string) =>
  // Visible only: the page a save navigated away from can stay mounted,
  // hidden, in an Activity tree, with the same ids.
  page.locator(`details#briefing-${id}`).filter({ visible: true });
const openSection = (page: Page, id: string) => openIfClosed(section(page, id));

test.describe("staff", () => {
  signedInAsOwner();

  test("template replacement shows current values before applying and preserves the one-time Undo", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/dive-sites");
    await page.getByRole("link", { name: "Molasses Reef", exact: true }).first().click();
    const current = await page
      .locator('textarea[name="description"]')
      .filter({ visible: true })
      .inputValue();
    const comparison = page.locator("details#briefing-template").filter({ visible: true });
    await openIfClosed(comparison);
    await expect(
      comparison
        .getByText(staffCopy("diveSites.edit.templateUpdates.current"), { exact: true })
        .first(),
    ).toBeVisible();
    await expect(comparison.getByText(current, { exact: true }).first()).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    const replacement = page.waitForURL(/notice=template-replaced/);
    await comparison
      .getByRole("button", {
        name: staffCopy("diveSites.edit.templateUpdates.replaceCopy"),
        exact: true,
      })
      .click();
    await replacement;
    const undo = page.waitForURL(/notice=template-undone/);
    await page
      .getByRole("button", { name: staffCopy("diveSites.edit.templateUpdates.undo"), exact: true })
      .click();
    await undo;
    await expect(
      page.locator('textarea[name="description"]').filter({ visible: true }),
    ).toHaveValue(current);
  });

  test("staff reuses a dive-site briefing on a trip that divers can explore", async ({
    page: staff,
    browser,
    workerBaseURL,
  }) => {
    let page = staff;
    // Longest single test in this file: create a site, copy it, wire a trip
    // to it, and exercise the crew-prediction flow — each step its own
    // navigation or status-toast wait. Same aggregate-cost reasoning as
    // the visual specs' `test.setTimeout` and role-permissions.spec.ts's
    // captain test: many sequential steps at realistic per-step cost under
    // 2-worker load add up past the default 15s budget even though no
    // individual step is stuck.
    test.setTimeout(30_000);
    const siteName = `Turtle Garden ${e2eNow().getTime()}`;
    const tripTitle = `Turtle Garden charter ${e2eNow().getTime()}`;

    // "Dive sites" now lives in the nav's "More" group; navigate directly.
    await page.goto("/shop/blue-mantis/dive-sites");
    await page.getByRole("link", { name: "Add a dive site" }).click();
    await page.getByLabel("Name").fill(siteName);
    await page.getByRole("textbox", { name: "Location" }).fill("Key Largo");
    await openSection(page, "forecast");
    await page.getByLabel("Latitude").fill("25.123");
    await page.getByLabel("Longitude").fill("-80.321");
    await openSection(page, "underwater");
    await page.getByLabel("What might divers see?").fill("Green turtles · spotted eagle rays");
    await page
      .getByLabel("Underwater briefing")
      .fill("Look along the sandy edge for turtles resting below the coral heads.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Saving lands on the site's own page, whose header is its name.
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();

    await page.goto("/shop/blue-mantis/schedule/board/new?add=full");
    await page.getByLabel("What is it").fill(tripTitle);
    // Dive one's site, by name: expanded, the panel keeps the quick row's
    // single "Dive site" select mounted-but-hidden (so nothing typed is lost on
    // a collapse), and a label match would find that one first.
    await page.locator('select[name="dive-1-siteId"]').selectOption({ label: siteName });
    await page.getByLabel("Date").fill(daysFromNow(5));
    await page.getByLabel("Departs").fill("09:00");
    await page.getByLabel("Returns").fill("12:00");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible(); // created banner ⇒ the redirect settled
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: tripTitle })
      // Exact match: an unpriced trip's card also carries a "Set a price
      // for {title}, ..." link whose accessible name contains the trip
      // title as a substring.
      .getByRole("link", { name: tripTitle, exact: true })
      .click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]+$/);

    // The conditions form waits behind its disclosure (summary-first Overview).
    await openTripAbout(page);
    await openTripAboutRow(page, "Conditions");
    await page
      .getByLabel("Conditions overview")
      .fill("Warm water and an easy morning are expected.");
    await page.getByLabel("Water temp °F").fill("81");
    await page.getByLabel("Visibility ft").fill("60");
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction published");

    // Staff are routed to the trip editor, so read the public diver briefing
    // from a fresh signed-out context.
    const visitorContext = await browser.newContext({ baseURL: workerBaseURL });
    page = makeActivitySafe(await visitorContext.newPage());
    await page.goto("/s/blue-mantis");
    // Scoped to the trip list itself, the page's one stable anchor for
    // departures — day rules and other lists on the page never carry a
    // trip's title.
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: tripTitle })
      .getByRole("link")
      .click();
    // **No tap at all now.** The day's reading is a run of ledger beats rather
    // than a swipeable deck of photo cards behind a door (slice 7c): "The day"
    // names the dives and their sites, and the shop's own words about each site
    // follow it. The site names itself in a `<span>` inside its ledger row, so
    // it is read as text, off the dive list: the log-entry preview under it
    // names the day's sites too.
    await expect(page.getByRole("heading", { name: "The day" })).toBeVisible();
    await expect(
      page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: "The day" }) })
        .getByRole("list")
        .first()
        .getByText(siteName),
    ).toBeVisible();
    // What the staffer typed into "What might divers see?" and "Underwater
    // briefing" above. This is the assertion that matters in this spec: a shop
    // writes a site's briefing once and every departure at that site carries it
    // (ADR 20260813-dive-site-briefings-are-the-shops-own-words).
    // The shop's site prose moved behind the pitch's one door (ADR
    // 20260904-reef-all-the-way-down, decision 1). Nothing is deleted, so the
    // assertion stands exactly as it was — it just opens the door first.
    await page.getByRole("heading", { name: "The rest of the briefing" }).click();
    await expect(page.getByText("Green turtles · spotted eagle rays")).toBeVisible();
    await expect(
      page.getByText("Look along the sandy edge for turtles resting below the coral heads."),
    ).toBeVisible();
    // Each reading is one span carrying its own noun ("27°C water"), so an
    // exact match on the number alone finds nothing. The demo is a Key Largo
    // shop, so both read in its country's units. That the crew's numbers
    // and not the model's are on the page is what the note below asserts.
    await expect(page.getByText("81°F water")).toBeVisible();
    await expect(page.getByText("60 ft visibility")).toBeVisible();
    // **To the minute, not the second.** This line used to build its own
    // timestamp with a bare `toLocaleString`, whose default field set carries
    // seconds — so the sentence a diver reads to decide what to pack said
    // "Updated 8/22/2026, 10:33:06 AM EDT" (issue #799). A forecast is accurate
    // to hours; the timestamp claimed a second.
    // The clause shares its paragraph with the crew note, so this reads the
    // whole sentence rather than anchoring on "Updated".
    const forecastNote = page.getByText(/Forecast supplied by the crew/);
    await expect(forecastNote).toBeVisible();
    const noteText = await forecastNote.innerText();
    expect(noteText).toMatch(/Updated /);
    expect(noteText).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);

    await visitorContext.close();
  });

  test("staff can return a crew prediction to the automated outlook", async ({ page }) => {
    await (await findTripOnBoard(page, "blue-mantis", /Two-Tank Reef/)).click();
    await openTripAbout(page);
    await openTripAboutRow(page, "Conditions");
    await page
      .getByLabel("Conditions overview")
      .fill("Warm water and an easy morning are expected.");
    await page.getByLabel("Water temp °F").fill("81");
    await page.getByLabel("Visibility ft").fill("60");
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction published");

    await page.getByRole("button", { name: "Return to automated outlook" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction cleared");
    // The clear's own notice forces the disclosure open on the redirected
    // render — no click needed (and one would close it again).
    await expect(page.getByLabel("Water temp °F")).toHaveValue("");
    await expect(page.getByLabel("Visibility ft")).toHaveValue("");
  });

  test("staff can cancel and reinstate a departure", async ({ page }) => {
    await (await findTripOnBoard(page, "blue-mantis", /Two-Tank Reef/)).click();
    const more = await openTripMore(page);
    await more.getByRole("button", { name: /Cancel (trip|this departure)/ }).click();
    await more.getByRole("button", { name: "Yes, cancel this departure" }).click();
    await expect(page.getByRole("button", { name: "Reinstate trip" })).toBeVisible();
  });

  test("staff find a site by name or location instead of scrolling the whole library", async ({
    page,
  }) => {
    // Three searches, a clear, and a past-the-end bookmark are five server
    // round-trips with their own settles — the same aggregate-cost reasoning
    // as the tour above, not one slow step.
    test.setTimeout(30_000);
    // The library is one grouped ledger now (ADR 20260827-the-shops-shelves),
    // so a row is a list item on the page rather than a table row. `<main>` is
    // the scope: the staff chrome's own menus sit outside it.
    const library = page.getByRole("main");
    const rows = library.getByRole("listitem");
    // The one search box (`SearchField`): no Search button beside it, so a
    // query is submitted the way a staffer submits it — Enter.
    const search = page.getByLabel("Find a site");

    await page.goto("/shop/blue-mantis/dive-sites");
    // Wait for a real row before counting. `locator.count()` is a one-shot
    // query — alone among Playwright's locator methods it does *not* retry —
    // so on an `instant = true` route it happily counts the `loading.tsx`
    // skeleton's zero rows and moves on. Every later assertion here is
    // auto-waiting; this one line is what makes the first one so too.
    await expect(rows.first()).toBeVisible();
    const seededCount = await rows.count();
    expect(seededCount).toBeGreaterThan(1);

    // A name search narrows the ledger to the one row and says so in the URL,
    // so a found site is a link a staffer can send to a colleague.
    await search.fill("spiegel");
    await search.press("Enter");
    await expect(page).toHaveURL(/\?q=spiegel/);
    await expect(rows).toHaveCount(1);
    await expect(library.getByRole("link", { name: "Spiegel Grove", exact: true })).toBeVisible();
    // The site's cert gate reads as the word staff use everywhere else in the
    // app — not the raw `advanced_open_water` enum with its underscores swapped
    // for spaces, which is what this badge rendered before. `exact: true` is
    // what makes this a regression test rather than a tautology: it is
    // case-sensitive and whole-string, so the old lower-case "advanced open
    // water" fails it. (A bare `getByText` would not — Playwright's default is
    // a case-insensitive substring match, and the old rendering passes that.)
    //
    // Whole-string also pins the shape the ledger gave these: the level word
    // (above Open Water, so it speaks) and the specialty word, joined — where
    // the table wore a level badge beside a "1 required specialty" count that
    // never named the specialty.
    await expect(library.getByText("Advanced Open Water · Deep", { exact: true })).toBeVisible();

    // Location is searchable too: "Dry Rocks" appears in no site's *name*.
    await search.fill("dry rocks");
    await search.press("Enter");
    await expect(rows).toHaveCount(1);
    await expect(
      library.getByRole("link", { name: "Christ of the Abyss", exact: true }),
    ).toBeVisible();

    // A search that matches nothing says so rather than showing the library's
    // "start your first site" pitch to a shop that already has seven.
    await search.fill("nowhere in particular");
    await search.press("Enter");
    await expect(page.getByText("No sites match that search")).toBeVisible();
    await expect(page.getByText("Start with a site your crew knows well")).toHaveCount(0);

    // And there is always a way back to the whole library.
    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/dive-sites$/);
    await expect(rows).toHaveCount(seededCount);
    await expect(search).toHaveValue("");
    await expect(page.getByRole("link", { name: "Clear search" })).toHaveCount(0);

    // One screenful of sites is never told it is on "page 1 of 1"; the pager
    // only exists when there is somewhere to go. (`src/db/dive-sites.test.ts`
    // pins the paging arithmetic at real volume — seeding 25 sites into the
    // demo shop to make a pager appear here would distort every other surface
    // that reads the library.)
    await expect(page.getByRole("navigation", { name: "Dive-site pages" })).toHaveCount(0);
    // A stale bookmark past the end lands on the last real page. It used to
    // render an empty list under a heading that could not be true, which is
    // what `offsetPage` exists to stop (ADR 20260803-one-pagination-model);
    // the library reads through it now like every other paged staff list.
    await page.goto("/shop/blue-mantis/dive-sites?page=99");
    await expect(page.getByRole("heading", { level: 1, name: "Dive-site library" })).toBeVisible();
    await expect(rows).toHaveCount(seededCount);
  });

  test("a site with no location yet says so instead of leaving the line blank", async ({
    page,
  }) => {
    // `{site.locationName ?? "Location to add"}` was the one hard-coded English
    // string left on this page — the key existed in both bundles and was simply
    // never wired up, so a Spanish-locale shop read one English line among the
    // translated cards.
    const siteName = `Unplaced Ledge ${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/dive-sites/new");
    await page.getByLabel("Name").fill(siteName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();

    await page.goto(`/shop/blue-mantis/dive-sites?q=${encodeURIComponent(siteName)}`);
    const row = page.getByRole("main").getByRole("listitem");
    await expect(row).toHaveCount(1);
    // Once, on the row's one meta line — the ledger has no second, phone-only
    // copy of it the way the table's folded Location column did.
    await expect(row.getByText("Location to add")).toBeVisible();
  });

  test("Save says what is unsaved in a briefing", async ({ page }) => {
    // ADR 20260827-the-shops-shelves, the long-form editor pattern: one Save
    // that says what it still owes. The rail beside it is gone (visual review
    // 2026-10-24, A11): the sections edited every time stand open and the rest
    // are closed rows, so there is no four-thousand-pixel page to find a place in.
    await page.goto("/shop/blue-mantis/dive-sites");
    await page.getByRole("link", { name: "Molasses Reef", exact: true }).first().click();
    await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
    await expect(page.getByRole("navigation", { name: "Sections", exact: true })).toHaveCount(0);

    // Nothing typed, nothing claimed.
    await expect(page.getByText(/Unsaved changes/)).toHaveCount(0);
    await expect(page.locator("form[data-hydrated]")).toHaveCount(1);

    // A closed row opens from its fragment, so a link to one still lands.
    await page.goto(`${page.url().split("#")[0]}#briefing-photos`);
    await expect(section(page, "photos")).toHaveAttribute("open", "");
    await expect(page.locator("form[data-hydrated]")).toHaveCount(1);

    // One edit names its section by name; a second stops naming and counts.
    await page
      .getByRole("textbox", { name: "Location" })
      .fill("Key Largo National Marine Sanctuary");
    await expect(page.getByText("Unsaved changes in The site")).toBeVisible();
    await page.getByLabel("Depth note").fill("Shallow ledge, then the wall");
    await expect(page.getByText("Unsaved changes in 2 sections")).toBeVisible();
  });

  test("a shop draws the route it swims, and a diver reads it on the briefing", async ({
    page,
  }) => {
    // The whole point of the feature (ADR 20260809-shop-drawn-dive-routes): a
    // route used to be hand-authored SVG keyed by site name, so only DiveDay's
    // three demo sites could have one. This walks a shop's own site from no
    // route to a drawn one.
    test.setTimeout(30_000);
    const siteName = `Drawn Ledge ${e2eNow().getTime()}`;
    const tripTitle = `Drawn Ledge charter ${e2eNow().getTime()}`;

    await page.goto("/shop/blue-mantis/dive-sites/new");
    await page.getByLabel("Name").fill(siteName);
    // No coordinates yet: there is no frame to draw on, and the editor says so
    // rather than showing a map centred on a guess.
    await openSection(page, "route");
    await expect(page.getByText(/Fill in the GPS location above/)).toBeVisible();

    await openSection(page, "forecast");
    await page.getByLabel("Latitude").fill("25.101");
    await page.getByLabel("Longitude").fill("-80.404");
    // Typing the pair is enough — the frame follows the boxes, so a brand-new
    // site is drawable without a save-and-come-back round trip.
    const map = page.getByRole("button", {
      name: "Map — click to add a route waypoint",
    });
    await expect(map).toBeVisible();
    await expect(page.getByText("Click where the dive starts.")).toBeVisible();

    await map.click({ position: { x: 60, y: 200 } });
    await expect(page.getByText(/One waypoint down/)).toBeVisible();
    await map.click({ position: { x: 200, y: 90 } });
    await map.click({ position: { x: 340, y: 210 } });
    await expect(page.getByText(/^3 waypoints/)).toBeVisible();

    // Undo takes back exactly the last point, which is the control staff reach
    // for most while drawing.
    await page.getByRole("button", { name: "Undo point" }).click();
    await expect(page.getByText(/^2 waypoints/)).toBeVisible();
    await map.click({ position: { x: 340, y: 210 } });

    await page.getByLabel("What the route is called").fill("Ledge and back");
    await page
      .getByLabel("One line about the route")
      .fill("Out along the ledge, home over the sand.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: siteName })).toBeVisible();

    // Saved, and read back on the form: the route survives the round trip
    // rather than being a drawing that only existed in the browser. The saved
    // page opens on its everyday sections, so the route's row opens first.
    await openSection(page, "route");
    await expect(page.getByLabel("What the route is called")).toHaveValue("Ledge and back");
    await expect(page.getByText(/^3 waypoints/)).toBeVisible();

    // And it reaches the diver, which is the only reason to draw it.
    await page.goto("/shop/blue-mantis/schedule/board/new?add=full");
    await page.getByLabel("What is it").fill(tripTitle);
    // By name, like the flow above: the collapsed quick row keeps its own
    // "Dive site" select mounted, so a label match finds the wrong one.
    await page.locator('select[name="dive-1-siteId"]').selectOption({ label: siteName });
    await page.getByLabel("Date").fill(daysFromNow(5));
    await page.getByLabel("Departs").fill("09:00");
    await page.getByLabel("Returns").fill("12:00");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible(); // created banner ⇒ the redirect settled

    // Reach the diver's page by the trip's own id, taken off the board — the
    // public schedule pages a busy seeded board by month, so a departure five
    // days out is not reliably on its first screen.
    await page.goto("/shop/blue-mantis/schedule/board");
    await page
      .locator("li")
      .filter({ hasText: tripTitle })
      .getByRole("link", { name: tripTitle, exact: true })
      .click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/trips\/[0-9a-f-]+$/);
    const tripId = page.url().split("/").pop();
    await page.goto(`/s/blue-mantis/trips/${tripId}`);
    // The drawn route is one of the five beats behind the pitch's door.
    await page.getByRole("heading", { name: "The rest of the briefing" }).click();
    await expect(page.getByText("Ledge and back")).toBeVisible();
    await expect(page.getByText("Out along the ledge, home over the sand.")).toBeVisible();
    // The e2e context refuses the map's reachability probe (fixtures.ts), so
    // the frame keeps its box but stays hidden and the route draws alone, the
    // way the page reads on a boat with no signal (MapFrame).
    const terrain = page.locator("figure [data-map-reachable]");
    await expect(terrain).toHaveAttribute("data-map-reachable", "false");
    await expect(terrain).toBeHidden();
  });

  test("a half-entered GPS location is named as the reason, and nothing typed is lost", async ({
    page,
  }) => {
    // Both legs of the same bug (R4). A rejected briefing used to
    // `redirect(?error=invalid)`, which re-rendered ~20 fields blank and said
    // "check the required name and links" — while the name was fine and the
    // real rejection was the both-coordinates-or-neither rule, which that
    // sentence names nowhere. The form now stays put, keeps every value, and
    // the banner names the rule that actually refused it.
    test.setTimeout(30_000);
    const siteName = `Half Point ${e2eNow().getTime()}`;

    await page.goto("/shop/blue-mantis/dive-sites/new");
    await page.getByLabel("Name").fill(siteName);
    await page.getByRole("textbox", { name: "Location" }).fill("Key Largo");
    await openSection(page, "underwater");
    await page.getByLabel("What might divers see?").fill("Green turtles");
    await openSection(page, "forecast");
    await page.getByLabel("Latitude").fill("25.123"); // …and no longitude.
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Not `getByRole("alert")` — Next's own route announcer is one too.
    const refusal = page.getByText(/Add both GPS coordinates/);
    await expect(refusal).toBeVisible();
    // …and *inside the form*, not in a banner above twenty fields. The refusal
    // used to render above the whole briefing, a full screen from the Save
    // button that had just been pressed, so a refused save looked like a
    // button that did nothing.
    await expect(page.locator("form").filter({ has: refusal })).toHaveCount(1);
    // The whole point: still on the form, still filled in.
    await expect(page).toHaveURL(/\/dive-sites\/new$/);
    await expect(page.getByLabel("Name")).toHaveValue(siteName);
    await expect(page.getByRole("textbox", { name: "Location" })).toHaveValue("Key Largo");
    await expect(page.getByLabel("What might divers see?")).toHaveValue("Green turtles");
    await expect(page.getByLabel("Latitude")).toHaveValue("25.123");

    // Completing the pair is all it takes — no retyping.
    await page.getByLabel("Longitude").fill("-80.321");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: siteName })).toBeVisible();

    // The edit form shares the shape, and so does the fix.
    await openSection(page, "forecast");
    await page.getByLabel("Longitude").fill("");
    await openSection(page, "underwater");
    await page.getByLabel("Underwater briefing").fill("Turtles rest below the coral heads.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Not `getByRole("alert")` — Next's own route announcer is one too.
    await expect(page.getByText(/Add both GPS coordinates/)).toBeVisible();
    await expect(page.getByLabel("Underwater briefing")).toHaveValue(
      "Turtles rest below the coral heads.",
    );
    await expect(page.getByLabel("Latitude")).toHaveValue("25.123");
  });

  test("a name the shop already uses is refused on the form, not as an error page", async ({
    page,
  }) => {
    // The same shape as the GPS rule above, for the one rule the form's parse
    // cannot check — `dive_sites_shop_name_unique`. A production save of an
    // already-held name on 2026-08-14 threw the raw 23505 out of the action:
    // a 500 error page, and the whole briefing gone with it.
    test.setTimeout(30_000);
    const taken = `Twin Ledges ${e2eNow().getTime()}`;

    await page.goto("/shop/blue-mantis/dive-sites/new");
    await page.getByLabel("Name").fill(taken);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: taken })).toBeVisible();

    // A second site reaching for the same name gets an answer, not a stack.
    await page.goto("/shop/blue-mantis/dive-sites/new");
    await page.getByLabel("Name").fill(taken);
    await page.getByRole("textbox", { name: "Location" }).fill("Key Largo");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Not `getByRole("alert")` — Next's own route announcer is one too.
    const refusal = page.getByText(/already goes by that name/);
    await expect(refusal).toBeVisible();
    await expect(page.locator("form").filter({ has: refusal })).toHaveCount(1);
    // Still on the form, still filled in — a rename is all it takes.
    await expect(page).toHaveURL(/\/dive-sites\/new$/);
    await expect(page.getByRole("textbox", { name: "Location" })).toHaveValue("Key Largo");
    await page.getByLabel("Name").fill(`${taken} south`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: `${taken} south` })).toBeVisible();
  });

  test("staff import a DiveDay catalog site and it lands in the shop's own library", async ({
    page,
  }) => {
    // The catalog (`/shop/[shopSlug]/dive-sites/catalog`) shipped with no e2e
    // or visual coverage — found by the 2026-08-03 test-system evaluation,
    // which is why scripts/route-coverage.json carried an exemption for it
    // until this test landed.
    //
    // The seed publishes one global template, Molasses Reef, currently at v3,
    // and the demo shop already holds a copy imported at v1 — so the library
    // opens offering an update, and importing again makes a *second,
    // independent* site rather than overwriting the tailored one. That
    // independence is the whole promise the catalog page makes.
    //
    // The imported site lands as "Molasses Reef 2": `dive_sites_shop_name_unique`
    // is a hard (shop_id, name) index and an import can't choose its own name,
    // so `importGlobalDiveSiteTemplate` disambiguates the way the "Copy and
    // tailor" action does. Before that, this exact button — the catalog's only
    // action, on the state every demo shop ships in — raised an unhandled 23505
    // and crashed the page into its error boundary.
    // The library is one grouped ledger now (ADR 20260827-the-shops-shelves),
    // so a site is named by its row's own stretched link rather than by a
    // table cell or a card's `<h2>`.
    const library = page.getByRole("main");
    const existing = library.getByRole("link", { name: "Molasses Reef", exact: true });
    const imported = library.getByRole("link", { name: "Molasses Reef 2", exact: true });
    // What a staffer can act on is the only provenance left on the library: the
    // `◆`/`◇` glyph pair and the adopted-version line went back to the site
    // page. `.first()` stays because the assertion is "the library is offering
    // an update", not "exactly one row is".
    const updateReady = library
      .getByText(staffCopy("diveSites.list.templateUpdateReady"), { exact: true })
      .first();

    await page.goto("/shop/blue-mantis/dive-sites");
    await expect(existing).toHaveCount(1);
    await expect(imported).toHaveCount(0);
    await expect(updateReady).toBeVisible();
    // A site sitting at the published version says nothing about where it came
    // from — that is the site page's line, not the library's.
    await expect(library.getByText(/DiveDay template v/)).toHaveCount(0);

    // The catalog is a door above the library, carrying the size of what
    // sits behind it; the header's secondary action retired with its arrival,
    // so there is exactly one way in from here.
    const catalogDoor = page.getByRole("link", { name: "Browse the DiveDay catalog" });
    await expect(catalogDoor).toHaveCount(1);
    await expect(page.getByText(/\d+ published sites/)).toBeVisible();
    await catalogDoor.click();
    await expect(
      page.getByRole("heading", { level: 1, name: "DiveDay common dive sites" }),
    ).toBeVisible();
    // By the row's own name, exactly: other templates' prose mentions Molasses
    // Reef too (Sand Island sits beside it), so a substring match finds two.
    const template = page
      .locator("li")
      .filter({ has: page.getByText("Molasses Reef", { exact: true }) })
      .filter({ visible: true });
    await expect(template.getByText("Template v3")).toBeVisible();

    await expect(template.getByRole("button", { name: "Import to my library" })).toHaveCount(0);
    await template.getByRole("link", { name: "Molasses Reef", exact: true }).click();
    await expect(page).toHaveTitle("Molasses Reef — DiveDay");
    await page.getByRole("button", { name: "Import to my library" }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/dive-sites\/[0-9a-f-]+/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Molasses Reef 2", exact: true }),
    ).toBeVisible();

    await expect(page).toHaveTitle("Molasses Reef 2 — DiveDay");
    await page.getByRole("main").getByRole("link", { name: "Dive sites", exact: true }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/dive-sites$/);
    // Both sites now: the new one states the version it came from, while the
    // shop's own tailored v1 copy is untouched and still offered the update.
    await expect(existing).toHaveCount(1);
    await expect(imported).toHaveCount(1);
    await expect(updateReady).toBeVisible();
  });

  // The SSRF check this used to exercise has no dive-site caller left: photos
  // are uploaded from the staffer's own device now, so there is no pasted URL
  // for the server to fetch (2026-08-12 amendment to
  // ADR 20260724-dive-site-media-ingestion). `ingestImageUrl` and every
  // defense in it survive for contact-import waiver documents, which really do
  // arrive as URLs in a CSV, and are covered by
  // src/lib/storage/ingest-url.test.ts.
  test("the briefing takes photos as files, never as a pasted link", async ({ page }) => {
    await page.goto("/shop/blue-mantis/dive-sites/new");
    // Three file inputs — map still, route still, and the gallery — and not one
    // box asking for a URL. They sit in the closed Photos row.
    await openSection(page, "photos");
    await expect(page.getByLabel("Map still")).toHaveAttribute("type", "file");
    await expect(page.getByLabel("Route still")).toHaveAttribute("type", "file");
    await expect(page.getByLabel(/Site photos/)).toHaveAttribute("type", "file");
    await expect(page.getByLabel(/image URL/i)).toHaveCount(0);
  });

  /**
   * **Two staffers with the same briefing open.**
   *
   * This form posts its *whole* page — twenty-odd fields, the landmark list,
   * the field guide, the drawn route — so the second save does not overwrite
   * one field between them: it reverts every section to whatever the row held
   * when that tab opened. It did that silently until issue #820, and the first
   * writer's afternoon was gone with no record it had existed.
   */
  test("a shop writes what it wants to remember about running a site, and takes it back", async ({
    page,
  }) => {
    // Issue #1204. The note is staff-only, it rides the site list while it is
    // recent, and it never reaches a diver — the last of which is the one the
    // whole feature turns on.
    await page.goto("/shop/blue-mantis/dive-sites");
    await page.getByRole("link", { name: "Molasses Reef", exact: true }).first().click();
    await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
    const site = new URL(page.url()).pathname;

    const note = page.getByLabel("What to remember about running this site");
    // Typed only once React owns the form: an edit that lands mid-hydration
    // can lose its selection and save the note minus its first letter.
    await expect(page.locator("form[data-hydrated]")).toHaveCount(1);
    await openSection(page, "planning");
    await expect(note).toHaveValue("");
    await note.fill("The mooring ball moved south. Brief the swim-through first.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Wait for the save's own redirect, not for the field. Every other save in
    // this file lands on a *new* site, so waiting for its heading proves the
    // round trip; this one edits a site that is already open, whose heading and
    // whose typed-in field both read the same before the save as after. A
    // `toHaveValue` here passes the instant `fill` returns and synchronizes
    // nothing, so the navigation below used to race the action — green on a
    // quiet machine, red on a loaded CI runner (Playwright shard 1/4,
    // 2026-09-09). `revalidateAndRedirect` lands on `?notice=saved`, which is
    // true only once the write has happened.
    await page.waitForURL(/[?&]notice=saved/);
    // The form settles in place — the note it was given is what it reads back.
    // Read off the box inside its row, which a save leaves closed: opening it
    // again only to read would spend this test's budget on an animation.
    const storedNote = () => section(page, "planning").locator('textarea[name="planningNote"]');
    await expect(storedNote()).toHaveValue(
      "The mooring ball moved south. Brief the swim-through first.",
    );

    // And the library row now carries it.
    await page.goto("/shop/blue-mantis/dive-sites");
    await page.getByRole("heading", { level: 1, name: "Dive-site library" }).waitFor();
    await expect(
      page.getByText("The mooring ball moved south. Brief the swim-through first."),
    ).toBeVisible();

    // And nowhere a diver looks. The public briefing reads the same row. Read
    // as the response body rather than a rendered page: stricter (the note
    // must not ride the payload either, not just stay off the screen) and a
    // second off the run, which kept this test at its budget's edge on a
    // loaded runner (Playwright shard 6/6, PR #2918).
    const publicPage = await page.request.get("/s/blue-mantis");
    expect(publicPage.ok()).toBe(true);
    expect(await publicPage.text()).not.toContain("The mooring ball moved south");

    // Taking it back takes it off the row. The library is still the page on
    // screen (the public check above was a request, not a navigation), so its
    // link is the cheapest way back to the site (issue #2366).
    await page.getByRole("link", { name: "Molasses Reef", exact: true }).first().click();
    await page.waitForURL((url) => url.pathname === site);
    await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
    const cleared = page.getByLabel("What to remember about running this site");
    await expect(page.locator("form[data-hydrated]")).toHaveCount(1);
    await openSection(page, "planning");
    await cleared.fill("");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Same reason, and worse here: the field is empty before the save too, so
    // this is the assertion that raced.
    await page.waitForURL(/[?&]notice=saved/);
    await expect(storedNote()).toHaveValue("");
    // The library row no longer carries it, read the same way as the public
    // page above: the row was proven on screen once already.
    const library = await page.request.get("/shop/blue-mantis/dive-sites");
    expect(library.ok()).toBe(true);
    const libraryHtml = await library.text();
    expect(libraryHtml).toContain("Dive-site library");
    expect(libraryHtml).not.toContain("The mooring ball moved south");
  });

  test("a second tab's save is refused rather than reverting the first", async ({
    page,
    context,
  }) => {
    const siteName = `Two Tabs Reef ${e2eNow().getTime()}`;
    const first = page;
    await first.goto("/shop/blue-mantis/dive-sites/new");
    await first.getByLabel("Name").fill(siteName);
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(first.getByRole("heading", { name: siteName })).toBeVisible();
    const url = first.url();

    // Both tabs load the briefing *before* either saves — the whole premise.
    const second = makeActivitySafe(await context.newPage());
    await second.goto(url);
    const secondNote = second.getByLabel("What makes this site special?");
    await expect(secondNote).toBeVisible();

    await first.getByLabel("What makes this site special?").fill("Written by the first tab");
    await first.getByRole("button", { name: "Save", exact: true }).click();
    await expect(first.getByText("Dive site saved")).toBeVisible();

    // The second tab is still holding the generation it opened with.
    await secondNote.fill("Written by the second tab");
    await second.getByRole("button", { name: "Save", exact: true }).click();

    // Refused, and it says so.
    await expect(second.getByText(/Somebody else changed this briefing/)).toBeVisible();
    // **And what they typed is still in the box** — the point of refusing
    // rather than redirecting, which re-renders the form from the database and
    // so is itself what loses the work the message says was not lost.
    await expect(secondNote).toHaveValue("Written by the second tab");

    // The first writer's briefing survived.
    await first.reload();
    await expect(first.getByLabel("What makes this site special?")).toHaveValue(
      "Written by the first tab",
    );
  });
});

test("the dive-site catalog is staff-only", async ({ page }) => {
  // The catalog's only gate is `requireStaffSession()`: any staff role may
  // browse and import, and there is no owner/manager split on this route.
  // Signed out, the staff gate sends an anonymous visitor to sign in.
  await page.goto("/shop/blue-mantis/dive-sites/catalog");
  await expect(page).toHaveURL(/\/sign-in/);
});

/**
 * **What a diver reads about the day's sites, after slice 7c took the deck
 * away.**
 *
 * Until 2026-08-28 this was two long tests over `DiveBriefingsSection` — a
 * terrain map, a route line, landmark folds, a field-guide door and a
 * comparison table, all rendered on the thread. ADR
 * 20260827-the-divers-thread moved the pitch to the trip page and left the
 * thread as prep only (decision 2 and 3), and its SPEC's 7c line deletes the
 * deck; with no renderer left, the deck's components went with it (H-49).
 *
 * What survives, and what these two tests now pin, is the claim that outlives
 * any one layout: **the shop picks the faces, DiveDay writes the words, and
 * the reader's own language decides which words** (ADR
 * 20260813-marine-life-is-diveday-copy). The row stores a slug, so the same
 * saved guide reads in English for one visitor and in Spanish for the next —
 * which under the old copy-at-pick-time model was impossible.
 */
test("the day's field guide reads in the shop's own picks, in English", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();
  // The pitch page, before any seat is taken: "is this my day?" is answered
  // here, and preparation waits for a diver who has one. Three of the shop's
  // picks lead as tiles and the rest are behind one door (ADR
  // 20260904-reef-all-the-way-down, decision 1), so the door is opened and the
  // whole guide read from inside it — which is also what proves the door works
  // with the words it is holding.
  await page.getByRole("heading", { name: "The rest of the briefing" }).click();
  await expect(page.getByRole("heading", { name: "Look for" })).toBeVisible();
  await expect(page.getByText("Stoplight parrotfish").first()).toBeVisible();
  await expect(page.getByText("Grooved brain coral").first()).toBeVisible();
});

test("the same saved field guide reads in Spanish for a Spanish-speaking diver", async ({
  page,
}) => {
  // Nothing about the site changes between this test and the one above it --
  // same shop, same seeded rows, same species. What changes is who is reading.
  // The choice is a cookie rather than a URL (`LOCALE_COOKIE`, ADR
  // 20260812-reader-chosen-language), so it is set directly here.
  await page.goto("/s/blue-mantis");
  await page.context().addCookies([{ name: "diveday_locale", value: "es-ES", url: page.url() }]);
  await page.reload();
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();
  await page.getByRole("heading", { name: "El resto del briefing" }).click();
  await expect(page.getByRole("heading", { name: "Busca" })).toBeVisible();
  await expect(page.getByText("Loro semáforo").first()).toBeVisible();
  await expect(page.getByText("Coral cerebro surcado").first()).toBeVisible();
  await expect(page.getByText("Stoplight parrotfish")).toHaveCount(0);
});

// Signed in through the worker's cached owner session rather than the sign-in
// form: two sign-ins through the UI were seconds of each test's 15-second
// budget spent on something no assertion here is about (issue #2366).
test.describe("an owner's own library", () => {
  signedInAsOwner();

  test("a shop writes its own landmarks and picks its own field guide", async ({ page }) => {
    await page.goto("/shop/blue-mantis/dive-sites");
    // Pickles Reef is the seeded site with an empty field guide — the state a
    // real shop's brand-new site is in, and the one this form had no way out of
    // until the picker existed.
    await page
      .getByRole("link", { name: /Pickles Reef/ })
      .first()
      .click();
    await page.waitForURL(/\/dive-sites\/[0-9a-f-]{36}/);

    // Pick a species from DiveDay's catalog. The card is a preview, not a form:
    // the name, the category and the sentence are DiveDay's, written in every
    // language and resolved for whoever reads the briefing (ADR
    // 20260813-marine-life-is-diveday-copy). What the shop chooses is which
    // faces this site shows, and in what order.
    const guide = section(page, "field-guide");
    await openSection(page, "field-guide");
    await page.getByLabel("Find a species").fill("Hogfish");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(guide.getByText("Pez perro")).toHaveCount(0);
    await expect(guide.getByText("Hogfish")).toBeVisible();
    await expect(guide.getByText("Reef fish")).toBeVisible();
    // Nothing on the card can be typed into.
    await expect(guide.getByRole("textbox", { name: "Category" })).toHaveCount(0);

    // A species DiveDay has no words for is refused rather than added blank —
    // half a translated guide reads worse than one species fewer. The refusal is
    // a door rather than a dead end: the ask lands in `marine_life_requests`,
    // which is how DiveDay decides what the catalog grows by next.
    await page.getByLabel("Find a species").fill("Pygmy seahorse");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(guide.getByText(/Not in DiveDay’s catalog/)).toBeVisible();
    await page.getByRole("button", { name: "Tell DiveDay about it" }).click();
    await expect(guide.getByText(/we have noted Pygmy seahorse/)).toBeVisible();

    // A landmark, with the shop's own note on it. Pickles Reef ships with two, so
    // the new row is the last one — `.last()` throughout, and the round-trip
    // assertions below read that same row back after the save.
    await openSection(page, "landmarks");
    await page.getByRole("button", { name: "Add a landmark" }).click();
    // The section is a closed row named for what it holds (visual review
    // 2026-10-24, A11).
    const landmarks = section(page, "landmarks");
    await landmarks.getByRole("textbox", { name: "Landmark" }).last().fill("The barrel casks");
    await landmarks
      .getByRole("textbox", { name: "What to say about it" })
      .last()
      .fill("Cement that hardened in its barrels and outlasted the ship.");
    await landmarks.getByLabel("What kind").last().selectOption("reefHistory");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Dive site saved")).toBeVisible();

    // Round-trips: the chosen species and the landmark come back as the shop
    // left them, and the refused one never landed.
    await openSection(page, "field-guide");
    await expect(guide.getByText("Hogfish")).toBeVisible();
    await expect(guide.getByText(/Pygmy seahorse/)).toHaveCount(0);
    await openSection(page, "landmarks");
    await expect(landmarks.getByRole("textbox", { name: "Landmark" }).last()).toHaveValue(
      "The barrel casks",
    );
    await expect(landmarks.getByLabel("What kind").last()).toHaveValue("reefHistory");
  });

  test("a template can be read in full before it is imported", async ({ page }) => {
    // Journey L5 of the shelves canvas, from its first step: the catalog is
    // reached through the door at the library ledger's tail (ADR
    // 20260827-the-shops-shelves), never a peer destination.
    await page.goto("/shop/blue-mantis/dive-sites");
    await page.getByRole("link", { name: "Browse the DiveDay catalog" }).click();
    await expect(page).toHaveURL(/\/dive-sites\?view=catalog$/);
    // The catalog pages, ordered by distance — this one is on the first page and
    // carries both of the things a one-tap import used to hand a shop sight
    // unseen: a cert gate, and a field guide. The row **is** the preview door
    // now, so it is the row's own link that opens it rather than a button beside
    // an Import the shop had not decided on yet.
    // The row's stretched link sits behind the separate Import button. In the
    // narrower catalog column, the link's geometric midpoint falls inside
    // that button, so click the title end of its own link target.
    await page.getByRole("link", { name: "Eagle Wreck", exact: true }).click({
      position: { x: 24, y: 20 },
    });
    await page.waitForURL(/template=eagle-wreck/);

    await expect(page.getByRole("heading", { name: "Eagle Wreck", level: 1 })).toBeVisible();
    await expect(page.getByText("Advanced Open Water")).toBeVisible();
    await expect(page.getByText("Wheelhouse and mast")).toBeVisible();
    await expect(page.getByRole("img", { name: "Goliath grouper" })).toBeVisible();

    await page.getByRole("button", { name: "Import to my library" }).click();
    await page.waitForURL(/\/dive-sites\/[0-9a-f-]{36}/);
    // The field guide came with it — a template that arrived without one left a
    // shop to retype the half of the briefing it could not see.
    await openSection(page, "field-guide");
    await expect(
      page.locator('fieldset:has-text("Field guide")').getByText("Goliath grouper"),
    ).toBeVisible();

    // L5's last step: the site is now a row in her own ledger, filed under the
    // difficulty the template published, and its words are hers to edit.
    await page.getByRole("main").getByRole("link", { name: "Dive sites", exact: true }).click();
    await expect(page).toHaveURL(/\/dive-sites$/);
    const row = page.getByRole("link", { name: "Eagle Wreck", exact: true });
    await expect(row).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: "Advanced" })).toBeVisible();
    // Advanced Open Water is above the floor, so the row says so; a site asking
    // only for Open Water says nothing at all (pinned in
    // `SiteLibraryLedger.test.tsx`).
    await expect(page.getByText(/Advanced Open Water/).first()).toBeVisible();
  });
});

/**
 * **The implausible-station advisory, and the box that answers it** (issue
 * #1772).
 *
 * Until this spec nothing the fleet ran could reach either. `fixtureTideStation`
 * (`src/lib/tide-stations.ts`) answers Carysfort Reef for *every* seven-digit
 * id — one station for every id is what keeps the fleet deterministic with
 * NOAA unreachable — and Carysfort is nineteen to twenty-nine kilometres from
 * the demo's Key Largo sites, well inside the 40 km threshold. So
 * `checkStationAgainstSite` could only ever answer `far: false`, and the only
 * coverage was jsdom tests that hand `SiteFields` an echo object and therefore
 * never exercise a save.
 *
 * The distance comes from the *site*, not the station: the seeded Flower
 * Garden Banks point is about 1,400 km from Carysfort, which is the genuinely
 * remote case ADR 20260907-noaa-tide-predictions names when it argues the
 * advisory has to be answerable at all. Seeded through
 * `/api/test/seed-trouble-states` rather than into blue-mantis, because a demo
 * dive-site list with a standing warning on it is a worse demo
 * (`.claude/rules/surfaces.md`).
 *
 * The round trip is the point. Warning → tick → save → gone, then edit the id
 * → save → back: each leg goes through the real writer, which is the path
 * `src/db/dive-sites.test.ts` pins at the database and nothing pinned through
 * the form.
 */
test.describe("a site whose station is nowhere near it", () => {
  signedInAsOwner();

  test("warns about the distance, stops once the shop says it meant it, and asks again when the id changes", async ({
    page,
    request,
  }) => {
    // Four saves, each its own navigation and status wait — the same
    // aggregate-cost reasoning as the long test at the top of this file.
    test.setTimeout(30_000);
    const seeded = await request.post("/api/test/seed-trouble-states?farStation=1");
    expect(seeded.ok()).toBe(true);
    const { farStation } = (await seeded.json()) as {
      farStation?: { siteId: string; name: string; slug: string };
    };
    if (!farStation) throw new Error("seed-trouble-states seeded no far-station site");
    const siteUrl = `/shop/blue-mantis/dive-sites/${farStation.siteId}`;

    // The advisory, on a real row rather than a handed-in echo object.
    await page.goto(siteUrl);
    await openSection(page, "forecast");
    await expect(page.getByLabel("NOAA tide station")).toHaveValue("8771450");
    await expect(page.getByText(/so the turn it predicts can reach this water/)).toBeVisible();

    // The shop says it meant that station. The id is unchanged, so the answer
    // is about the pairing the row already holds.
    await page.getByRole("checkbox", { name: "This is the right station for this site" }).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Dive site saved").waitFor();
    await openSection(page, "forecast");

    // Gone — and the box stays on the page, ticked, so the shop can take the
    // answer back. A tick that hides its own control is an answer nobody can
    // revise.
    await expect(page.getByText(/so the turn it predicts can reach this water/)).toHaveCount(0);
    await expect(
      page.getByRole("checkbox", { name: "This is the right station for this site" }),
    ).toBeChecked();

    // A different station is a different pairing, so the answer does not carry
    // over and the question is put again.
    await page.getByLabel("NOAA tide station").fill("8723583");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Dive site saved").waitFor();
    await openSection(page, "forecast");
    await expect(page.getByText(/so the turn it predicts can reach this water/)).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "This is the right station for this site" }),
    ).not.toBeChecked();
  });
});

/**
 * **The other half of `dive_sites.csv`** (issue #1771). The export bundled the
 * shop's whole library, and three comments in and around it described a shop
 * exporting and re-importing, while nothing in the tree could read one back.
 *
 * A shop of its own: this writes to the library, which the per-test reset does
 * not put back.
 */
test("staff read a dive_sites.csv back into the library", async ({ page, privateShop }) => {
  await page.goto(`/shop/${privateShop.slug}/settings/import?what=dive-sites`);
  await expect(
    page
      .getByRole("navigation", { name: "What to import" })
      .getByRole("link", { name: "Dive sites" }),
  ).toHaveAttribute("aria-current", "page");

  // A subset of the bundle's columns, which is what a shop that trimmed its
  // copy hands over — only `name` is required, and a column that is not there
  // says nothing rather than blanking a field.
  await page.getByLabel("Choose CSV files").setInputFiles({
    name: "dive_sites.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,location_name,description,difficulty_level,requires_nitrox\n" +
        '"Lantern Wall","Outer Bank","A wall that starts at eighteen meters.",advanced,true\n',
    ),
  });
  await page.getByRole("button", { name: "Import dive sites" }).click();
  // The action's own `?notice=` redirect is the wait — never a navigation
  // racing the write. One updated site is the seeded library's own row this
  // file does not name; the created one is Lantern Wall.
  await page.waitForURL(/notice=imported-\d+-1-0-0/);
  await expect(page.getByRole("status")).toContainText("created 1 new one");

  // Each import lands back on this tab, form and all, so the next upload goes
  // from here and the library is read once at the end: a navigation between
  // every step put this test on its 15-second budget (issue #2366).

  // The field guide travels in a second file of the same bundle and comes back
  // in the same upload, joined on the id the sites file carried (issue #1841).
  // A species DiveDay no longer lists is left out and counted, never stored.
  const siteId = "3f0b6a2e-9c41-4d7e-8f15-2a6c9b1d4e70";
  await page.getByLabel("Choose CSV files").setInputFiles([
    {
      name: "dive_sites.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`id,name\n${siteId},"Seahorse Garden"\n`),
    },
    {
      name: "dive_site_creatures.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `dive_site_id,position,catalog_slug\n${siteId},0,green-moray\n${siteId},1,kraken\n`,
      ),
    },
  ]);
  await page.getByRole("button", { name: "Import dive sites" }).click();
  await page.waitForURL(/notice=imported-\d+-1-0-0-1-1/);
  await expect(page.getByRole("status")).toContainText("Field guides came back for 1 site");

  // And the file DiveDay did not write is refused whole, rather than read
  // half-way: this reads the export's own columns, so a column it does not know
  // is either one a later DiveDay wrote or one the shop added by hand, and
  // both are a restore that quietly loses a fact.
  await page.getByLabel("Choose CSV files").setInputFiles({
    name: "dive_sites.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,house_reef_rating\nSomewhere Else,5\n"),
  });
  await page.getByRole("button", { name: "Import dive sites" }).click();
  await page.waitForURL(/notice=import-unknown-columns/);
  // The banner's own words rather than its role: a refusal is `role="alert"`
  // (the shared tone-to-role rule, `noticeRole`) and so is Next's route
  // announcer, which wins the match on a fresh navigation.
  await expect(page.getByText(/column DiveDay does not recognize/)).toBeVisible();
  await page.goto(`/shop/${privateShop.slug}/dive-sites`);
  await expect(page.getByText("Lantern Wall")).toBeVisible();
  await expect(page.getByText("Somewhere Else")).toHaveCount(0);
});

test("map labels keep saved site text literal and details navigation works", async ({
  page,
  privateShop,
}) => {
  const name = "Z Reef <img src=x onerror=alert(1)>";
  const subtitle = "<b onmouseover=alert(2)>Bank</b>";
  await page.goto(`/shop/${privateShop.slug}/dive-sites/new`);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("textbox", { name: "Location" }).fill(subtitle);
  // Keep this label/keyboard/navigation case separate from the seeded Keys
  // cluster. Clustered literal text is covered through Leaflet in SiteMap.test.
  await openSection(page, "forecast");
  await page.getByLabel("Latitude").fill("25.30");
  await page.getByLabel("Longitude").fill("-80.00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/dive-sites\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const detailsUrl = page.url();

  await page.goto(`/shop/${privateShop.slug}/dive-sites`);
  const marker = page.locator(".leaflet-site-marker").getByRole("button", { name, exact: true });
  await expect(marker).toBeVisible();
  const popup = page.locator(".leaflet-popup-content");
  // Check the shop before another site's popup auto-pan moves the viewport.
  const shopMarker = page.locator('.leaflet-shop-marker [role="img"]').first();
  await expect(shopMarker).toHaveAccessibleName(/\S/);
  await shopMarker.focus();
  await expect(page.locator(".leaflet-shop-tooltip")).toBeVisible();
  await shopMarker.click();
  await expect(popup).toHaveCount(0);
  await marker.focus();
  await marker.press("Enter");
  await expect(marker).toHaveClass(/ring-4/);
  await expect(popup).toHaveCount(1);
  await expect(popup.getByText(name, { exact: true })).toBeVisible();
  await expect(popup.getByText(subtitle, { exact: true })).toHaveCount(0);
  await expect(popup.locator("img, b, [onerror], [onmouseover]")).toHaveCount(0);
  await page.getByRole("button", { name: "Close popup" }).click();
  await expect(popup).toHaveCount(0);
  await expect(marker).not.toHaveClass(/ring-4/);
  await marker.focus();
  await marker.press("Space");
  await expect(popup).toHaveCount(1);
  await popup
    .getByRole("link", { name: staffTranslator("en-US")("diveSites.map.openSite") })
    .click();
  await page.waitForURL(detailsUrl);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});
