#!/usr/bin/env node
// Does the public schedule of a real shop draw a trip? (issue #3654)
//
// Nothing else catches a 200 that draws an empty shell: the liveness probe reads `/api/health`,
// which runs no page, and the demo's refresh cron reports only that it ran. This loads
// `/s/<slug>` in a browser, the page a diver is sent to, and fails when it links no departure
// or says "No trips on the books yet". Hourly, from `.github/workflows/public-schedule-canary.yml`,
// whose last step files one `ci-red` issue and closes it on the first green hour.
//
//   node scripts/public-schedule-canary.mjs [--base-url https://dive.day] [--slug blue-mantis]
//
// The base URL and slug also come from CANARY_BASE_URL and CANARY_SHOP_SLUG, which the workflow
// reads from repository variables: set CANARY_SHOP_SLUG to the pilot shop's slug when there is one.

import process from "node:process";
import { fileURLToPath } from "node:url";
import demoShop from "../src/db/demo-shop.json" with { type: "json" };

export const DEFAULT_BASE_URL = "https://dive.day";
/** The demo shop (src/db/demo-shop.json), until a pilot shop sets CANARY_SHOP_SLUG. */
export const DEFAULT_SLUG = demoShop.slug;
/** The diver bundle's empty-schedule sentence (`schedule.noTrips`): a page that says it is empty. */
export const EMPTY_SCHEDULE_TEXT = "No trips on the books yet";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * The distinct departures a page links, from its hrefs: `/s/<slug>/trips/<id>` and nothing deeper
 * (a calendar or arrival-card link on a departure is the same departure).
 */
export function drawnTripIds(hrefs, slug) {
  const pattern = new RegExp(
    `^(?:https?://[^/]+)?/s/${escapeRegExp(slug)}/trips/(${UUID})(?:[/?#]|$)`,
    "i",
  );
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
    // The shell can paint before the board does; wait for either answer, then judge.
    await page
      .waitForFunction(
        (empty) =>
          document.querySelector('a[href*="/trips/"]') !== null ||
          document.body.innerText.includes(empty),
        EMPTY_SCHEDULE_TEXT,
        { timeout: 20_000 },
      )
      .catch(() => {});
    const hrefs = await page.$$eval("a[href]", (links) =>
      links.map((link) => link.getAttribute("href")),
    );
    const text = await page.evaluate(() => document.body.innerText);
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
