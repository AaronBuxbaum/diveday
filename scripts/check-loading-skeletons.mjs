import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Every `page.tsx` under `src/app` ships a sibling `loading.tsx`, and where
 * both declare a container width those widths match.
 *
 * AGENTS.md states the first half as a hard rule — "a new page ships with a
 * `loading.tsx` and `export const instant = true`" — and
 * `docs/design/principles.md` §10 states the second: "a route's `loading.tsx`
 * wears the **exact same width** as its page, because a skeleton narrower or
 * wider than what replaces it is a sideways layout jump on every navigation
 * into the route."
 *
 * Nothing checked either, and three routes slipped through anyway. Next falls
 * back to the nearest *ancestor* `loading.tsx` when a segment has none, so the
 * defect is not a missing boundary — it is a boundary that paints a picture of
 * a different page. `/s/[shopSlug]/reviews` painted the public schedule's day
 * headers and departure rows at `max-w-6xl` before snapping to a `max-w-4xl`
 * column of review cards; `/shop/[shopSlug]/dive-sites/new` painted the site
 * *library* before landing on a narrow form; `/shop/[shopSlug]/trips/[id]/print`
 * painted the Overview tab before landing on a four-document packet.
 *
 * Why it has to be machine-checked rather than reviewed: each page is
 * individually fine and the missing file is the defect, so there is nothing in
 * a diff to notice. And it does not reproduce locally, where the data is
 * instant — it needs a cold navigation over a slow link, which is exactly the
 * condition the instant-navigation work was for. A check that fails on a
 * `page.tsx` with no sibling `loading.tsx` would have caught all three the day
 * they were added, and catches the fourth.
 *
 * **The width half is deliberately narrow.** It compares the first
 * `mx-auto w-full max-w-*` container each file declares — the outermost
 * work-surface container by convention (`docs/design/principles.md` §10's
 * tiers). A page that delegates its container to a component (`settings`
 * re-exports `SettingsPage`, the legal pages render `LegalDocument`) declares
 * none in-file, and its pair is reported as delegated and skipped rather than
 * guessed at: following an arbitrary component chain would buy a handful of
 * routes at the cost of a check nobody can predict. Those counts are printed
 * on success so the coverage is stated rather than implied. A page that owns
 * no width at all — the trip family, whose `layout.tsx` owns the `<main>` —
 * matches a skeleton that owns none either, which is the correct answer for
 * both.
 */

const ROOT = process.cwd();
const guardedRoot = "src/app";

/**
 * Routes with no `loading.tsx` and no need of one: Next has no ancestor
 * boundary to fall back to, so there is nothing to be inconsistent with, and a
 * skeleton would be motion for its own sake. Keyed by the directory holding
 * the `page.tsx`, relative to `src/app`.
 */
export const SKELETON_EXEMPT = {
  ".": "The marketing home renders its own nav and footer fallbacks; no ancestor boundary exists above it.",
  "sign-in": "A single centred card with nothing streamed into it.",
  switching: "Static competitor index, prerendered; no ancestor boundary above it.",
  "switching/[competitor]":
    "Static per-competitor guide, prerendered; no ancestor boundary above it.",
  "offline-manifest":
    "Reads encrypted IndexedDB in the browser, not the server; there is no server wait to stand in for.",
};

/**
 * The width of the first `mx-auto w-full max-w-*` container in `source`, or
 * null when the file declares none — either because it owns no width (a
 * layout above it does) or because it delegates its container to a component.
 */
export function containerWidth(source) {
  const match = source.match(/mx-auto\s+w-full\s+(max-w-[\w[\]./-]+)/);
  return match ? match[1] : null;
}

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(ROOT, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else files.push(relativePath);
  }
  return files;
}

async function main() {
  const files = await walk(guardedRoot);
  const fileSet = new Set(files);
  const pages = files.filter((file) => path.basename(file) === "page.tsx").sort();

  const missing = [];
  const mismatched = [];
  const staleExemptions = [];
  let compared = 0;
  let delegated = 0;
  let unconstrained = 0;

  for (const page of pages) {
    const directory = path.dirname(page);
    const routeKey = path.relative(path.join(ROOT, guardedRoot), path.join(ROOT, directory)) || ".";
    const loading = path.join(directory, "loading.tsx");
    const hasLoading = fileSet.has(loading);
    const exemptReason = Object.hasOwn(SKELETON_EXEMPT, routeKey)
      ? SKELETON_EXEMPT[routeKey]
      : null;

    if (!hasLoading) {
      if (exemptReason === null) missing.push(page);
      continue;
    }

    // A route that grew a `loading.tsx` no longer needs its exemption, and an
    // exemption nobody can see expiring is how this list rots into fiction.
    if (exemptReason !== null) staleExemptions.push(routeKey);

    const pageWidth = containerWidth(await readFile(path.join(ROOT, page), "utf8"));
    const loadingWidth = containerWidth(await readFile(path.join(ROOT, loading), "utf8"));

    if (pageWidth === null && loadingWidth === null) {
      unconstrained += 1;
      continue;
    }
    if (pageWidth === null) {
      delegated += 1;
      continue;
    }

    compared += 1;
    if (pageWidth !== loadingWidth) {
      mismatched.push({ page, pageWidth, loadingWidth: loadingWidth ?? "(none)" });
    }
  }

  const failures = [];

  if (missing.length > 0) {
    failures.push(
      `Routes with no sibling loading.tsx:\n${missing.map((page) => `- ${page}`).join("\n")}
Each of these paints the nearest ancestor loading.tsx instead, which is a picture of a different page. Add a loading.tsx beside the page, shaped like its body and at its width — copy the idiom from a neighbour such as src/app/shop/[shopSlug]/orders/loading.tsx (an animate-pulse wrapper, bg-surface-sunken bars, sectionCardClass() shells, never a spinner). A route that genuinely needs none goes in SKELETON_EXEMPT in this script with its reason.`,
    );
  }

  if (mismatched.length > 0) {
    failures.push(
      `Skeletons whose container width does not match their page:\n${mismatched
        .map((m) => `- ${m.page}\n    page: ${m.pageWidth}    loading.tsx: ${m.loadingWidth}`)
        .join("\n")}
docs/design/principles.md section 10: a route's loading.tsx wears the exact same width as its page, because a skeleton narrower or wider than what replaces it is a sideways layout jump on every navigation into the route.`,
    );
  }

  if (staleExemptions.length > 0) {
    failures.push(
      `SKELETON_EXEMPT entries for routes that now have a loading.tsx:\n${staleExemptions
        .map((route) => `- ${route}`)
        .join("\n")}
Drop them from SKELETON_EXEMPT in this script.`,
    );
  }

  if (failures.length > 0) {
    console.error(failures.join("\n\n"));
    process.exit(1);
  }

  console.log(
    `loading-skeletons: ${pages.length} pages under ${guardedRoot} — ` +
      `${pages.length - Object.keys(SKELETON_EXEMPT).length} carry a loading.tsx ` +
      `(${Object.keys(SKELETON_EXEMPT).length} exempt); widths compared on ${compared}, ` +
      `${unconstrained} own no width, ${delegated} delegate their container to a component`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
