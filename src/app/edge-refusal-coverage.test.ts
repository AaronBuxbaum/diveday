import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { publicRouteShape } from "@/lib/public-route-shape";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(APP_DIR, "..", "..", "public");
const PROXY_SOURCE = join(APP_DIR, "..", "proxy.ts");

/**
 * **A public route cannot go back to answering 200 for a slug that names
 * nothing** (issue #1734, ADR
 * 20260912-the-public-namespace-refuses-at-the-edge).
 *
 * The bug this guards is not a wrong answer, it is silence. Under
 * `cacheComponents` a `notFound()` in a dynamic page body arrives after the
 * static shell has streamed at 200, so the status has to be decided in
 * `src/proxy.ts` — and the proxy decides it by asking
 * `publicRouteShape(pathname)`, **which passes a pathname it does not
 * recognise straight through**. A route the shape module was never taught is
 * therefore a soft 404 that no assertion anywhere reads: the page renders the
 * right words, every heading assertion in `e2e/` stays green, and a crawler
 * keeps the URL.
 *
 * That is not hypothetical. It is exactly what happened: the refusal shipped
 * for `/s/**`, and `/dive/[region]`, `/switching/[competitor]` and
 * `/demo/[story]` went on answering 200 through three issues (#1489, #1510,
 * #1604) and six weeks without a single test going red. Adding a fourth route
 * would have cost nothing and been noticed by nobody.
 *
 * So recognition is pinned to the route tree rather than to memory. The tree
 * is read off the filesystem for the reason `capability-refusals.test.ts` gives
 * about capability routes: a route is created by adding a directory, and
 * nothing about that act reminds anyone to come here.
 *
 * ## The two directions, and why the second one matters as much
 *
 * A dynamic route must be **refusable**: the edge has an opinion about a slug
 * that names nothing. A static route must be **untouchable**: it always has a
 * page to serve, so an edge with an opinion about it is a shipped page taken
 * off the internet. The second direction is not decoration — writing this test
 * caught `/switching/spreadsheet`, a live guide whose slug is deliberately
 * absent from `MIGRATION_GUIDE_SLUGS` because a spreadsheet is not an
 * incumbent, being read as an unregistered competitor and refused.
 */

/** Every `page.tsx` route under `src/app`, as a URL path. */
function pageRoutes(dir = APP_DIR, trail: string[] = []): string[] {
  const found: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === "page.tsx")) {
    found.push(`/${trail.join("/")}`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Route groups `(marketing)` and private folders `_components` are not URL
    // segments; the former would add a segment the router never serves, and the
    // latter holds no routes at all.
    if (entry.name.startsWith("_")) continue;
    const segment = entry.name.startsWith("(") ? trail : [...trail, entry.name];
    found.push(...pageRoutes(join(dir, entry.name), segment));
  }
  return found;
}

const isDynamic = (route: string) => route.includes("[");

/**
 * The staff namespace, out of scope as a class rather than route by route.
 *
 * `/shop/**` is auth-gated without exception (ADR
 * 20260803-public-shop-namespace): every page opens with `requireShopSurface`,
 * nothing in it is crawlable, and a staffer who mistypes a trip id reads the
 * refusal rather than a status line. There is no crawl budget to lose and no
 * soft 404 to be read by anything, so the edge deliberately asks nothing about
 * it — which is also what keeps an authenticated page off the anonymous read
 * path.
 */
const STAFF_PREFIX = "/shop/";

/**
 * Dynamic public routes the edge deliberately has no opinion about, each with
 * the reason. Adding to this is a decision, not a fix.
 *
 * Every entry today is a bearer-token route, where the URL *is* the capability:
 * the token has to be hashed, compared and checked for expiry, which is a row
 * question and the page's own. None of them can soft-404 in the first place —
 * `capability-refusals.test.ts` holds every one of them to never calling
 * `notFound()` at all, each refusing in place with its own expired-link card —
 * and each is `noindex`, so no crawler is reading a status off them.
 */
const EDGE_EXEMPT = new Map<string, string>(
  [
    "/claim/[token]",
    "/confirm-contact/[token]",
    "/invite/[token]",
    "/ready/[token]",
    "/recap/[token]",
    "/reset-password/[token]",
    "/unsubscribe/[token]",
    "/verify/[token]",
    "/waivers/[token]",
  ].map((route) => [
    route,
    "a bearer-token route: the token is a row question, and the page is noindex",
  ]),
);

/**
 * A concrete URL for a route pattern. `probe` is a well-formed slug in every
 * charset this app mints, so a shape that comes back `malformed` or `absent`
 * did so because the *route* is judged, not because the segment was junk.
 */
const probePath = (route: string) => route.replace(/\[\[?\.{0,3}([^\]]+)\]?\]/g, "probe");

describe("the edge refusal covers the public route tree", () => {
  const routes = pageRoutes();
  const publicRoutes = routes.filter((route) => !route.startsWith(STAFF_PREFIX));

  it("finds the route tree", () => {
    // Guards the guard: an empty or truncated walk makes everything below
    // vacuous. `/` is the landing page, and its presence proves the walk
    // started at `src/app` rather than at some directory inside it.
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain("/");
    expect(routes.filter(isDynamic).length).toBeGreaterThan(20);
    expect(publicRoutes.filter(isDynamic).length).toBeGreaterThan(10);
  });

  it("has an opinion about every dynamic public route, or a written reason not to", () => {
    const failures = publicRoutes.filter(isDynamic).flatMap((route) => {
      const exempt = EDGE_EXEMPT.get(route);
      const shape = publicRouteShape(probePath(route));
      if (exempt) return shape === null ? [] : [`${route}: exempt, but the edge judges it anyway`];
      if (shape !== null) return [];
      return [
        `${route}: publicRouteShape has no opinion about ${probePath(route)}, so an unknown ` +
          `slug answers 200 with the not-found page in the body and a crawler keeps the URL. ` +
          `Teach src/lib/public-route-shape.ts what this route claims to name, or add it to ` +
          `EDGE_EXEMPT with a reason.`,
      ];
    });
    expect(failures).toEqual([]);
  });

  it("never has an opinion about a route that always has a page to serve", () => {
    // The direction that costs an outage rather than crawl budget. A static
    // route renders whatever the closed lists say, and Next's router prefers it
    // to any dynamic sibling, so an edge refusal here is a live page 404ing.
    const failures = publicRoutes
      .filter((route) => !isDynamic(route))
      .filter((route) => publicRouteShape(route) !== null)
      .map(
        (route) =>
          `${route}: the edge refuses a static route, which would take a shipped page off ` +
          `the internet. It is most likely being read as a miss from the closed list of a ` +
          `dynamic sibling — see STATIC_SIBLINGS in src/lib/public-route-shape.ts.`,
      );
    expect(failures).toEqual([]);
  });

  it("keeps no exemption for a route that no longer exists", () => {
    expect([...EDGE_EXEMPT.keys()].filter((route) => !routes.includes(route))).toEqual([]);
  });
});

/**
 * The proxy's `config.matcher`, read off the source. Next reads `config` from
 * `src/proxy.ts` statically, so it has to be a literal there; importing the
 * module would evaluate the database client for one string.
 */
function proxyMatcher(): string[] {
  const source = readFileSync(PROXY_SOURCE, "utf8");
  const literal = /export const config = \{\s*matcher:\s*(\[[^\]]*\])/.exec(source)?.[1];
  if (!literal) throw new Error("expected `export const config = { matcher: [...] }` in proxy.ts");
  // Biome writes a trailing comma inside a wrapped array; JSON does not take one.
  return JSON.parse(literal.replace(/,\s*\]$/, "]")) as string[];
}

const reachesProxy = (url: string) =>
  unstable_doesMiddlewareMatch({ config: { matcher: proxyMatcher() }, url });

/** Every file under `public/`, as the URL path it is served at. */
function publicFiles(dir = PUBLIC_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? publicFiles(join(dir, entry.name))
      : [`/${relative(PUBLIC_DIR, join(dir, entry.name)).split(sep).join("/")}`],
  );
}

/**
 * **A dynamic public URL ending in `.png` still reaches the edge refusal**
 * (issue #2093).
 *
 * The matcher used to skip every path ending `.svg`, `.png`, `.jpg` or `.ico`,
 * which meant `/product/kiosk.png`, `/switching/eve.png` and
 * `/s/<shop>/trips/x.jpg` never met `publicRouteShape` and answered 200 with
 * the not-found page in the body: the soft 404 the test above exists to stop,
 * arrived at through the side door. Only files that are really on disk skip
 * the proxy now, and both directions are pinned here.
 */
describe("the proxy matcher skips static files and nothing else", () => {
  const publicRoutes = pageRoutes().filter((route) => !route.startsWith(STAFF_PREFIX));

  it("reads the matcher", () => {
    expect(proxyMatcher().length).toBeGreaterThan(0);
  });

  it("sends every dynamic public route through the proxy, whatever its last segment ends in", () => {
    const failures = publicRoutes
      .filter(isDynamic)
      .filter((route) => !EDGE_EXEMPT.has(route))
      .flatMap((route) =>
        [".png", ".jpg", ".svg", ".ico"].map((extension) => `${probePath(route)}${extension}`),
      )
      .filter((url) => !reachesProxy(url));
    expect(failures).toEqual([]);
    for (const url of ["/product/kiosk.png", "/switching/eve.png", "/s/blue-mantis/trips/x.jpg"])
      expect(reachesProxy(url), url).toBe(true);
  });

  it("still sends a static public page through the proxy", () => {
    const failures = publicRoutes.filter((route) => !isDynamic(route) && !reachesProxy(route));
    expect(failures).toEqual([]);
  });

  it("lets every image under public/ and the app's own icons skip it", () => {
    const images = [
      ...publicFiles().filter((path) => /\.(?:svg|png|jpg|ico)$/.test(path)),
      "/icon.png",
      "/apple-icon.png",
    ];
    expect(images.length).toBeGreaterThan(100);
    expect(images.filter(reachesProxy)).toEqual([]);
    expect(reachesProxy("/_next/static/chunks/app.js")).toBe(false);
    expect(reachesProxy("/_next/image?url=%2Fdive-sites%2Fx.jpg&w=640&q=75")).toBe(false);
    expect(reachesProxy("/api/health")).toBe(false);
  });

  it("sends a staff path ending in an image extension through the proxy too", () => {
    // `/shop/**` is staff without exception; the old matcher let any of it that
    // ended `.png` past the edge's session check, straight to the page gate.
    for (const url of ["/shop/blue-mantis/dive-sites/x.png", "/shop/x/foo.jpg"])
      expect(reachesProxy(url), url).toBe(true);
  });
});
