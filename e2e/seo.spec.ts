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
    "/board/",
  ]) {
    expect(body).toContain(`Disallow: ${prefix}`);
  }
  expect(body).toMatch(/^Sitemap: .*\/sitemap\.xml$/m);
  // The one line the old metadata convention could not carry (issue #1427).
  expect(body).toMatch(/^# Agents: .*\/llms\.txt$/m);
});

/**
 * The agent-facing storefront (issue #1427, N-50): a site-level `llms.txt`
 * that says where a shop's schedule, availability and booking page live, and
 * a per-shop `availability.json` an agent reads to find a departure before
 * handing its reader to the booking page. The demo shop is served here (its
 * document is what the fleet can read); the opt-out 404 is asserted in
 * `settings-findability.spec.ts`, where a private shop flips the switch.
 */
test("llms.txt tells an agent where the schedule, availability and booking page are", {
  tag: READ_ONLY,
}, async ({ page }) => {
  const response = await page.request.get("/llms.txt");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
  const body = await response.text();
  expect(body.startsWith("# DiveDay")).toBe(true);
  expect(body).toContain("/s/<shop-slug>/availability.json");
  expect(body).toContain("/s/<shop-slug>/trips/<trip-id>");
  expect(body).toMatch(/Bookings happen on this page and only here/);
  // The demo shop is a fixture, never a listed business (same scope as the sitemap).
  expect(body).not.toContain(`/s/${DEMO_SHOP_SLUG}`);
});

test("a shop's availability.json carries only what an agent needs to find a seat and hand off", {
  tag: READ_ONLY,
}, async ({ page }) => {
  const response = await page.request.get(`/s/${DEMO_SHOP_SLUG}/availability.json`);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toMatch(/^application\/json/);
  expect(response.headers()["cache-control"]).toContain("max-age=");
  expect(response.headers()["x-robots-tag"]).toBe("noindex");
  const body = await response.json();
  expect(body.schema).toBe("diveday/availability/v1");
  expect(body.shop.slug).toBe(DEMO_SHOP_SLUG);
  expect(
    body.departures.length,
    "the frozen-clock seed has open seats inside two weeks",
  ).toBeGreaterThan(0);
  for (const departure of body.departures) {
    expect(departure.seats_open).toBeGreaterThan(0);
    expect(departure.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
    expect(departure.booking_url).toMatch(
      new RegExp(`/s/${DEMO_SHOP_SLUG}/trips/${departure.id}$`),
    );
    expect(Object.keys(departure).sort()).toEqual(
      [
        "booking_url",
        "certification",
        "ends_at",
        "id",
        "price",
        "seats_open",
        "sites",
        "starts_at",
        "time_zone",
        "title",
      ].sort(),
    );
  }
  // Nothing about a person: the seeded cast's names must never reach it.
  const text = JSON.stringify(body);
  for (const name of ["Adaeze", "Nwosu", "@"]) expect(text).not.toContain(name);
});

test("the schedule page's JSON-LD points at the availability document", { tag: READ_ONLY }, async ({
  page,
}) => {
  await page.goto(`/s/${DEMO_SHOP_SLUG}`);
  // `<script>` has no layout box — left unfiltered, like every head query in this file.
  const graphs = await page.locator('script[type="application/ld+json"]').allTextContents();
  const schedule = graphs.map((json) => JSON.parse(json)).find((graph) => graph.subjectOf);
  expect(schedule?.subjectOf).toMatchObject({
    "@type": "DataFeed",
    encodingFormat: "application/json",
  });
  expect(schedule?.subjectOf.url).toMatch(new RegExp(`/s/${DEMO_SHOP_SLUG}/availability\\.json$`));
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

/**
 * **The crawler-facing status of a dead link, asserted as a status.**
 *
 * This sits beside robots.txt and sitemap.xml because it is the same kind of
 * fact: what a crawler is told about a URL. `robots.txt` says where not to
 * look, `sitemap.xml` says what is worth indexing, and this says what happens
 * to everything else.
 *
 * It is a status assertion rather than a heading assertion on purpose. Every
 * unknown URL in this namespace already rendered the right not-found page, so
 * every heading assertion in `e2e/` was green for the whole life of the soft
 * 404 — the shell streamed at 200, `notFound()` landed in the body far too
 * late to change a status, and a crawler kept the page. Three issues (#1489,
 * #1510, #1604) chased that without a single test going red, because no test
 * was reading the one byte that was wrong. The refusal now happens above the
 * streaming boundary in `src/proxy.ts` (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge), and this is the
 * assertion that can tell.
 *
 * The two 200s at the end are not decoration: a guard that only proves
 * unknown URLs are refused is satisfied by refusing every URL, which would be
 * the far worse bug — a shop's storefront off the internet.
 *
 * The `no-store` assertion is a floor, not a discriminator, and that is worth
 * knowing before trusting it: in this build Next's own default for a response
 * it did not prerender is already `private, no-cache, no-store, max-age=0,
 * must-revalidate`, so this passes with or without the proxy's own stamp
 * (measured 2026-09-12). It is here because the promise — a negative answer is
 * never pinned to a URL that later becomes real — is DiveDay's rather than the
 * framework's, and this is the only assertion in the repository that reads it
 * off the wire. `src/proxy.test.ts` is what goes red if the stamp is removed.
 */
test("an unknown URL under /s/** answers 404, not 200 with the not-found page", {
  tag: READ_ONLY,
}, async ({ page }) => {
  for (const path of [
    // A shop slug nobody minted.
    "/s/no-such-shop-here",
    // …and one of its children, which must not resolve past its missing shop.
    "/s/no-such-shop-here/courses",
    // The one route in the namespace that states a caching intent of its own —
    // its handler answers 404 `no-store` deliberately, and for a shop that does
    // not exist the edge refuses before the handler runs.
    "/s/no-such-shop-here/availability.json",
    // A live shop, naming a course, a site and a departure it does not have.
    `/s/${DEMO_SHOP_SLUG}/courses/nope-nope`,
    `/s/${DEMO_SHOP_SLUG}/sites/somebody-elses-ledge`,
    `/s/${DEMO_SHOP_SLUG}/trips/00000000-0000-4000-8000-000000000000`,
    // Segments no shop could have minted: refused on shape, before any query.
    `/s/${DEMO_SHOP_SLUG}/sites/Molasses%20Reef`,
    `/s/${DEMO_SHOP_SLUG}/trips/nope`,
  ]) {
    const res = await page.request.get(path);
    expect(res.status(), path).toBe(404);
    // A negative answer must never be pinned to a URL that later becomes real:
    // a shop slug probed before onboarding finishes, a course slug probed
    // before the shop publishes it.
    expect(res.headers()["cache-control"], path).toContain("no-store");
  }

  // The one path that answered 404 before any of this — the widget catalogue,
  // refused at the edge since it shipped. It is asserted separately because it
  // is a complete response rather than a rewrite, and its segment is a closed
  // list in this repository that no row can turn real.
  expect((await page.request.get(`/s/${DEMO_SHOP_SLUG}/embed/nope`)).status()).toBe(404);

  for (const path of [
    `/s/${DEMO_SHOP_SLUG}`,
    `/s/${DEMO_SHOP_SLUG}/courses/discover-scuba-diving`,
  ]) {
    expect((await page.request.get(path)).status(), path).toBe(200);
  }
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

/**
 * The card is `src/app/link-card/route.tsx`, not a metadata convention file:
 * Next attaches a convention file to every page entry in its subtree, and the
 * root segment's subtree is the whole app (issue #1709). Nothing generates the
 * URL any more — `sharedLinkCardImage` in `src/lib/site-metadata.ts` names it —
 * so the two halves can disagree, and a card nobody in this repo ever looks at
 * is exactly the place a 404 would sit unnoticed. This walks the whole hop: the
 * tag, the URL it names, and the bytes that come back from it.
 */
test("the homepage carries a resolvable og:image", { tag: READ_ONLY }, async ({ page }) => {
  await page.goto("/");
  const content = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(content).toBeTruthy();
  expect(content).toMatch(/^https?:\/\//);
  expect(content, "the root layout and `/` both name the card route").toContain("/link-card");

  // Fetched relative, never through the tag's own href: `metadataBase` is baked
  // at build time from E2E_APP_HOST, which is a reserved `.example` host no
  // worker can reach (e2e/servers.ts).
  const card = await page.request.get("/link-card");
  expect(card.ok()).toBe(true);
  expect(card.headers()["content-type"]).toContain("image/png");
  // A severed stream can still arrive as a 200 with an empty body (ADR
  // 20260804-og-svg-rasterizer), so the bytes are the assertion that actually
  // distinguishes a rendered card.
  expect((await card.body()).length).toBeGreaterThan(1000);
});

/**
 * The other half of the same move: a page with no `openGraph` block of its own
 * inherits the root layout's, and the card used to arrive there by file
 * convention. It is named on the floor now, and this is the page that proves
 * the floor still carries it.
 */
test("a page with no unfurl words of its own still inherits the card", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/sign-in");
  const content = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(content).toContain("/link-card");
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
