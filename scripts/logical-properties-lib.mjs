import path from "node:path";

/**
 * **The scan behind `scripts/check-logical-properties.mjs`** — which files to
 * look in, and which strings inside one are a physical directional utility
 * (issue #733).
 *
 * Split out of the guard so the scan can be tested at all. The guard runs
 * entirely at module scope, so importing it ran a full sweep over `src/` as a
 * side effect of the import, and the vanished-file path below therefore had no
 * test beside it — the same split, for the same race, as
 * `scripts/image-sizes-lib.mjs` (issue #1763).
 *
 * Everything here is a function over a listing and a reader. Nothing touches
 * the filesystem itself: the guard injects `readdir` and `readFile`, and a test
 * injects whatever tree it needs.
 */

const sourceExtensions = new Set([".ts", ".tsx"]);

/**
 * The physical utilities that have a logical twin, and only those. `top-`,
 * `bottom-`, `mt-`, `mb-` and friends are not directional — a page reads down
 * in every locale DiveDay could ever ship — so they are not here.
 */
const PHYSICAL = [
  ["ml-", "ms-"],
  ["mr-", "me-"],
  ["pl-", "ps-"],
  ["pr-", "pe-"],
  ["left-", "start-"],
  ["right-", "end-"],
  ["text-left", "text-start"],
  ["text-right", "text-end"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
  ["rounded-l", "rounded-s"],
  ["rounded-r", "rounded-e"],
];

/**
 * A utility inside a class string, with its optional variants — `sm:ml-2`,
 * `group-hover:pr-4`, `-ml-1`. Anchored on a boundary so `border-r` does not
 * match `border-red-500`, and `left-` does not match a word ending in "left".
 */
const patternFor = (utility) =>
  new RegExp(
    `(?<![\\w-])-?(?:[a-z-]+:)*${utility}${utility.endsWith("-") ? "[\\w./\\[\\]%-]+" : ""}(?![\\w-])`,
    "g",
  );

/**
 * Comments out, before anything is counted. Prose is full of "right-hand" and
 * "left-aligned", and neither is a class — the same reason `check-tokens.mjs`
 * strips first. Replaced with spaces rather than removed so line numbers in
 * the report still point at the real line.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/**
 * Every `.ts`/`.tsx` file under one root, depth first, through `listDirectory`
 * — a `readdir(…, { withFileTypes: true })` stand-in.
 *
 * A directory that is not there is an empty listing rather than a failure: the
 * roots are a fixed list, and one of them disappearing mid-walk is the same
 * ordinary concurrent edit the read below tolerates. Any other listing error
 * still throws.
 */
async function sourceFilesUnder(relativeDirectory, listDirectory) {
  let entries;
  try {
    entries = await listDirectory(relativeDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFilesUnder(relativePath, listDirectory)));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

/**
 * Every physical directional utility in one file's source, as
 * `{ line, text, logical }` — comments stripped first, so the line numbers
 * still point at the real line.
 */
export function physicalUtilitiesInSource(source) {
  const hits = [];
  stripComments(source)
    .split("\n")
    .forEach((line, index) => {
      for (const [physical, logical] of PHYSICAL) {
        for (const match of line.matchAll(patternFor(physical))) {
          hits.push({ line: index + 1, text: match[0], logical });
        }
      }
    });
  return hits;
}

/**
 * Every physical directional utility under `roots`, as a `file -> hits` map of
 * the files that have any, plus the files the walk listed and the read could
 * not find.
 *
 * The walk and the read are two separate moments, and `pnpm check:repo` runs 48
 * guards concurrently beside whatever a session is editing, so a file that is
 * renamed or deleted between them is an ordinary race rather than a broken
 * checkout — while an unhandled ENOENT here takes the whole guard down with a
 * raw Node stack trace naming `node:internal/fs/promises`, which says nothing
 * a session can act on and leaves the rest of the tree unchecked (issue #1763).
 * So a vanished file is returned to the caller to name, and left out of the
 * counts: "clean or gone" is the wrong thing to say about a file nobody removed.
 *
 * Any other read error still throws. A permission error is a broken checkout,
 * and swallowing it would make the guard lie about its own coverage.
 */
export async function physicalUtilitiesInTree(roots, listDirectory, readText) {
  const details = new Map();
  const vanished = [];
  for (const root of roots) {
    for (const file of await sourceFilesUnder(root, listDirectory)) {
      let source;
      try {
        source = await readText(file);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        vanished.push(file);
        continue;
      }
      const hits = physicalUtilitiesInSource(source);
      if (hits.length > 0) details.set(file, hits);
    }
  }
  return { details, vanished };
}

/**
 * The baseline entries this scan did not account for — the files whose count
 * has fallen to zero, whose entry the ratchet wants removed.
 *
 * A path that vanished is not one of them, which is the one place the vanished
 * list changes an answer rather than merely being reported: its file was never
 * read, so the scan knows nothing about it, and telling a session mid-delete
 * that its entry is "clean or gone" would trade one confusing failure for
 * another (issue #1763).
 */
export function staleBaselineEntries(baselineCounts, { details, vanished }) {
  const gone = new Set(vanished);
  return Object.keys(baselineCounts).filter((file) => !gone.has(file) && !details.has(file));
}
