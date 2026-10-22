import { appendFileSync, mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { embedRenderPath } from "../src/lib/embed-routes";
import { ARRIVAL_MAP_PROBES, MAP_REACHABILITY_PROBES } from "../src/lib/maps";
import { makeActivitySafe } from "./fixtures";
import { E2E_TEST_ROUTE_SECRET } from "./servers";

/** Includes a pulse on main itself, which several marketing skeletons use. */
export const INITIAL_PAINT_FALLBACK =
  "main.animate-pulse:not([data-live-pulse]), main .animate-pulse:not([data-live-pulse]), [data-suspense-placeholder]";

type RendererBound = <T>(
  page: Page,
  what: string,
  budgetMs: number,
  work: Promise<T>,
  degraded: T,
) => Promise<T>;

const visited = new Set<string>();
let coverage: Promise<typeof import("../scripts/check-route-coverage.mjs")> | undefined;
let routes: Promise<string[]> | undefined;

async function routeFor(url: URL): Promise<string | null> {
  // Native dynamic import keeps the ESM tooling outside Playwright's CJS
  // module transform, matching the visual suite's existing probe import.
  coverage ??= import("../scripts/check-route-coverage.mjs");
  const { collectRoutes, routesForPath } = await coverage;
  routes ??= collectRoutes(process.cwd());
  // These canonical URLs are rewritten to distinct skeleton-bearing segments.
  const renderedPath =
    (url.searchParams.get("embed") === "1" && embedRenderPath(url.pathname)) || url.pathname;
  return routesForPath(await routes, renderedPath)[0] ?? null;
}

function record(value: {
  route: string;
  locale: string;
  sourceCapture: string;
  outcome: "fallback" | "server-content" | "shell-only" | "redirected";
  renderedRoute?: string | null;
  capture?: string;
}) {
  mkdirSync("e2e/pixel-probe", { recursive: true });
  // Record patterns only: capability URLs and account-link tokens stay local
  // to the browser, rather than becoming a route-coverage artifact.
  appendFileSync("e2e/pixel-probe/initial-paint.jsonl", `${JSON.stringify(value)}\n`);
}

/**
 * Real first-paint HTML, with Next's streamed-content reveal scripts held off.
 * This audits the fallback the server actually sent, not a reconstructed
 * loading component. A completed SSR document is recorded separately; it does
 * not prove that an unused loading.tsx was seen.
 *
 * The caller supplies its existing bounded capture path. This helper never
 * weakens the ordinary capture's rule that a skeleton must have disappeared.
 */
export async function auditInitialPaint(
  page: Page,
  sourceCapture: string,
  bound: RendererBound,
  captureFallback: (page: Page, name: string) => Promise<void>,
): Promise<void> {
  if (process.env.VISUAL_AUDIT_INITIAL_PAINT !== "1") return;
  const url = new URL(page.url());
  const route = await routeFor(url);
  if (!route) return;
  const locale = await bound(
    page,
    "reading the initial-paint audit language",
    5_000,
    page.evaluate(() => navigator.language),
    "unknown",
  );
  if (locale === "unknown") throw new Error("Initial-paint audit could not read its language");
  const key = `${route}:${locale}`;
  if (visited.has(key)) return;
  const browser = page.context().browser();
  if (!browser) throw new Error("Initial-paint audit needs the test's browser");
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    javaScriptEnabled: false,
    colorScheme: "light",
    locale,
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { authorization: `Bearer ${E2E_TEST_ROUTE_SECRET}` },
  });
  try {
    // Match the ordinary context's deterministic, local-only external frames
    // and fonts. Context routes are not inherited from the source context.
    await context.route("https://www.openstreetmap.org/export/embed.html*", (request) =>
      request.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" }),
    );
    for (const probe of [...MAP_REACHABILITY_PROBES, ...ARRIVAL_MAP_PROBES]) {
      await context.route(probe, (request) => request.abort());
    }
    await context.route("https://fonts.googleapis.com/**", (request) =>
      request.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
    await context.route("https://fonts.gstatic.com/**", (request) => request.abort());

    const rawPage = await context.newPage();
    // Save before wrapping: the normal staff hydration wait correctly cannot
    // finish in a context whose application JavaScript is deliberately off.
    const goto = rawPage.goto.bind(rawPage);
    const initialPage = makeActivitySafe(rawPage);
    await goto(url.href, { waitUntil: "load" });
    const renderedRoute = await routeFor(new URL(initialPage.url()));
    if (renderedRoute !== route) {
      record({ route, locale, sourceCapture, outcome: "redirected", renderedRoute });
      return;
    }
    const fallback = initialPage.locator(INITIAL_PAINT_FALLBACK).filter({ visible: true });
    const fallbackCount = await bound(
      initialPage,
      "counting visible first-paint fallbacks",
      5_000,
      fallback.count(),
      null,
    );
    if (fallbackCount === null) throw new Error(`Initial-paint audit could not inspect ${route}`);
    if (fallbackCount > 0) {
      const capture = `initial-paint-${route.replace(/[^A-Za-z0-9]+/g, "-")}-${locale}`;
      await captureFallback(initialPage, capture);
      record({ route, locale, sourceCapture, outcome: "fallback", capture });
    } else {
      // Positive rendered content distinguishes a completed SSR response from
      // a blank document. There is no timer guessing when a pulse might land:
      // load completed with JavaScript disabled, so the server DOM is final.
      const hasContent = await bound(
        initialPage,
        "checking completed first-paint server content",
        5_000,
        initialPage.evaluate(() => {
          const subjects = document.querySelectorAll<HTMLElement>(
            "main, .paper-sheet-frame, #work-order-tag",
          );
          return Array.from(subjects).some(
            (subject) => subject.getClientRects().length > 0 && subject.innerText.trim().length > 0,
          );
        }),
        null,
      );
      if (hasContent === null) throw new Error(`Initial-paint audit could not inspect ${route}`);
      record({
        route,
        locale,
        sourceCapture,
        outcome: hasContent ? "server-content" : "shell-only",
      });
    }
    visited.add(key);
  } finally {
    await context.close();
  }
}
