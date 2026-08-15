import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, READ_ONLY, test } from "./fixtures";

/**
 * READ_ONLY holds here: every test fetches a document — robots.txt, sitemap.xml, a
 * page's `<head>` — and asserts on its bytes.
 */

/**
 * A consolidated smoke pass over the SEO surface this batch touched:
 * robots.txt's disallow list, sitemap.xml's shape, the embed's canonical
 * (docs ADR 20260726-schedule-embed), and the OpenGraph cards on both the
 * marketing homepage and a shop's schedule page. Structured-data content
 * itself (Event/Review shape) is covered in depth by reviews.spec.ts; this
 * file only re-asserts the canonical/JSON-LD presence invariant as part of
 * the consolidated pass, per the audit that spawned it.
 */

test("robots.txt disallows every token-route prefix and points at the sitemap", {
  tag: READ_ONLY,
}, async ({ page }) => {
  const response = await page.request.get("/robots.txt");
  expect(response.ok()).toBe(true);
  const body = await response.text();
  for (const prefix of [
    "/api/",
    "/waivers/",
    "/ready/",
    "/recap/",
    "/offline-manifest",
    "/verify/",
    "/reset-password/",
    "/invite/",
    "/calendar/",
    "/unsubscribe/",
  ]) {
    expect(body).toContain(`Disallow: ${prefix}`);
  }
  expect(body).toMatch(/^Sitemap: .*\/sitemap\.xml$/m);
});

/**
 * `src/app/sitemap.ts` deliberately excludes every `isDemo` shop (including
 * the canonical `blue-mantis` e2e/visual fixture — see its docstring and
 * ADR 20260724-per-visitor-demo-shops), and the dev/e2e seed
 * (`src/db/seed.ts`) never inserts a non-demo shop, so there is no seeded
 * shop this suite can assert *into* the sitemap. What's real and checkable
 * here: the marketing surface is fully listed, the demo shop is correctly
 * left out (proving the `isDemo` filter is live, not a no-op), and a
 * bearer-token prefix never leaks into a publicly indexed URL list.
 */
test("sitemap.xml lists the marketing pages, excludes the demo shop, and never leaks a token route", {
  tag: READ_ONLY,
}, async ({ page }) => {
  const response = await page.request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  const body = await response.text();

  const originMatch = body.match(/<loc>([^<]*)<\/loc>/);
  expect(originMatch).not.toBeNull();
  const origin = originMatch?.[1] ?? "";
  expect(origin).toMatch(/^https?:\/\//);

  for (const path of ["/", "/product", "/pricing", "/onboard", "/about", "/switching"]) {
    const url = path === "/" ? origin : `${origin}${path}`;
    expect(body, `sitemap.xml missing ${url}`).toContain(`<loc>${url}</loc>`);
  }

  expect(body).not.toContain(`/s/${DEMO_SHOP_SLUG}`);
  expect(body).not.toContain("/waivers/");
});

test("the schedule page's canonical stays on the standalone URL in both standalone and embed views, and JSON-LD only renders standalone", {
  tag: READ_ONLY,
}, async ({ page }) => {
  // The `.locator()` calls in this file all target `<head>` elements
  // (link/meta/script) that never have a layout box, so
  // `.filter({ visible: true })` would zero out every match regardless of
  // whether the element is actually present — intentionally left unfiltered
  // throughout this file. Each assertion also follows a fresh `page.goto`,
  // so there's no prior client-side-navigated route to leak from anyway.
  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  const standaloneCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  // Resolved against publicAppUrl()'s configured origin (never the worker's
  // own loopback baseURL, which is only where the *test* happens to talk to
  // this server) — assert the path shape, not a host this environment
  // doesn't control.
  expect(standaloneCanonical).toMatch(new RegExp(`/s/${DEMO_SHOP_SLUG}$`));
  await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();

  await page.goto(`/s/${DEMO_SHOP_SLUG}?embed=1`);
  const embedCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(embedCanonical).toBe(standaloneCanonical);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
});

test("the homepage carries a resolvable og:image", { tag: READ_ONLY }, async ({ page }) => {
  await page.goto("/");
  const content = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(content).toBeTruthy();
  expect(content).toMatch(/^https?:\/\//);
});

/**
 * The inversion this catches is counter-intuitive, which is why it gets a
 * test rather than a review habit: a page-level `openGraph` block *replaces*
 * the root layout's rather than merging into it, so the pages written with
 * the most care about their unfurl — `/` and the whole `/s/` namespace — were
 * the exact ones unfurling with no site name, while a page with nothing to
 * say about itself inherited one. Every page that exports a block now spreads
 * `openGraphSite` (src/lib/site-metadata.ts).
 */
test("every public page names the site in its unfurl, not just the ones with no words of their own", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  const tripHref = await page
    .locator(`a[href*="/s/${DEMO_SHOP_SLUG}/trips/"]`)
    .first()
    .getAttribute("href");
  expect(tripHref, "no seeded departure to read a trip page from").toBeTruthy();

  for (const path of [
    "/",
    `/s/${DEMO_SHOP_SLUG}`,
    `/s/${DEMO_SHOP_SLUG}/courses`,
    tripHref as string,
    // Declares no block of its own, so it inherits the layout's — the other
    // half of the pair, and the half that already worked.
    "/sign-in",
  ]) {
    await page.goto(path);
    expect(
      await page.locator('meta[property="og:site_name"]').first().getAttribute("content"),
      `${path} og:site_name`,
    ).toBe("DiveDay");
    expect(
      await page.locator('meta[property="og:type"]').first().getAttribute("content"),
      `${path} og:type`,
    ).toBe("website");
  }
});

test("the shop schedule page carries its own per-shop og:image", { tag: READ_ONLY }, async ({
  page,
}) => {
  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  const content = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(content).toBeTruthy();
  expect(content).toMatch(/^https?:\/\//);
  // Next generates a dedicated route for this file-convention image
  // (src/app/s/[shopSlug]/opengraph-image.tsx) rather than
  // falling back to the generic root card — confirm it resolved there.
  expect(content).toContain(`/s/${DEMO_SHOP_SLUG}/opengraph-image`);
});
