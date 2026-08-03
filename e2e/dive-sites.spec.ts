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
    await page.getByRole("button", { name: "Save site briefing" }).click();
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();

    await page.getByRole("button", { name: "Copy and tailor" }).click();
    await expect(page.getByText("Independent copy ready to tailor.")).toBeVisible();
    await expect(page.getByRole("heading", { name: `${siteName} copy` })).toBeVisible();
    await expect(page.getByLabel("Latitude")).toHaveValue("25.123");
    await expect(page.getByLabel("Longitude")).toHaveValue("-80.321");

    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Title").fill(tripTitle);
    await page.getByLabel("Dive site").first().selectOption({ label: siteName });
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
    // Scoped to the trip list itself: a day with more than one departure
    // also renders a same-titled <li> in the month calendar
    // (src/components/ScheduleCalendar.tsx), and an unscoped locator can
    // resolve to both.
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
    await page.getByRole("button", { name: "Return to automated outlook" }).click();
    await expect(page.getByRole("status")).toContainText("Crew prediction cleared");
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
    const library = page.getByRole("list", { name: "Saved dive sites" });
    const cards = library.locator("li");
    const search = page.getByLabel("Find a site");
    // Scoped to the band itself: the staff chrome's ⌘K trigger is also a
    // button named "Search", so an unscoped locator resolves to both.
    const submit = page
      .getByRole("form", { name: "Search the dive-site library" })
      .getByRole("button", { name: "Search" });

    await page.goto("/shop/blue-mantis/dive-sites");
    const seededCount = await cards.count();
    expect(seededCount).toBeGreaterThan(1);

    // A name search narrows the grid to the one card and says so in the URL,
    // so a found site is a link a staffer can send to a colleague.
    await search.fill("spiegel");
    await submit.click();
    await expect(page).toHaveURL(/\?q=spiegel/);
    await expect(cards).toHaveCount(1);
    await expect(
      library.getByRole("heading", { level: 2, name: "Spiegel Grove", exact: true }),
    ).toBeVisible();
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
    await expect(cards).toHaveCount(1);
    await expect(
      library.getByRole("heading", { level: 2, name: "Christ of the Abyss", exact: true }),
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
    await expect(cards).toHaveCount(seededCount);

    // One screenful of sites is never told it is on "page 1 of 1"; the pager
    // only exists when there is somewhere to go. (`src/db/dive-sites.test.ts`
    // pins the paging arithmetic at real volume — seeding 25 sites into the
    // demo shop to make a pager appear here would distort every other surface
    // that reads the library.)
    await expect(page.getByRole("navigation", { name: "Dive-site pages" })).toHaveCount(0);
    // A stale bookmark past the end is an empty page, not a 500.
    await page.goto("/shop/blue-mantis/dive-sites?page=99");
    await expect(page.getByRole("heading", { level: 1, name: "Dive-site library" })).toBeVisible();
    await expect(cards).toHaveCount(0);
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
    await page.getByRole("button", { name: "Save site briefing" }).click();
    await expect(page.getByRole("heading", { name: siteName })).toBeVisible();

    await page.goto(`/shop/blue-mantis/dive-sites?q=${encodeURIComponent(siteName)}`);
    const card = page.getByRole("list", { name: "Saved dive sites" }).locator("li");
    await expect(card).toHaveCount(1);
    await expect(card.getByText("Location to add")).toBeVisible();
  });

  test("a half-entered forecast point is named as the reason, and nothing typed is lost", async ({
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
    await page.getByRole("button", { name: "Save site briefing" }).click();

    // Not `getByRole("alert")` — Next's own route announcer is one too.
    await expect(page.getByText(/Add both forecast coordinates/)).toBeVisible();
    // The whole point: still on the form, still filled in.
    await expect(page).toHaveURL(/\/dive-sites\/new$/);
    await expect(page.getByLabel("Name")).toHaveValue(siteName);
    await expect(page.getByLabel("Location")).toHaveValue("Key Largo");
    await expect(page.getByLabel("What might divers see?")).toHaveValue("Green turtles");
    await expect(page.getByLabel("Latitude")).toHaveValue("25.123");

    // Completing the pair is all it takes — no retyping.
    await page.getByLabel("Longitude").fill("-80.321");
    await page.getByRole("button", { name: "Save site briefing" }).click();
    await expect(page.getByRole("heading", { level: 1, name: siteName })).toBeVisible();

    // The edit form shares the shape, and so does the fix.
    await page.getByLabel("Longitude").fill("");
    await page.getByLabel("Underwater briefing").fill("Turtles rest below the coral heads.");
    await page.getByRole("button", { name: "Save briefing" }).click();
    // Not `getByRole("alert")` — Next's own route announcer is one too.
    await expect(page.getByText(/Add both forecast coordinates/)).toBeVisible();
    await expect(page.getByLabel("Underwater briefing")).toHaveValue(
      "Turtles rest below the coral heads.",
    );
    await expect(page.getByLabel("Latitude")).toHaveValue("25.123");
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
    const existing = page.getByRole("heading", { level: 2, name: "Molasses Reef", exact: true });
    const imported = page.getByRole("heading", { level: 2, name: "Molasses Reef 2", exact: true });

    await page.goto("/shop/blue-mantis/dive-sites");
    await expect(existing).toHaveCount(1);
    await expect(imported).toHaveCount(0);
    await expect(page.getByText("Template update v2 ready — your edits are safe.")).toBeVisible();

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
    await expect(page.getByText("DiveDay template v2")).toBeVisible();
    await expect(page.getByText("Template update v2 ready — your edits are safe.")).toBeVisible();
  });

  test("a URL resolving to a private address is blocked server-side, never saved raw (CR-020)", async ({
    page,
  }) => {
    // A literal loopback address needs no real DNS/network access to prove
    // the save wiring actually runs the SSRF check end to end (real
    // dns.lookup call, real code path) and fails closed rather than keeping
    // the raw URL. src/lib/storage/ingest-url.test.ts covers the full range
    // of blocked addresses and the not_configured/blocked distinction.
    await page.goto("/shop/blue-mantis/dive-sites/new");
    await page.getByLabel("Name").fill(`Ingestion Check ${e2eNow().getTime()}`);
    await page.getByLabel("Satellite map image URL").fill("http://127.0.0.1:1/reef-sat.jpg");
    await page.getByRole("button", { name: "Save site briefing" }).click();
    await expect(page.getByText(/couldn.t be used/)).toBeVisible();
  });
});

test("the dive-site catalog is staff-only", async ({ page }) => {
  // The catalog's only gate is `requireStaffSession()`: any staff role may
  // browse and import, and there is no owner/manager split on this route.
  // Signed out, the staff gate sends an anonymous visitor to sign in.
  await page.goto("/shop/blue-mantis/dive-sites/catalog");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("the seeded reef briefing shows a satellite map, a gentle route, landmarks, and a field guide", async ({
  page,
}) => {
  // The per-test fixture reset already restored the seeded briefing; read it
  // straight off the public schedule as a diver. Scoped to the trip-list
  // item rather than a bare role query: this trip is also the schedule's
  // soonest departure with room, so its title appears a second time in the
  // "Next boat out" quick-link card above the list.
  await page.goto("/s/blue-mantis");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();

  await expect(page.getByTitle("Satellite map of Molasses Reef")).toBeVisible();
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
  await expect(page.getByText("11 likely sightings")).toBeVisible();
  await expect(page.getByRole("img", { name: "Stoplight parrotfish" }).first()).toBeVisible();
  // What these two assert is the CR-020 property: a public page serves the
  // bundled first-party copy, never a live third-party Commons URL. Read it
  // through `bundledSource` rather than off `src` directly — these photos go
  // through `next/image` now, so the real source is the `url` parameter of an
  // `/_next/image?...` request, and matching the raw attribute would only be
  // asserting which optimizer is in front of it.
  await expect
    .poll(() => bundledSource(page.getByRole("img", { name: "Finger sponge" })))
    .toMatch(/\/dive-sites\//);
  await expect
    .poll(() => bundledSource(page.getByRole("img", { name: /southern stingray/i })))
    .toMatch(/Dasyatis%20americana%20NOAA\.jpg/);
});
