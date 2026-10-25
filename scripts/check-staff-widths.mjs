import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **A staff page comes in two widths, and the shell sets them.**
 *
 * `reading` and `full` live in `src/app/shop/[shopSlug]/_components/staff-page.ts`;
 * a page declares one at its shell call, `<StaffPage width="full">`, and its
 * `loading.tsx` declares the same. Until the 2026-10-24 visual review (A04)
 * each page spelled its own `<main>` at one of five widths, so the heading's
 * left edge and the header actions' right edge moved on every tab change.
 *
 * Two things fail here:
 *
 * 1. A `max-w-<n>xl` in a staff `page.tsx` or `loading.tsx` that is not on
 *    the allowlist below. Each entry bounds something inside a page (a
 *    paragraph's measure, one card, a skeleton bar), never the page, and
 *    carries its reason. A new page width is not an entry: it is one of the
 *    two widths.
 * 2. A page and its sibling skeleton that both draw `StaffPage` at different
 *    widths, which is a sideways jump on every navigation into the route.
 *    (`check-loading-skeletons.mjs` compares only spelled `max-w-*` classes,
 *    and a staff pair spells none.)
 * 3. A `<main>` with its own `max-w-<n>xl` in any file under a staff
 *    `_components` folder: a view a page hands its whole body to (Reports'
 *    "This year", the dive-site catalog) is the page, and spelling its own
 *    shell made "This year" sit 16px off "This month" (layer 5 triage). Only a
 *    `<main>` counts here; a component's other `max-w-*` bounds a measure.
 *
 * Comments are read out first, so a docblock may say what a width used to be.
 */

export const SHOP = "src/app/shop/[shopSlug]";

const WIDTH_CLASS = /max-w-[0-9]xl/g;

/**
 * Every in-page `max-w-<n>xl` the guard lets stand: path under `SHOP` →
 * how many, and why. Adding one is a decision, not a fix.
 */
export const ALLOWED = new Map([
  ["page.tsx", { count: 1, why: "a skeleton bar's line length in Today's streamed fallback" }],
  ["orders/page.tsx", { count: 1, why: "a paragraph's measure under the orders ledger" }],
  ["settings/export/page.tsx", { count: 4, why: "four paragraphs' measure" }],
  ["dive-sites/[id]/page.tsx", { count: 1, why: "the delete confirmation's paragraph measure" }],
  [
    "schedule/blowout/[tripId]/page.tsx",
    { count: 1, why: "the confirm card's own width, one card on a full page" },
  ],
  ["schedule/blowout/[tripId]/loading.tsx", { count: 1, why: "the confirm card's skeleton" }],
  [
    "schedule/blowout/day/[date]/page.tsx",
    { count: 1, why: "the day call's confirm card, one card on a full page" },
  ],
  ["schedule/blowout/day/[date]/loading.tsx", { count: 1, why: "the confirm card's skeleton" }],
  [
    "trips/[id]/manifest/loading.tsx",
    { count: 1, why: "the stage strip's five taps, as the manifest draws them" },
  ],
  [
    "gear/work-orders/[workOrderId]/tag/page.tsx",
    { count: 1, why: "the printed tag's card: a sheet of paper on screen, not a page shell" },
  ],
]);

/**
 * Every component `<main>` the guard lets spell its own width: path under
 * `SHOP` → how many, and why. Empty: a view that is a page takes `StaffPage`.
 */
export const ALLOWED_COMPONENT_MAINS = new Map();

const MAIN_WIDTH = /<main\b[^>]*\bmax-w-[0-9]xl/g;

/** `source` with its comments out, keeping a `//` straight after a colon (a URL). */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The widths a file's `<StaffPage>` calls declare, `reading` when left out. */
export function staffPageWidths(source) {
  return [...stripComments(source).matchAll(/<StaffPage\b([^>]*)>/g)].map(([, attrs]) => {
    const width = /\bwidth="(\w+)"/.exec(attrs);
    return width ? width[1] : "reading";
  });
}

/** What is wrong with one file, `where` being its path under `SHOP`. */
export function fileProblems(where, source) {
  const found = stripComments(source).match(WIDTH_CLASS) ?? [];
  const allowed = ALLOWED.get(where)?.count ?? 0;
  if (found.length > allowed) {
    return [
      `${where}: ${found.length} \`max-w-<n>xl\` (${[...new Set(found)].join(", ")}), ${allowed} allowed — a staff page is <StaffPage width="reading" | "full">`,
    ];
  }
  if (found.length < allowed) {
    return [`${where}: the allowlist expects ${allowed} and finds ${found.length}; shrink it`];
  }
  return [];
}

/** What is wrong with one `_components` file: a `<main>` that sets its own width. */
export function componentProblems(where, source) {
  const found = stripComments(source).match(MAIN_WIDTH) ?? [];
  const allowed = ALLOWED_COMPONENT_MAINS.get(where)?.count ?? 0;
  if (found.length > allowed) {
    return [
      `${where}: ${found.length} \`<main>\` with its own \`max-w-<n>xl\`, ${allowed} allowed — a view that is a page draws <StaffPage width="reading" | "full">`,
    ];
  }
  if (found.length < allowed) {
    return [`${where}: the allowlist expects ${allowed} and finds ${found.length}; shrink it`];
  }
  return [];
}

/** A page and its skeleton drawing the shell at different widths. */
export function pairProblems(where, pageSource, loadingSource) {
  const page = new Set(staffPageWidths(pageSource));
  const loading = new Set(staffPageWidths(loadingSource));
  if (page.size === 0 || loading.size === 0) return [];
  const same = page.size === loading.size && [...page].every((width) => loading.has(width));
  return same
    ? []
    : [`${where}: page.tsx is ${[...page].join("/")}, loading.tsx is ${[...loading].join("/")}`];
}

async function routeFiles(dir, found = [], components = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await routeFiles(full, found, components);
    else if (entry.name === "page.tsx" || entry.name === "loading.tsx") found.push(full);
    else if (
      full.split(path.sep).includes("_components") &&
      entry.name.endsWith(".tsx") &&
      !entry.name.includes(".test.")
    ) {
      components.push(full);
    }
  }
  return { found, components };
}

/** Every problem under `root`, and how many files and shells were read. */
export async function staffWidthProblems(root = process.cwd()) {
  const shop = path.join(root, SHOP);
  const rel = (file) => path.relative(shop, file).replaceAll(path.sep, "/");
  const walked = await routeFiles(shop);
  const files = walked.found.sort();
  const sources = new Map();
  for (const file of files) sources.set(rel(file), await readFile(file, "utf8"));
  const problems = [];
  if (sources.size < 80) problems.push(`found only ${sources.size} files; the walk is broken`);
  for (const [where, source] of sources) problems.push(...fileProblems(where, source));
  for (const where of ALLOWED.keys()) {
    if (!sources.has(where)) problems.push(`${where}: on the allowlist but not found`);
  }
  const components = walked.components.sort();
  if (components.length < 100) {
    problems.push(`found only ${components.length} component files; the walk is broken`);
  }
  const componentWheres = new Set();
  for (const file of components) {
    componentWheres.add(rel(file));
    problems.push(...componentProblems(rel(file), await readFile(file, "utf8")));
  }
  for (const where of ALLOWED_COMPONENT_MAINS.keys()) {
    if (!componentWheres.has(where)) problems.push(`${where}: on the allowlist but not found`);
  }
  let shells = 0;
  for (const [where, source] of sources) {
    shells += staffPageWidths(source).length;
    if (!where.endsWith("page.tsx")) continue;
    const loading = sources.get(where.replace(/page\.tsx$/, "loading.tsx"));
    if (loading !== undefined) problems.push(...pairProblems(where, source, loading));
  }
  return { problems, files: sources.size, components: components.length, shells };
}

async function main() {
  const { problems, files, components, shells } = await staffWidthProblems();
  if (problems.length > 0) {
    console.error(
      `Staff page widths outside the two:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `staff-widths: ${files} staff pages and skeletons, ${components} component files, ${shells} StaffPage shells at two widths, ${ALLOWED.size} in-page measures allowed`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
