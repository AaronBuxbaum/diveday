import type { Locator } from "@playwright/test";
import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow, signInAsOwner } from "./helpers";

/**
 * The photo an `<img>` ultimately renders, seen through `next/image`.
 *
 * An optimized image's `src` is `/_next/image?url=<the real source>&w=…&q=…`,
 * with the source percent-encoded — so a bundled path that reads
 * `/dive-sites/Sponge%2006%20…jpg` on a plain `<img>` arrives here as
 * `%2Fdive-sites%2FSponge%252006%2520…jpg`. One decode of the `url` parameter
 * gets back to the stored URL, which is what the assertions care about.
 * Falls through unchanged for an image that isn't being optimized.
 */
async function bundledSource(image: Locator): Promise<string> {
  const src = (await image.getAttribute("src")) ?? "";
  const optimized = src.match(/^\/_next\/image\?url=([^&]+)/);
  return optimized?.[1] ? decodeURIComponent(optimized[1]) : src;
}

test.describe("staff", () => {
  signedInAsOwner();

  test("staff reuses a dive-site briefing on a trip that divers can explore", async ({ page }) => {
    // Longest single test in this file: create a site, copy it, wire a trip
    // to it, and exercise the crew-prediction flow — each step its own
    // navigation or status-toast wait. Same aggregate-cost reasoning as
    // visual.spec.ts's `test.setTimeout` and role-permissions.spec.ts's
    // captain test: many sequential steps at realistic per-step cost under
    // 2-worker load add up past the default 15s budget even though no
    // individual step is stuck.
    test.setTimeout(30_000);
    const siteName = `Turtle Garden ${e2eNow().getTime()}`;
    const tripTitle = `Turtle Garden charter ${e2eNow().getTime()}`;

    // "Dive sites" now lives in the nav's "More" group; navigate directly.
    await page.goto("/shop/blue-mantis/dive-sites");
    await page.getByRole("link", { name: "Create a site" }).click();
    await page.getByLabel("Name").fill(siteName);
    await page.getByLabel("Location").fill("Key Largo");
    await page.getByLabel("Latitude").fill("25.123");
    await page.getByLabel("Longitude").fill("-80.321");
    await page.getByLabel("What might divers see?").fill("Green turtles · spotted eagle rays");
    await page
      .getByLabel("Underwater briefing")
      .fill("Look along the sandy edge for turtles resting below the coral heads.");
    await page.getByRole("button", { name: "Save dive site" }).click();
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();

    await page.goto("/shop/blue-mantis/schedule/board?add=full");
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
    const manageTripUrl = page.url();

    // The conditions form waits behind its disclosure (summary-first Overview).
    await page.getByText(/Write a crew prediction|Edit crew prediction/).click();
    await page
      .getByLabel("Conditions overview")
      .fill("Warm water and an easy morning are expected.");
    await page.getByLabel("Water temp °C").fill("27");
    await page.getByLabel("Visibility m").fill("18");
    await page.getByRole("button", { name: "Publish crew prediction" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction published");

    // Staff are routed to the trip editor; view the public diver briefing signed
    // out, then sign back in to finish the staff-side edits below.
    await page.context().clearCookies();
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
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();
    // Marine life folds behind the per-dive "look for" tap (P2 content fold).
    await page.getByText("What to look for down there").first().click();
    await expect(page.getByText("Green turtles · spotted eagle rays")).toBeVisible();
    await expect(page.getByText("27°C", { exact: true })).toBeVisible();
    await expect(page.getByText("18 m")).toBeVisible();
    await expect(page.getByText("Crew prediction")).toBeVisible();

    await signInAsOwner(page);
    await page.goto(manageTripUrl);
    // Published, so the disclosure reads "Edit"; the clear control sits inside.
    await page.getByText("Edit crew prediction", { exact: true }).click();
    await page.getByRole("button", { name: "Return to automated outlook" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction cleared");
    // The clear's own notice forces the disclosure open on the redirected
    // render — no click needed (and one would close it again).
    await expect(page.getByLabel("Water temp °C")).toHaveValue("");
    await expect(page.getByLabel("Visibility m")).toHaveValue("");

    // Cancel the trip — this leg exercises the cancel/reinstate controls
    // themselves; test isolation is already handled by the per-test demo
    // reset in fixtures.ts.
    await page.getByRole("button", { name: "Cancel trip" }).click();
    await expect(page.getByRole("button", { name: "Reinstate trip" })).toBeVisible();
  });

  test("staff find a site by name or location instead of scrolling the whole library", async ({
    page,
  }) => {
    // Three searches, a clear, and a past-the-end bookmark are five server
    // round-trips with their own settles — the same aggregate-cost reasoning
    // as the tour above, not one slow step.
    test.setTimeout(30_000);
    const library = page.getByRole("table", { name: "Saved dive sites" });
    const rows = library.locator("tbody tr");
    const search = page.getByLabel("Find a site");
    // Scoped to the band itself: the staff chrome's ⌘K trigger is also a
    // button named "Search", so an unscoped locator resolves to both.
    const submit = page
      .getByRole("form", { name: "Search the dive-site library" })
      .getByRole("button", { name: "Search" });

    await page.goto("/shop/blue-mantis/dive-sites");
    // Wait for a real row before counting. `locator.count()` is a one-shot
    // query — alone among Playwright's locator methods it does *not* retry —
    // so on an `instant = true` route it happily counts the `loading.tsx`
    // skeleton's zero rows and moves on. Every later assertion here is
    // auto-waiting; this one line is what makes the first one so too.
    await expect(rows.first()).toBeVisible();
    const seededCount = await rows.count();
    expect(seededCount).toBeGreaterThan(1);

    // A name search narrows the table to the one row and says so in the URL,
    // so a found site is a link a staffer can send to a colleague.
    await search.fill("spiegel");
    await submit.click();
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
    await expect(library.getByText("Advanced Open Water", { exact: true })).toBeVisible();

    // Location is searchable too: "Pennekamp" appears in no site's *name*.
    await search.fill("pennekamp");
    await submit.click();
    await expect(rows).toHaveCount(1);
    await expect(
      library.getByRole("link", { name: "Christ of the Abyss", exact: true }),
    ).toBeVisible();

    // A search that matches nothing says so rather than showing the library's
    // "start your first site" pitch to a shop that already has seven.
    await search.fill("nowhere in particular");
    await submit.click();
    await expect(page.getByText("No sites match that search")).toBeVisible();
    await expect(page.getByText("Start with a site your crew knows well")).toHaveCount(0);

    // And there is always a way back to the whole library.
    await page.getByRole("link", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/dive-sites$/);
    await expect(rows).toHaveCount(seededCount);

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
    await page.getByRole("button", { name: "Save dive site" }).click();
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();

    await page.goto(`/shop/blue-mantis/dive-sites?q=${encodeURIComponent(siteName)}`);
    const row = page.getByRole("table", { name: "Saved dive sites" }).locator("tbody tr");
    await expect(row).toHaveCount(1);
    // Twice in the row's markup — once in the Location column, once folded
    // under the name for a phone — so `.first()` rather than a strict match.
    await expect(row.getByText("Location to add").first()).toBeVisible();
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
    await expect(page.getByText(/Fill in the GPS location above/)).toBeVisible();

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
    await page.getByRole("button", { name: "Save dive site" }).click();
    await expect(page.getByRole("heading", { level: 1, name: siteName })).toBeVisible();

    // Saved, and read back on the form: the route survives the round trip
    // rather than being a drawing that only existed in the browser.
    await expect(page.getByLabel("What the route is called")).toHaveValue("Ledge and back");
    await expect(page.getByText(/^3 waypoints/)).toBeVisible();

    // And it reaches the diver, which is the only reason to draw it.
    await page.goto("/shop/blue-mantis/schedule/board?add=full");
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
    await expect(page.getByText("Ledge and back")).toBeVisible();
    await expect(page.getByText("Out along the ledge, home over the sand.")).toBeVisible();
    await expect(page.getByTitle(`Terrain map of ${siteName}`)).toBeVisible();
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
    await page.getByLabel("Location").fill("Key Largo");
    await page.getByLabel("What might divers see?").fill("Green turtles");
    await page.getByLabel("Latitude").fill("25.123"); // …and no longitude.
    await page.getByRole("button", { name: "Save dive site" }).click();

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
    await expect(page.getByLabel("Location")).toHaveValue("Key Largo");
    await expect(page.getByLabel("What might divers see?")).toHaveValue("Green turtles");
    await expect(page.getByLabel("Latitude")).toHaveValue("25.123");

    // Completing the pair is all it takes — no retyping.
    await page.getByLabel("Longitude").fill("-80.321");
    await page.getByRole("button", { name: "Save dive site" }).click();
    await expect(page.getByRole("heading", { level: 1, name: siteName })).toBeVisible();

    // The edit form shares the shape, and so does the fix.
    await page.getByLabel("Longitude").fill("");
    await page.getByLabel("Underwater briefing").fill("Turtles rest below the coral heads.");
    await page.getByRole("button", { name: "Save dive site" }).click();
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
    await page.getByRole("button", { name: "Save dive site" }).click();
    await expect(page.getByRole("heading", { level: 1, name: taken })).toBeVisible();

    // A second site reaching for the same name gets an answer, not a stack.
    await page.goto("/shop/blue-mantis/dive-sites/new");
    await page.getByLabel("Name").fill(taken);
    await page.getByLabel("Location").fill("Key Largo");
    await page.getByRole("button", { name: "Save dive site" }).click();

    // Not `getByRole("alert")` — Next's own route announcer is one too.
    const refusal = page.getByText(/already goes by that name/);
    await expect(refusal).toBeVisible();
    await expect(page.locator("form").filter({ has: refusal })).toHaveCount(1);
    // Still on the form, still filled in — a rename is all it takes.
    await expect(page).toHaveURL(/\/dive-sites\/new$/);
    await expect(page.getByLabel("Location")).toHaveValue("Key Largo");
    await page.getByLabel("Name").fill(`${taken} south`);
    await page.getByRole("button", { name: "Save dive site" }).click();
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
    // The seed publishes one global template, Molasses Reef, currently at v2,
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
    // The library rows are a table now (issue #608), so a site is named by the
    // link in its first cell rather than by a card's `<h2>`.
    const library = page.getByRole("table", { name: "Saved dive sites" });
    const existing = library.getByRole("link", { name: "Molasses Reef", exact: true });
    const imported = library.getByRole("link", { name: "Molasses Reef 2", exact: true });
    // The template line is in the row twice — its own column, and folded under
    // the name for a phone — so these read the first match rather than
    // tripping strict mode on a pair that says the same thing.
    const updateReady = library.getByText("Template update v2 ready.").first();

    await page.goto("/shop/blue-mantis/dive-sites");
    await expect(existing).toHaveCount(1);
    await expect(imported).toHaveCount(0);
    await expect(updateReady).toBeVisible();

    await page.getByRole("link", { name: "Browse templates" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "DiveDay common dive sites" }),
    ).toBeVisible();
    const template = page.locator("li").filter({ hasText: "Molasses Reef" }).filter({
      visible: true,
    });
    await expect(template.getByText("Template v2")).toBeVisible();

    // The catalog's one action. It lands on the freshly created site's own
    // briefing, ready to tailor — not back on a list where staff would have to
    // find what they just imported.
    await template.getByRole("button", { name: "Import to my library" }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/dive-sites\/[0-9a-f-]+/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Molasses Reef 2", exact: true }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Dive-site library" }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/dive-sites$/);
    // Both sites now: the new one states the version it came from, while the
    // shop's own tailored v1 copy is untouched and still offered the update.
    await expect(existing).toHaveCount(1);
    await expect(imported).toHaveCount(1);
    await expect(library.getByText("DiveDay template v2").first()).toBeVisible();
    await expect(updateReady).toBeVisible();
  });

  test("the old /dive-sites/catalog URL still works, and keeps the page it was deep-linked to", async ({
    page,
  }) => {
    // A real 308 at the request level, not a 200 whose hop resolves inside
    // the streamed payload — a Route Handler, because under `cacheComponents`
    // a page-based `permanentRedirect()` answers 200 and only a browser
    // follows it; a bookmark manager, a crawler, and a `curl` do not (ADR
    // 20260806-one-trip-create-form).
    const direct = await page.request.get("/shop/blue-mantis/dive-sites/catalog?page=2", {
      maxRedirects: 0,
    });
    expect(direct.status()).toBe(308);
    expect(direct.headers().location).toBe("/shop/blue-mantis/dive-sites?view=catalog&page=2");

    // The route folded into the library as `?view=catalog`
    // (ADR 20260806-dive-site-catalog-is-a-view); the links already out in
    // the world did not. A bare bookmark lands on the catalog view.
    await page.goto("/shop/blue-mantis/dive-sites/catalog");
    await expect(page).toHaveURL(/\/dive-sites\?view=catalog$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "DiveDay common dive sites" }),
    ).toBeVisible();

    // A `?page=` deep link keeps its page rather than silently restarting at
    // the top of the catalog — landing a bookmarked page 3 on page 1 is the
    // quiet kind of "it still works" that makes staff re-hunt for a template
    // they'd found.
    await page.goto("/shop/blue-mantis/dive-sites/catalog?page=2");
    await expect(page).toHaveURL(/\/dive-sites\?view=catalog&page=2$/);

    // Page 1 and nonsense both mean "the start of the catalog", which is the
    // default, so neither is carried across as a query param.
    for (const query of ["?page=1", "?page=banana"]) {
      await page.goto(`/shop/blue-mantis/dive-sites/catalog${query}`);
      await expect(page).toHaveURL(/\/dive-sites\?view=catalog$/);
    }
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
    // box asking for a URL.
    await expect(page.getByLabel("Map still")).toHaveAttribute("type", "file");
    await expect(page.getByLabel("Route still")).toHaveAttribute("type", "file");
    await expect(page.getByLabel(/Site photos/)).toHaveAttribute("type", "file");
    await expect(page.getByLabel(/image URL/i)).toHaveCount(0);
  });
});

test("the dive-site catalog is staff-only", async ({ page }) => {
  // The catalog's only gate is `requireStaffSession()`: any staff role may
  // browse and import, and there is no owner/manager split on this route.
  // Signed out, the staff gate sends an anonymous visitor to sign in.
  await page.goto("/shop/blue-mantis/dive-sites/catalog");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("the seeded reef briefing shows a terrain map, a gentle route, landmarks, and a field guide", async ({
  page,
}) => {
  // The per-test fixture reset already restored the seeded briefing; read it
  // straight off the public schedule as a diver. Scoped to the trip-list
  // item so the locator can never drift onto another surface that happens to
  // carry the trip's title (reviews quote trip names too).
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();

  await expect(page.getByTitle("Terrain map of Molasses Reef")).toBeVisible();
  await expect(page.getByText("Reef garden loop")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open map ↗" })).toBeVisible();
  // Landmarks, the field guide, and diver moments fold behind one tap per
  // dive so the page stays a briefing; open both tanks' folds to read them.
  for (const summary of await page.getByText("What to look for down there").all()) {
    await summary.click();
  }
  // Both tanks of the seeded two-tank trip carry a site briefing, so this
  // heading appears once per dive.
  await expect(
    page.getByRole("heading", { name: "Landmarks that tell the story" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Molasses Reef Light" })).toBeVisible();
  await expect(page.getByText("8 likely sightings")).toBeVisible();
  await expect(page.getByRole("img", { name: "Stoplight parrotfish" }).first()).toBeVisible();
  // Both the landmark's paragraph and the fit line under "Welcoming dive" are
  // the *shop's* words now, off its own row — they used to come from a
  // hard-coded table keyed by site name and from a canned sentence per tone,
  // neither of which any field on the site could change.
  await expect(
    page.getByText("The steel tower is the easiest above-water reference on the reef"),
  ).toBeVisible();
  await expect(page.getByText("a good first ocean dive after a pool course").first()).toBeVisible();
  // What these two assert is the CR-020 property: a public page serves the
  // bundled first-party copy, never a live third-party Commons URL. Read it
  // through `bundledSource` rather than off `src` directly — these photos go
  // through `next/image` now, so the real source is the `url` parameter of an
  // `/_next/image?...` request, and matching the raw attribute would only be
  // asserting which optimizer is in front of it.
  await expect
    .poll(() => bundledSource(page.getByRole("img", { name: "Elkhorn coral" })))
    .toMatch(/\/marine-life\//);
  await expect
    .poll(() => bundledSource(page.getByRole("img", { name: /southern stingray/i })))
    .toMatch(/\/marine-life\/southern-stingray\.jpg/);
});

test("the same saved field guide reads in Spanish for a Spanish-speaking diver", async ({
  page,
}) => {
  // The point of ADR 20260813-marine-life-is-diveday-copy. Nothing about the
  // site changes between this test and the one above it -- same shop, same
  // seeded rows, same eight species. What changes is who is reading, and the
  // cards follow them. Under the copy-at-pick-time model this was impossible:
  // a row held one language, whichever the staffer's browser was in.
  await page.goto("/s/blue-mantis");
  await page.getByRole("banner").getByRole("button", { name: "Change language" }).click();
  await page.getByRole("banner").getByRole("button", { name: "Español" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Calendario" })).toBeVisible();

  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();
  // Wait for the briefing itself before enumerating the folds. `.all()` is a
  // snapshot of what exists at that instant, so calling it straight off the
  // navigation finds nothing, opens nothing, and leaves the assertions below
  // looking for cards inside a closed `<details>`.
  await expect(page.getByRole("heading", { level: 3, name: "Molasses Reef" })).toBeVisible();
  for (const summary of await page.getByText("Qué buscar ahí abajo").all()) {
    await summary.click();
  }

  // The species names, the category words and the descriptions are all
  // Spanish, off the same `dive_site_creatures` rows the English render reads.
  await expect(page.getByText("Loro semáforo").first()).toBeVisible();
  await expect(page.getByText("Coral cuerno de alce").first()).toBeVisible();
  await expect(page.getByText("Pez de arrecife").first()).toBeVisible();
  await expect(page.getByText("Stoplight parrotfish")).toHaveCount(0);
  // The photo is the same file -- an image is not a string, and bundling it
  // once is the whole reason it is not in a message bundle.
  await expect
    .poll(() => bundledSource(page.getByRole("img", { name: "Loro semáforo" }).first()))
    .toMatch(/\/marine-life\/stoplight-parrotfish\.jpg/);
});

test("a shop writes its own landmarks and picks its own field guide", async ({ page }) => {
  await signInAsOwner(page);
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
  const guide = page.locator('fieldset:has-text("Field guide")');
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
  await expect(guide.getByText(/Not in DiveDay's catalog/)).toBeVisible();
  await page.getByRole("button", { name: "Tell DiveDay about it" }).click();
  await expect(guide.getByText(/we have noted Pygmy seahorse/)).toBeVisible();

  // A landmark, with the shop's own note on it. Pickles Reef ships with two, so
  // the new row is the last one — `.last()` throughout, and the round-trip
  // assertions below read that same row back after the save.
  await page.getByRole("button", { name: "Add a landmark" }).click();
  const landmarks = page.locator('fieldset:has-text("Landmarks that tell the story")');
  await landmarks.getByRole("textbox", { name: "Landmark" }).last().fill("The barrel casks");
  await landmarks
    .getByRole("textbox", { name: "What to say about it" })
    .last()
    .fill("Cement that hardened in its barrels and outlasted the ship.");
  await landmarks.getByLabel("What kind").last().selectOption("reefHistory");

  await page.getByRole("button", { name: "Save dive site" }).click();
  await expect(page.getByText("Dive site saved.")).toBeVisible();

  // Round-trips: the chosen species and the landmark come back as the shop
  // left them, and the refused one never landed.
  await expect(guide.getByText("Hogfish")).toBeVisible();
  await expect(guide.getByText(/Pygmy seahorse/)).toHaveCount(0);
  await expect(landmarks.getByRole("textbox", { name: "Landmark" }).last()).toHaveValue(
    "The barrel casks",
  );
  await expect(landmarks.getByLabel("What kind").last()).toHaveValue("reefHistory");
});

test("a template can be read in full before it is imported", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/dive-sites?view=catalog");
  // The catalog pages, ordered by slug — this one is on the first page and
  // carries both of the things a one-tap import used to hand a shop sight
  // unseen: a cert gate, and a field guide.
  const card = page.locator("li").filter({ hasText: "Eagle Wreck" });
  await card.getByRole("link", { name: "Read it first" }).click();
  await page.waitForURL(/template=eagle-wreck/);

  await expect(page.getByRole("heading", { name: "Eagle Wreck", level: 1 })).toBeVisible();
  await expect(page.getByText("Advanced Open Water")).toBeVisible();
  await expect(page.getByText("Wheelhouse and mast")).toBeVisible();
  await expect(page.getByRole("img", { name: "Goliath grouper" })).toBeVisible();

  await page.getByRole("button", { name: "Import to my library" }).click();
  await page.waitForURL(/\/dive-sites\/[0-9a-f-]{36}/);
  // The field guide came with it — a template that arrived without one left a
  // shop to retype the half of the briefing it could not see.
  await expect(
    page.locator('fieldset:has-text("Field guide")').getByText("Goliath grouper"),
  ).toBeVisible();
});
