#!/usr/bin/env node
/**
 * **The whole demo shop on one sheet** (issue #1885): every route a signed-in
 * owner or a diver can reach, photographed at phone width and tiled with
 * captions into one JPG — the first step of a top-down design review.
 *
 * The page budget (60 by default) keeps one run under the load at which a
 * dev server here has been restarted for memory; raise it with `--budget`
 * when the machine has room.
 *
 * `scripts/screenshot.mjs` photographs the paths you name; this one finds them.
 * The inventory is not a crawl: the route ledger (`loadCoverage` in
 * scripts/check-route-coverage.mjs) already lists every `page.tsx` route,
 * computed from the tree, so a new route appears on the
 * sheet without anyone remembering to add it. What a ledger cannot know is a
 * live id or token, so dynamic segments (`[id]`, `[personId]`, `[token]`) are
 * filled from the links on the pages already visited: the first link whose
 * path has a route's shape fills that route. One capture per route shape, so
 * `/shop/x/trips/[id]` and `/shop/x/trips/[id]/manifest` are two tiles and
 * three trips are one.
 *
 * A route that answers 404, or renders the not-found page, is retried once (a supervisor restart can leave a
 * route 404ing briefly, issue #1882) and then reported; a route no link filled
 * is reported too. A sheet that silently omits surfaces is worse than one with
 * its gaps named, because the point is inventory.
 *
 * Sign-in, the browser fallback and the skeleton wait are
 * `scripts/capture-session.mjs`, shared with `screenshot.mjs`. Output goes to
 * the gitignored `screenshots/`; committing a sheet into a canvas is a
 * deliberate act, under `check:design-canvases`' 400,000-byte cap, which the
 * JPG is written under.
 *
 *   node scripts/contact-sheet.mjs [--budget 60] [--columns 10] [--out screenshots] [--base http://localhost:3000]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { loadCoverage } from "./check-route-coverage.mjs";

/** `check:design-canvases` refuses any canvas file of 400,000 bytes or more. */
export const MAX_SHEET_BYTES = 390_000;
export const DEMO_SHOP_SLUG = "blue-mantis";
export const TILE = { width: 390, height: 844 };

/**
 * The ledger's routes with the demo shop's slug in place, the ones no person
 * reaches by a link (`embed` widgets, `print` sheets, the calendar feed) left
 * in: they are surfaces too, and a missing link is reported, not hidden.
 */
export function ledgerRoutes(ledger, shopSlug = DEMO_SHOP_SLUG) {
  return Object.keys(ledger)
    .filter((route) => route.startsWith("/") && !route.startsWith("//"))
    .map((route) => route.replaceAll("[shopSlug]", shopSlug))
    .sort();
}

/** A route's shape as an anchored pattern: each `[segment]` is one path segment. */
export function routePattern(route) {
  const source = route
    .split("/")
    .map((segment) =>
      /^\[[^\]]+\]$/.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${source}$`);
}

const dynamicCount = (route) => (route.match(/\[[^\]]+\]/g) ?? []).length;

/**
 * The route a concrete path is an instance of, or `null`. A static route wins
 * over a dynamic one that also matches, so `/divers/new` is the new-diver form
 * and not a diver whose id is "new".
 */
export function routeFor(routes, pathname) {
  const matches = routes.filter((route) => routePattern(route).test(pathname));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => dynamicCount(a) - dynamicCount(b))[0];
}

/** An internal link's path, query and fragment stripped; `null` for anything else. */
export function internalPath(href, base) {
  try {
    const url = new URL(href, base);
    if (url.origin !== new URL(base).origin) return null;
    return url.pathname.replace(/\/$/, "") || "/";
  } catch {
    return null;
  }
}

/**
 * The next path to open: every static route first, in order, then a dynamic
 * route a link has filled. `null` once the budget is spent or nothing is left.
 */
export function nextVisit({ routes, filled, done, visits, budget }) {
  if (visits >= budget) return null;
  for (const route of routes) {
    if (done.has(route)) continue;
    if (dynamicCount(route) === 0) return { route, pathname: route };
  }
  for (const route of routes) {
    if (done.has(route)) continue;
    const pathname = filled.get(route);
    if (pathname) return { route, pathname };
  }
  return null;
}

/** Where each tile sits on the sheet, `columns` to a row. */
export function tileGeometry(count, columns, tile, caption) {
  const rows = Math.ceil(count / columns);
  return {
    rows,
    width: Math.min(count, columns) * tile.width,
    height: rows * (tile.height + caption),
    position: (index) => ({
      x: (index % columns) * tile.width,
      y: Math.floor(index / columns) * (tile.height + caption),
    }),
  };
}

/**
 * A page that rendered Next's not-found boundary, whatever its status: a
 * `notFound()` inside a streamed boundary can arrive after a 200, so the
 * status alone misses it. A dev server, which is what this runs against,
 * marks the page either way: `next-error` from the server render,
 * `boundary-next-error` from the client boundary.
 */
export const NOT_FOUND_MARKER =
  'meta[name="next-error"][content="not-found"], meta[name="boundary-next-error"][content="not-found"]';

const SERVER_WENT_AWAY =
  /net::ERR_CONNECTION_(REFUSED|RESET|CLOSED)|net::ERR_EMPTY_RESPONSE|ECONNREFUSED|ECONNRESET/i;

/** Poll the health route for up to 30s; the retry after it says the rest. */
async function serverBack(base) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5_000) })).ok) return;
    } catch {
      // Still down.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** A staff route needs the owner's session; every other one is photographed signed out. */
export const isStaffRoute = (route) => route.startsWith("/shop/");

function parseArgs(argv) {
  const args = { base: "http://localhost:3000", out: "screenshots", budget: 60, columns: 10 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") args.base = argv[++index];
    else if (arg === "--out") args.out = argv[++index];
    else if (arg === "--budget") args.budget = Number(argv[++index]);
    else if (arg === "--columns") args.columns = Number(argv[++index]);
    else {
      console.error(
        `Unknown argument ${arg}. Usage: node scripts/contact-sheet.mjs [--budget 60] [--columns 10] [--out screenshots] [--base http://localhost:3000]`,
      );
      process.exit(1);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { launch, signInOnce, waitPastTheSkeleton } = await import("./capture-session.mjs");
  const { default: sharp } = await import("sharp");
  const { OFFLINE_SETTLED_SELECTOR } = await import("./screenshot-guards.mjs");
  const routes = ledgerRoutes(await loadCoverage(process.cwd()));
  const shotsDir = path.join(args.out, "contact-sheet");
  fs.mkdirSync(shotsDir, { recursive: true });

  const browser = await launch();
  const captured = [];
  const failed = [];
  try {
    const storageState = await signInOnce(browser, args.base, "owner");
    const contextOptions = {
      viewport: TILE,
      colorScheme: "light",
      reducedMotion: "reduce",
    };
    const staff = await (await browser.newContext({ ...contextOptions, storageState })).newPage();
    const visitor = await (await browser.newContext(contextOptions)).newPage();

    const filled = new Map();
    const done = new Set();
    let visits = 0;
    for (;;) {
      const next = nextVisit({ routes, filled, done, visits, budget: args.budget });
      if (!next) break;
      done.add(next.route);
      const page = isStaffRoute(next.route) ? staff : visitor;
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
        visits += 1;
        try {
          const response = await page.goto(`${args.base}${next.pathname}`, { waitUntil: "load" });
          if (response?.status() === 404) continue;
          await waitPastTheSkeleton(page, next.pathname);
          if ((await page.locator(NOT_FOUND_MARKER).count()) > 0) continue;
          // The offline viewer opens on "Opening…" while it reads the device's
          // store; it marks the page once that read has settled (#2235).
          if (next.pathname === "/offline-manifest") {
            await page.waitForSelector(OFFLINE_SETTLED_SELECTOR, { state: "attached" });
          }
          ok = true;
        } catch (error) {
          const why = String(error?.message ?? error).split("\n")[0];
          if (attempt === 1) failed.push({ ...next, why });
          // A supervisor restart drops the connection; wait for the server
          // to answer again before the one retry (scripts/dev-server.mjs).
          else if (SERVER_WENT_AWAY.test(why)) await serverBack(args.base);
        }
      }
      if (!ok) {
        if (!failed.some((entry) => entry.route === next.route)) {
          failed.push({ ...next, why: "answered not-found twice" });
        }
        continue;
      }
      const hrefs = await page.$$eval("a[href]", (anchors) =>
        anchors.map((a) => a.getAttribute("href")),
      );
      for (const href of hrefs) {
        const pathname = internalPath(href, args.base);
        const route = pathname && routeFor(routes, pathname);
        if (route && !filled.has(route) && dynamicCount(route) > 0) filled.set(route, pathname);
      }
      // Next's dev badge sits on every tile's corner otherwise; it is the dev
      // server's chrome, not the page's.
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      const file = path.join(shotsDir, `${String(captured.length).padStart(3, "0")}.png`);
      await page.screenshot({ path: file, caret: "initial" });
      captured.push({ ...next, title: await page.title(), file });
    }
    const unreached = routes.filter((route) => !done.has(route));

    const caption = 44;
    const geometry = tileGeometry(captured.length, args.columns, TILE, caption);
    const composites = [];
    for (const [index, shot] of captured.entries()) {
      const { x, y } = geometry.position(index);
      composites.push({ input: shot.file, left: x, top: y });
      const label = (text) =>
        text.replace(
          /[&<>]/g,
          (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character],
        );
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE.width}" height="${caption}"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="18" font-family="sans-serif" font-size="14" font-weight="600">${label(shot.title.slice(0, 48))}</text><text x="8" y="36" font-family="monospace" font-size="12" fill="#555">${label(shot.pathname.slice(0, 52))}</text></svg>`;
      composites.push({ input: Buffer.from(svg), left: x, top: y + TILE.height });
    }
    const sheet = sharp({
      create: {
        width: geometry.width,
        height: geometry.height,
        channels: 3,
        background: "#ffffff",
      },
    }).composite(composites);
    const full = await sheet.png().toBuffer();
    // Smaller and softer until it fits under the canvas guard's cap: quality
    // first, then width, so the sheet stays legible as long as it can.
    let bytes = null;
    for (const scale of [0.5, 0.4, 0.33, 0.25, 0.2]) {
      for (const quality of [72, 60, 50, 40]) {
        bytes = await sharp(full)
          .resize({ width: Math.round(geometry.width * scale) })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
        if (bytes.length <= MAX_SHEET_BYTES) break;
      }
      if (bytes.length <= MAX_SHEET_BYTES) break;
    }
    const sheetPath = path.join(args.out, "contact-sheet.jpg");
    fs.writeFileSync(sheetPath, bytes);

    console.log(
      `contact-sheet: ${captured.length} surfaces of ${routes.length} routes on ${sheetPath} (${Math.round(bytes.length / 1024)} KB), ${visits} page loads of a ${args.budget} budget.`,
    );
    for (const entry of failed)
      console.log(`- not captured: ${entry.route} (${entry.pathname}) — ${entry.why}`);
    for (const route of unreached) {
      console.log(
        `- not reached: ${route} — ${dynamicCount(route) > 0 && !filled.has(route) ? "no link on a visited page had its shape" : "the page budget ran out first"}`,
      );
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
