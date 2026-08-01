import { DEMO_SHOP_SLUG } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

/**
 * A consolidated smoke pass over the SEO surface this batch touched:
 * robots.txt's disallow list, sitemap.xml's shape, the embed's canonical
 * (docs ADR 20260726-schedule-embed), and the OpenGraph cards on both the
 * marketing homepage and a shop's schedule page. Structured-data content
 * itself (Event/Review shape) is covered in depth by reviews.spec.ts; this
 * file only re-asserts the canonical/JSON-LD presence invariant as part of
 * the consolidated pass, per the audit that spawned it.
 */

test("robots.txt disallows every token-route prefix and points at the sitemap", async ({
  page,
}) => {
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
test("sitemap.xml lists the marketing pages, excludes the demo shop, and never leaks a token route", async ({
  page,
}) => {
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

  expect(body).not.toContain(`/shop/${DEMO_SHOP_SLUG}/schedule`);
  expect(body).not.toContain("/waivers/");
});

test("the schedule page's canonical stays on the standalone URL in both standalone and embed views, and JSON-LD only renders standalone", async ({
  page,
}) => {
  await page.goto(`/shop/${DEMO_SHOP_SLUG}/schedule`);
  const standaloneCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  // Resolved against publicAppUrl()'s configured origin (never the worker's
  // own loopback baseURL, which is only where the *test* happens to talk to
  // this server) — assert the path shape, not a host this environment
  // doesn't control.
  expect(standaloneCanonical).toMatch(new RegExp(`/shop/${DEMO_SHOP_SLUG}/schedule$`));
  await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();

  await page.goto(`/shop/${DEMO_SHOP_SLUG}/schedule?embed=1`);
  const embedCanonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(embedCanonical).toBe(standaloneCanonical);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
});

test("the homepage carries a resolvable og:image", async ({ page }) => {
  await page.goto("/");
  const content = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(content).toBeTruthy();
  expect(content).toMatch(/^https?:\/\//);
});

test("the shop schedule page carries its own per-shop og:image", async ({ page }) => {
  await page.goto(`/shop/${DEMO_SHOP_SLUG}/schedule`);
  const content = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(content).toBeTruthy();
  expect(content).toMatch(/^https?:\/\//);
  // Next generates a dedicated route for this file-convention image
  // (src/app/shop/[shopSlug]/schedule/opengraph-image.tsx) rather than
  // falling back to the generic root card — confirm it resolved there.
  expect(content).toContain(`/shop/${DEMO_SHOP_SLUG}/schedule/opengraph-image`);
});
