import { expect, READ_ONLY, test } from "./fixtures";

/**
 * **The regional pages** (issue #1436, N-49): `/dive` lists every town with a
 * listed shop, `/dive/<town>` lists the shops there, and each one links to its
 * own storefront. Anonymous throughout — nothing in this file signs in.
 *
 * READ_ONLY holds for the whole file: every test navigates and asserts, and
 * none submits a form, calls a server action, or mints a shop.
 *
 * The demo shop is deliberately absent from all of it. `listedShopScope`
 * excludes `is_demo` rows, so the two Key Largo neighbours seeded by
 * `seedRegionNeighbours` are the whole population of this page — which is also
 * what proves the filter is live rather than a no-op.
 */

/** `seedRegionNeighbours` (src/db/seed-region-neighbours.ts) — the first of its two shops. */
const REEF_LINE = "reef-line-divers";

test("a diver walks from the regional index to a town to a shop's own schedule", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/dive");
  await page.getByRole("heading", { level: 1, name: "Dive shops by town" }).waitFor();

  // The seeded neighbours are the only listed shops, so Key Largo is the only
  // town, and its count is theirs.
  const keyLargo = page.getByRole("link", { name: /Key Largo/ });
  await expect(keyLargo).toContainText("2 shops");
  await keyLargo.click();

  await expect(page).toHaveURL(/\/dive\/key-largo$/);
  // Wait on the town's own <h1>, which the index does not render — an eyebrow
  // or nav label shared by both pages would resolve against the previous DOM.
  await page.getByRole("heading", { level: 1, name: "Dive shops in Key Largo" }).waitFor();
  await expect(
    page.getByRole("heading", { level: 2, name: "Keys Current Charters" }),
  ).toBeVisible();

  const reefLine = page.getByRole("link", { name: /Reef Line Divers/ });
  await expect(reefLine).toContainText("Two tanks on the outer reef, every morning.");
  await reefLine.click();

  await expect(page).toHaveURL(new RegExp(`/s/${REEF_LINE}$`));
  await page.getByRole("heading", { level: 1, name: "Reef Line Divers" }).waitFor();
});

test("the demo shop is not listed, and neither is a town nobody dives out of", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/dive");
  await page.getByRole("heading", { level: 1, name: "Dive shops by town" }).waitFor();
  // blue-mantis sits in Key Largo too, and is a demo: it must not raise the
  // count, and its own name must not appear on the town page.
  await page.goto("/dive/key-largo");
  await page.getByRole("heading", { level: 1, name: "Dive shops in Key Largo" }).waitFor();
  await expect(page.getByRole("link", { name: /Blue Mantis/ })).toHaveCount(0);

  // A slug this app could have produced, that no shop is in: the not-found
  // page, never a heading over an empty ledger.
  await page.goto("/dive/atlantis");
  await expect(
    page.getByRole("heading", { level: 1, name: /couldn’t find that page/ }),
  ).toBeVisible();
});

test("a region segment that is not a slug never reaches the database", { tag: READ_ONLY }, async ({
  page,
}) => {
  // Shape is tested before any query runs (`isRegionSlug`), so each of these
  // refuses without a read — in `src/proxy.ts` first, which applies the same
  // test above the streaming boundary, and in the page body after (ADR
  // 20260912-the-public-namespace-refuses-at-the-edge, issue #1734). This test
  // reads the rendered refusal, which is what a diver sees; the status line is
  // asserted in `e2e/marketing.spec.ts` beside the two other routes that were
  // soft with it, in the shape `e2e/seo.spec.ts` uses for `/s/**`.
  for (const segment of ["Key%20Largo", "key_largo", "-key-largo"]) {
    await page.goto(`/dive/${segment}`);
    await expect(
      page.getByRole("heading", { level: 1, name: /couldn’t find that page/ }),
      segment,
    ).toBeVisible();
  }
});

test("the regional pages carry their canonical, their site name, and the town's shops as JSON-LD", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/dive/key-largo");
  // `<link>`/`<meta>`/`<script>` have no layout box, so these stay unfiltered —
  // `.filter({ visible: true })` would zero-match every one of them.
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(
    /\/dive\/key-largo$/,
  );
  expect(await page.locator('meta[property="og:site_name"]').first().getAttribute("content")).toBe(
    "DiveDay",
  );

  const graphs = await page.locator('script[type="application/ld+json"]').allTextContents();
  const list = graphs
    .map((json) => JSON.parse(json))
    .find((graph) => graph["@type"] === "ItemList");
  expect(list?.numberOfItems).toBe(2);
  expect(list?.itemListElement.map((entry: { item: { name: string } }) => entry.item.name)).toEqual(
    ["Keys Current Charters", "Reef Line Divers"],
  );

  await page.goto("/dive");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toMatch(/\/dive$/);
});

test("sitemap.xml lists the regional index and every town it can serve", {
  tag: READ_ONLY,
}, async ({ page }) => {
  const response = await page.request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  const body = await response.text();
  const origin = body.match(/<loc>([^<]*)<\/loc>/)?.[1] ?? "";
  expect(body).toContain(`<loc>${origin}/dive</loc>`);
  expect(body).toContain(`<loc>${origin}/dive/key-largo</loc>`);
});
