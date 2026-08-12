import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Every `openGraph` block under `src/app` spreads the site-level fields —
 * `openGraphSite` from `src/lib/site-metadata.ts`, or `sharedLinkCard` from
 * `src/lib/marketing.ts`, which is that constant plus the shared card image.
 *
 * Why this is machine-checked rather than reviewed: Next merges `metadata`
 * shallowly, so a page-level `openGraph` object **replaces** the root layout's
 * outright rather than merging into it (`mergeMetadata` in
 * `next/dist/lib/metadata/resolve-metadata.js` does a straight assignment).
 * A page has to export one the moment it wants its own unfurl words, and the
 * fields it never meant to touch — `siteName`, `type` — leave with them.
 *
 * The failure that produces is silent in three separate ways at once. It is
 * invisible from inside the app, because these tags only render in someone
 * else's chat window. It reads *backwards* from outside, because the pages
 * written with the most care about their unfurl are exactly the ones that lose
 * the site name, while a page with nothing to say inherits it. And it is
 * additive damage: a new page copies a neighbour that already looks fine.
 * Six pages were in that state on 2026-08-12 — `/`, the shop schedule, the
 * trip page, both course pages, and the recap — and the marketing surface had
 * already lost its card image the same way on 2026-08-03, which is why
 * `sharedLinkCard` exists at all.
 *
 * The e2e suites assert the resulting tags on the routes they name
 * (`e2e/seo.spec.ts`, `e2e/marketing.spec.ts`), but those lists are
 * hand-maintained; a page added tomorrow is not on them. This check is what
 * covers the page nobody thought to add.
 *
 * `openGraph` blocks outside `src/app` are not metadata exports and are not
 * scanned. Within it, a block may opt out with the acknowledgement below on
 * the same line or the line above — for the case where a route genuinely must
 * not name the site.
 */

const ROOT = process.cwd();
const guardedRoot = "src/app";
const sourceExtensions = new Set([".ts", ".tsx"]);

/** Either spread carries `siteName` and `type`; `sharedLinkCard` adds the image. */
export const siteSpreads = ["...openGraphSite", "...sharedLinkCard"];

export const ACKNOWLEDGEMENT = "diveday:allow-bare-open-graph";

const EXEMPT = new RegExp(`${ACKNOWLEDGEMENT}:\\s*\\S`);

/**
 * The `{ … }` that follows an `openGraph:` key, brace-balanced so a nested
 * object (`images: [{ … }]`) does not end the block early. Null when the
 * source ends mid-block.
 */
function openGraphBlock(contents, keyIndex) {
  const open = contents.indexOf("{", keyIndex);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < contents.length; i += 1) {
    const character = contents[i];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return contents.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Every `openGraph` block in `source` that names no site-level spread, as
 * `{ line }` records. The `[^\w.]` guard keeps `metadata.openGraph` and
 * `resolvedOpenGraph:` from matching — this is the object literal a page
 * declares, not a read of one.
 */
export function findBareOpenGraphBlocks(source) {
  const lines = source.split("\n");
  const found = [];

  for (const match of source.matchAll(/(^|[^\w.])openGraph\s*:/g)) {
    const block = openGraphBlock(source, match.index);
    if (block === null) continue;

    // From where `openGraph` itself starts, not from `match.index`: the
    // `[^\w.]` guard consumes one character, and for an unindented key that
    // character is the previous line's newline — counting from it reports the
    // line above, and shifts the acknowledgement lookup with it.
    const keyStart = match.index + match[1].length;
    const line = source.slice(0, keyStart).split("\n").length;
    const here = lines[line - 1] ?? "";
    const above = lines[line - 2] ?? "";
    if (EXEMPT.test(here) || EXEMPT.test(above)) continue;

    if (!siteSpreads.some((spread) => block.includes(spread))) found.push({ line });
  }

  return found;
}

/** Every `openGraph` key that opens a block, acknowledged or not. */
export function countOpenGraphBlocks(source) {
  let count = 0;
  for (const match of source.matchAll(/(^|[^\w.])openGraph\s*:/g)) {
    if (openGraphBlock(source, match.index) !== null) count += 1;
  }
  return count;
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
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

async function main() {
  const violations = [];
  let checked = 0;

  for (const file of await walk(guardedRoot)) {
    const contents = await readFile(path.join(ROOT, file), "utf8");
    checked += countOpenGraphBlocks(contents);
    for (const { line } of findBareOpenGraphBlocks(contents)) {
      violations.push(`${file}:${line}`);
    }
  }

  if (violations.length > 0) {
    console.error(
      `openGraph blocks that drop the site-level fields:\n${violations.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      "Spread `openGraphSite` (src/lib/site-metadata.ts) into each one, or `sharedLinkCard` (src/lib/marketing.ts) when the page also wants the shared link-card image.",
    );
    console.error(
      `Next merges metadata shallowly: a page-level openGraph block replaces the root layout's rather than merging into it, so og:site_name and og:type vanish the moment a page states its own unfurl words — and the failure only ever shows up in someone else's chat window. A route that genuinely must not name the site says \`${ACKNOWLEDGEMENT}: <why>\`.`,
    );
    process.exit(1);
  }

  console.log(
    `open-graph: ${checked} openGraph blocks under ${guardedRoot} all name the site (og:site_name, og:type)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
