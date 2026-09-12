import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, READ_ONLY, test } from "./fixtures";

/**
 * **The public dive-site page** — `/s/<shop>/sites/<site>` (N-48).
 *
 * The surface a diver who searched for the *reef* rather than the shop lands
 * on: the shop's own briefing for one place, and the departures going there.
 *
 * `READ_ONLY` holds for the whole file — every test navigates and reads. The
 * seeded blue-mantis library carries Molasses Reef with prose and a field
 * guide, and the two Key Largo neighbours (`seedRegionNeighbours`) are the
 * only *listed* shops in the fixture, so the sitemap assertions have a real
 * shop to find and the demo to not find.
 */

const SITE_PATH = `/s/${DEMO_SHOP_SLUG}/sites/molasses-reef`;

test("a departure's site name opens that site's own page, which leads back to a bookable day", {
  tag: READ_ONLY,
}, async ({ page }) => {
  // The whole path a diver walks, from the board rather than a typed URL: a
  // page reachable only from a sitemap is a page divers never find.
  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();
  await page.getByRole("heading", { name: "The day" }).waitFor();
  // By href rather than by name: which of the row's two lines carries the
  // site depends on whether the shop named the dive after it, and the
  // contract this asserts is that the row links to the site's page at all.
  await page.locator(`a[href="${SITE_PATH}"]`).first().click();

  await expect(page).toHaveURL(SITE_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Molasses Reef" })).toBeVisible();
  // The shop's own words, not a canned description of a reef (ADR
  // 20260813-dive-site-briefings-are-the-shops-own-words).
  await expect(page.getByText("Follow the coral ridge")).toBeVisible();
  // DiveDay's words for the species the shop picked, resolved for this
  // reader (ADR 20260813-marine-life-is-diveday-copy).
  await expect(page.getByRole("heading", { name: "Look for" })).toBeVisible();

  // The page's one act: a departure going here, opening the page that owns
  // capacity, readiness and payment.
  await expect(page.getByRole("heading", { name: "Next departures here" })).toBeVisible();
  await page.locator('a[href^="/s/blue-mantis/trips/"]').first().click();
  await expect(page).toHaveURL(/\/s\/blue-mantis\/trips\/[0-9a-f-]{36}$/);
});

/**
 * **What "not found" looks like here, and where the status code comes from.**
 *
 * This docblock used to say the opposite of the truth, and three issues chased
 * it (#1489, #1510, #1604): that the one `/s/**` path answering a real 404 was
 * `/s/<shop>/embed/<widget>`, because "its metadata is static and its refusal
 * is a pure function of the segment". Neither clause is why. That path is
 * refused in `src/proxy.ts` before Next resolves a route at all, and the page's
 * own check never runs on it. Every other path here was a 200 for the same
 * reason any of them would be: the static shell is on the wire before the page
 * body reaches `notFound()`, and nothing a page does after that can change a
 * status (ADR 20260912-the-public-namespace-refuses-at-the-edge).
 *
 * So the status is the proxy's answer and belongs to the namespace, not to this
 * page, while the body below it is this page's own. The test asserts both on
 * every refusal, because the two halves fail apart and only the body half was
 * ever watched: a segment no shop could have minted never reaches a query, one
 * shop's segment is not another shop's site, and neither of those is served at
 * 200.
 */
test("a segment no shop could have minted is a 404, and a site belongs to one shop", {
  tag: READ_ONLY,
}, async ({ page }) => {
  const notFound = page.getByRole("heading", { name: "That page isn’t here any more" });
  /**
   * Each refusal is read twice, because the two halves fail apart. The body is
   * this page's own contract — the diver still lands somewhere, framed by the
   * shop. The status belongs to the namespace, and it is the half that was
   * wrong: the heading below was green for the whole life of the soft 404
   * (issues #1489, #1510, #1604), while the wire said 200 and crawlers kept a
   * dead site page. The status-code sweep over the whole namespace lives in
   * `seo.spec.ts`; these three paths carry it here too so this page's own
   * refusals cannot quietly go soft again on their own.
   */
  const refuses = async (path: string) => {
    expect((await page.request.get(path)).status(), path).toBe(404);
    await page.goto(path);
    await expect(notFound).toBeVisible();
  };

  // Malformed: refused by the parser before it can reach a query.
  await refuses(`/s/${DEMO_SHOP_SLUG}/sites/Molasses%20Reef`);
  // Well-formed and unknown: this shop has no site under this segment.
  await refuses(`/s/${DEMO_SHOP_SLUG}/sites/somebody-elses-ledge`);
  // Real — but the demo's own, so it is a page here and nothing at the
  // neighbouring shop, whose whole library is one site and it is not this one.
  await page.goto(`/s/${DEMO_SHOP_SLUG}/sites/benwood-wreck`);
  await expect(page.getByRole("heading", { level: 1, name: "Benwood Wreck" })).toBeVisible();
  await refuses("/s/reef-line-divers/sites/benwood-wreck");
});

test("a listed shop's site pages are in the sitemap, and the demo's are not", {
  tag: READ_ONLY,
}, async ({ page }) => {
  const response = await page.request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  const body = await response.text();
  // The neighbours are real shops (`isDemo: false`, not opted out), so their
  // places are indexable; the demo is a fixture and stays out, exactly as
  // its schedule and course pages do.
  expect(body).toContain("/s/reef-line-divers/sites/french-reef");
  expect(body).not.toContain(`/s/${DEMO_SHOP_SLUG}/sites/`);
});

test("the site page publishes the place as structured data and points at itself", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/s/reef-line-divers/sites/french-reef");
  await expect(page.getByRole("heading", { level: 1, name: "French Reef" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    /\/s\/reef-line-divers\/sites\/french-reef$/,
  );
  const graph = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}",
  );
  expect(graph["@type"]).toBe("TouristAttraction");
  expect(graph.name).toBe("French Reef");
  // The site's own coordinate, which is the honest one for a *place*; a
  // departure's Event graph names the dock a diver turns up at instead.
  expect(graph.geo["@type"]).toBe("GeoCoordinates");
});
