#!/usr/bin/env node
// Does the public schedule of a real shop draw a trip? (issue #3654)
//
// Nothing else catches a 200 that draws an empty shell: the liveness probe reads `/api/health`,
// which runs no page, and the demo's refresh cron reports only that it ran. This loads
// `/s/<slug>` in a browser, the page a diver is sent to, and fails when it links no departure
// or says "No trips on the books yet". Hourly, from `.github/workflows/public-schedule-canary.yml`,
// whose last step files one `ci-red` issue and closes it on the first green hour.
//
//   node scripts/public-schedule-canary.mjs [--base-url https://dive.day] [--slug <slug>]
//
// The base URL and slug also come from CANARY_BASE_URL and CANARY_SHOP_SLUG, which the workflow
// reads from repository variables: set CANARY_SHOP_SLUG to the pilot shop's slug when there is one.

import process from "node:process";
import { fileURLToPath } from "node:url";
import demoShop from "../src/db/demo-shop.json" with { type: "json" };

export const DEFAULT_BASE_URL = "https://dive.day";
export const DEFAULT_SLUG = demoShop.slug;
/** The diver bundle's empty-schedule sentence (`schedule.noTrips`): a page that says it is empty. */
export const EMPTY_SCHEDULE_TEXT = "No trips on the books yet";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * The distinct departures a page links, from its hrefs: `/s/<slug>/trips/<id>` and nothing deeper
 * (a calendar or arrival-card link on a departure is the same departure).
 */
export function tripHrefPattern(slug) {
  return new RegExp(`^(?:https?://[^/]+)?/s/${escapeRegExp(slug)}/trips/(${UUID})(?:[/?#]|$)`, "i");
}

export function drawnTripIds(hrefs, slug) {
  const pattern = tripHrefPattern(slug);
  const ids = new Set();
  for (const href of hrefs) {
    const match = pattern.exec(String(href ?? ""));
    if (match) ids.add(match[1].toLowerCase());
  }
  return [...ids];
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The verdict on one loaded page: `{ ok, reason }`. A non-200 is a reason of its own; a page that
 * draws trips but also carries the empty sentence is still drawn (a filter can say both).
 */
export function judgeSchedule({ status, hrefs, text, slug }) {
  if (status !== 200) return { ok: false, reason: `the schedule answered ${status}, not 200` };
  const trips = drawnTripIds(hrefs, slug);
  if (trips.length > 0) return { ok: true, reason: `${trips.length} departure(s) drawn` };
  return {
    ok: false,
    reason: String(text ?? "").includes(EMPTY_SCHEDULE_TEXT)
      ? `the schedule says "${EMPTY_SCHEDULE_TEXT}"`
      : "the schedule loaded and links no departure",
  };
}

/**
 * Runs in the browser and in DOM fixtures. Visibility is not viewport intersection:
 * a drawn departure below the fold counts, a hidden Activity/streaming copy does not.
 */
export function visibleScheduleSnapshot({ pattern, emptyText, readyOnly = false }) {
  const surface = document.querySelector("main");
  if (!surface) return readyOnly ? false : { hrefs: [], text: "" };
  const visible = (element) => {
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute("hidden") || current.hasAttribute("inert")) return false;
      const style = current.ownerDocument.defaultView.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.opacity === "0" ||
        style.contentVisibility === "hidden"
      )
        return false;
    }
    return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
  };
  const trip = new RegExp(pattern, "i");
  const hrefs = Array.from(surface.querySelectorAll("a[href]"))
    .filter((link) => {
      if (!visible(link)) return false;
      try {
        const target = new URL(link.getAttribute("href"), document.baseURI);
        return (
          target.origin === new URL(document.baseURI).origin &&
          trip.test(target.pathname + target.search + target.hash)
        );
      } catch {
        return false;
      }
    })
    .map((link) => link.getAttribute("href"));
  if (hrefs.length > 0) return readyOnly ? true : { hrefs, text: "" };
  const text = [];
  const walker = document.createTreeWalker(surface, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement && visible(node.parentElement)) text.push(node.textContent);
  }
  const drawnText = text.join(" ").replace(/\s+/g, " ");
  return readyOnly ? drawnText.includes(emptyText) : { hrefs, text: drawnText };
}

function argValue(args, name) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const base = (
    argValue(args, "--base-url") ||
    process.env.CANARY_BASE_URL ||
    DEFAULT_BASE_URL
  ).replace(/\/$/, "");
  const slug = argValue(args, "--slug") || process.env.CANARY_SHOP_SLUG || DEFAULT_SLUG;
  const url = `${base}/s/${slug}`;
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const response = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    // Scope readiness and the verdict to the same visible same-shop departure set.
    const probe = { pattern: tripHrefPattern(slug).source, emptyText: EMPTY_SCHEDULE_TEXT };
    if (response?.status() === 200)
      await page
        .waitForFunction(
          visibleScheduleSnapshot,
          { ...probe, readyOnly: true },
          { timeout: 20_000 },
        )
        .catch((error) => {
          if (error.name !== "TimeoutError") throw error;
        });
    const { hrefs, text } = await page.evaluate(visibleScheduleSnapshot, probe);
    const verdict = judgeSchedule({ status: response?.status() ?? 0, hrefs, text, slug });
    console.log(`public-schedule-canary: ${url}: ${verdict.reason}`);
    if (!verdict.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`public-schedule-canary: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
