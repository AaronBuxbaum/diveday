import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * The two invariants that keep navigation instant (ADR
 * 20260804-instant-navigation): pages claim `instant = true` under a Suspense
 * boundary unless complete native auth HTML is required, and no layout is async unless it is a known
 * blocking shell that says `instant = false`.
 *
 * `next build` already enforces the important half of this — a route with no
 * `instant = false` above it must produce a non-empty static shell, or the
 * build fails with `blocking-prerender-dynamic`. That is the real gate and this
 * does not replace it. What this adds is speed and a *reason*: the build says
 * "this route blocks", not "because someone put an `await` in a layout", and it
 * takes minutes. A text scan, so it under-reports rather than over-reports — a
 * page whose own `<Suspense>` sits around only half its reads passes here and
 * fails the build, which is the right way round. Moved here from
 * `src/app/instant-coverage.test.ts` (test review 2026-10-14, L2c).
 */

export const APP = "src/app";

/** Complete authentication HTML is required without JavaScript (ADR 20261026-pending-sign-in-challenge). */
export const BLOCKING_PAGES = new Set(["sign-in/page.tsx"]);

/**
 * Layouts allowed to be async, each because something in them must resolve
 * before `{children}` renders and no `<Suspense>` can sit between the two.
 * Every entry declares `instant = false` (checked) and carries its own comment
 * saying why. Adding to this list is a decision, not a fix.
 */
export const BLOCKING_LAYOUTS = new Set([
  // Removing it turned three Playwright specs intermittently red on CI and
  // never locally, in hydration-shaped ways (ADR
  // 20260803-instant-opt-out-placement).
  "shop/[shopSlug]/trips/[id]/layout.tsx",
]);

/** `source` with its comments out, keeping a `//` straight after a colon (a URL). */
export function stripComments(source) {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * What one page is missing. `boundaryAbove` says whether its segment or one
 * above it has a `loading.tsx`.
 */
export function pageProblems(where, source, boundaryAbove) {
  const code = stripComments(source);
  // A page that only redirects never paints, so it has nothing to be instant about.
  if (/\b(permanentRedirect|redirect)\(/.test(code) && !code.includes("return (")) return [];
  const problems = [];
  if (BLOCKING_PAGES.has(where)) {
    if (!/export const instant\s*=\s*false/.test(code))
      problems.push(`${where}: complete-HTML page must declare instant = false`);
    if (code.includes("<Suspense"))
      problems.push(`${where}: streaming the sign-in form prevents native no-JavaScript use`);
    return problems;
  }
  if (!/export const instant\s*=\s*true/.test(code)) {
    problems.push(`${where}: no \`export const instant = true\` — see ADR 20260804`);
  }
  if (!code.includes("<Suspense") && !boundaryAbove) {
    problems.push(`${where}: no loading.tsx in this segment or above, and no <Suspense> inside`);
  }
  return problems;
}

/** What one layout is doing wrong, against the blocking shells allowed. */
export function layoutProblems(where, source, blocking = BLOCKING_LAYOUTS) {
  const code = stripComments(source);
  const isAsync = /export default async function/.test(code);
  const optsOut = /export const instant\s*=\s*false/.test(code);
  const problems = [];
  if (isAsync && !blocking.has(where)) {
    problems.push(
      `${where}: async layout. A layout wraps {children}, so nothing can Suspend between them and this costs every route below it its static shell. Move the read into an async child inside its own <Suspense>, or add it to BLOCKING_LAYOUTS in scripts/check-instant.mjs with a reason.`,
    );
  }
  if (optsOut && !blocking.has(where)) {
    problems.push(`${where}: declares instant = false but is not a known blocking shell`);
  }
  if (blocking.has(where) && !optsOut) {
    problems.push(`${where}: listed as a blocking shell but does not declare instant = false`);
  }
  return problems;
}

async function routeFiles(app, name, found = []) {
  for (const entry of await readdir(app, { withFileTypes: true })) {
    const full = path.join(app, entry.name);
    if (entry.isDirectory()) await routeFiles(full, name, found);
    else if (entry.name === name) found.push(full);
  }
  return found;
}

async function hasBoundaryAbove(app, pageFile) {
  for (let directory = path.dirname(pageFile); ; directory = path.dirname(directory)) {
    if ((await readdir(directory)).includes("loading.tsx")) return true;
    if (directory === app) return false;
  }
}

/** Every problem in the route tree under `root`, and how much was read. */
export async function instantProblems(root = process.cwd()) {
  const app = path.join(root, APP);
  const rel = (file) => path.relative(app, file).replaceAll(path.sep, "/");
  const pages = (await routeFiles(app, "page.tsx")).sort();
  const layouts = (await routeFiles(app, "layout.tsx")).sort();
  const problems = [];
  if (pages.length < 40) problems.push(`found only ${pages.length} pages; the walk is broken`);
  if (layouts.length < 5) problems.push(`found only ${layouts.length} layouts; the walk is broken`);
  for (const file of pages) {
    const source = await readFile(file, "utf8");
    problems.push(...pageProblems(rel(file), source, await hasBoundaryAbove(app, file)));
  }
  for (const file of layouts) {
    problems.push(...layoutProblems(rel(file), await readFile(file, "utf8")));
  }
  return { problems, pages: pages.length, layouts: layouts.length };
}

async function main() {
  const { problems, pages, layouts } = await instantProblems();
  if (problems.length > 0) {
    console.error(
      `Routes that can lose instant navigation:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `instant: ${pages} pages follow their checked navigation policy (${BLOCKING_PAGES.size} complete-HTML exception); ${layouts} layouts stay synchronous`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
