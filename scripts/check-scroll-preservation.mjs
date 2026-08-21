import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * A same-page tap must never silently send the reader back to the top of the
 * page, or off it entirely. Two invariants, one theme — see "A tap never
 * sends the page back to the top" in docs/design/forms-and-controls.md.
 *
 * 1. `PreserveFormScroll` (src/components/PreserveFormScroll.tsx) is mounted
 *    from `src/app/layout.tsx`, the root layout, and from EXACTLY that one
 *    file.
 *
 *    It used to be mounted separately in `src/app/shop/[shopSlug]/layout.tsx`,
 *    `src/app/s/[shopSlug]/layout.tsx`, and `src/app/ready/[token]/layout.tsx`
 *    — three copies of the same mount, one per shell. That meant any NEW
 *    bearer-token or account-lifecycle route silently got no scroll
 *    preservation at all until someone remembered to add it there too:
 *    reset-password, claim, invite, recap, unsubscribe, and verify all had
 *    exactly this gap, each one a route where a same-page form submit (an
 *    "invalid code" retry, a password mismatch) dumped the reader back to the
 *    top of the page instead of leaving them where they tapped. Mounting it
 *    once in the root layout is what makes it "every route gets it for free,
 *    with nothing to add at a new layout" (PreserveFormScroll.tsx's own
 *    docblock) actually true — a second mount anywhere is that duplication
 *    creeping back in, and a missing root mount is the whole mechanism gone.
 *
 * 2. No file under `src/` renders a JSX `href` of the bare fragment `#` or of
 *    a `javascript:` pseudo-protocol.
 *
 *    Both are "fake link" shapes: an `<a>` wired up to *look* like a button
 *    but not go anywhere, styled inert rather than actually being inert. They
 *    are not inert. `#` under `target="_top"` is a real navigation — a
 *    keyboard Enter (or, on the frameless case, any click) still activates
 *    the anchor and the browser jumps the viewport to the top of the current
 *    page, or across a frame boundary replaces the parent page entirely. The
 *    booking-confirmation "read the readiness page" link (now
 *    `src/app/s/[shopSlug]/trips/[id]/page.tsx`) used to fall back to exactly
 *    this — `href="#"`, `aria-disabled`, `pointer-events-none` — whenever no
 *    capability token had been minted yet, under `target="_top"`. A mouse
 *    click was blocked by the inert styling; a keyboard Enter was not, and it
 *    replaced the shop's own top-level page with a dead fragment at the one
 *    moment a diver had just handed over money. A review caught it before it
 *    shipped (`coderabbitai`), and `EmbedBookedNotice.test.tsx` now pins "never
 *    points the top-level window at a bare fragment" so the shape can't come
 *    back quietly. The fix in both cases is the same: a real `<button
 *    type="button">` for something that only ever runs a handler, or a real
 *    destination `href` for something that only sometimes has one — never a
 *    placeholder anchor standing in for either.
 *
 * A line that must legitimately keep one of these shapes says
 * `diveday:allow-scroll-preservation: <why>` in a trailing comment — with the
 * reason, which the marker pattern requires.
 */

const ROOT = process.cwd();
const guardedRoot = "src";
const sourceExtensions = new Set([".ts", ".tsx"]);

const ROOT_LAYOUT = path.normalize(path.join("src", "app", "layout.tsx"));

/** The hatch, and the reason it is worthless without: `<marker>: <why>`. */
const ALLOW_MARKER = /diveday:allow-scroll-preservation:\s*\S/;

/**
 * This file, and its test, necessarily contain every shape rule 2 refuses —
 * as prose in the docblock above, and as fixtures in the test. Neither lives
 * under `src/`, so neither is ever walked by the CLI scan below; this set
 * exists only so a future widening of `guardedRoot` (mirroring
 * check-notice-codes.mjs's `scripts` root) fails safe rather than flagging
 * the rule's own description of itself.
 */
const allowed = new Set([
  path.normalize("scripts/check-scroll-preservation.mjs"),
  path.normalize("scripts/check-scroll-preservation.test.mjs"),
]);

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

/**
 * Whether a file's contents render `PreserveFormScroll` as JSX — `<PreserveFormScroll`
 * followed by whitespace, `/`, or `>`, so it does not also match the sibling
 * `<PreserveFormScrollEffects />` inside the component's own module, or a bare
 * `import { PreserveFormScroll } from "..."` (no `<` in front of an import).
 */
export function mountsPreserveFormScroll(contents) {
  return /<PreserveFormScroll(?=[\s/>])/.test(contents);
}

/**
 * Given every `layout.tsx` under `src/app` as `{ file, contents }`, the
 * violations of invariant 1: the root layout not mounting `PreserveFormScroll`,
 * or any other layout mounting it. Exported so
 * `check-scroll-preservation.test.mjs` can exercise both shapes — and a clean
 * tree — without a fixture tree on disk.
 */
export function findScrollMountViolations(layoutFiles) {
  const violations = [];
  const root = layoutFiles.find(({ file }) => path.normalize(file) === ROOT_LAYOUT);
  if (!root || !mountsPreserveFormScroll(root.contents)) {
    violations.push(
      `${ROOT_LAYOUT}: does not render <PreserveFormScroll /> — every route depends on this one mount for same-page scroll preservation`,
    );
  }
  for (const { file, contents } of layoutFiles) {
    if (path.normalize(file) === ROOT_LAYOUT) continue;
    if (mountsPreserveFormScroll(contents)) {
      violations.push(
        `${file}: renders <PreserveFormScroll /> — this belongs only in the root layout (${ROOT_LAYOUT}); a second mount is the per-route duplication this component replaced`,
      );
    }
  }
  return violations;
}

/** A bare `#` fragment, quoted any of the four ways a JSX attribute allows. */
const HASH_HREF_PATTERN = /href\s*=\s*(?:"#"|'#'|`#`|\{\s*(?:"#"|'#'|`#`)\s*\})/;

/** A `javascript:` pseudo-protocol, quoted the same four ways. */
const JS_PROTOCOL_HREF_PATTERN =
  /href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|`javascript:[^`]*`|\{\s*(?:"javascript:[^"]*"|'javascript:[^']*'|`javascript:[^`]*`)\s*\})/i;

/**
 * Every fake-link `href` one file's source contains, with the line and the
 * exact shape matched. Skips whole-line comments (prose describing the
 * pattern, including this repo's own regression tests for it, quotes the
 * pattern verbatim) and any line carrying the allow-marker. Exported so
 * `check-scroll-preservation.test.mjs` can exercise it without a fixture tree
 * on disk.
 */
export function findFakeLinkHrefs(contents) {
  const found = [];
  contents.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (ALLOW_MARKER.test(line)) return;

    const hashMatch = HASH_HREF_PATTERN.exec(line);
    if (hashMatch) {
      found.push({ line: index + 1, shape: hashMatch[0], rule: "hash-fragment" });
      return;
    }
    const jsMatch = JS_PROTOCOL_HREF_PATTERN.exec(line);
    if (jsMatch) {
      found.push({ line: index + 1, shape: jsMatch[0], rule: "javascript-protocol" });
    }
  });
  return found;
}

// Imported by the test, which must not run the scan or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await walk(guardedRoot);

  const layoutFiles = [];
  const hrefViolations = [];
  for (const file of files) {
    if (allowed.has(path.normalize(file))) continue;
    const contents = await readFile(path.join(ROOT, file), "utf8");
    if (path.basename(file) === "layout.tsx") layoutFiles.push({ file, contents });
    for (const { line, shape, rule } of findFakeLinkHrefs(contents)) {
      hrefViolations.push(`${file}:${line}: ${shape} (${rule})`);
    }
  }

  const mountViolations = findScrollMountViolations(layoutFiles);

  if (mountViolations.length > 0) {
    console.error(
      `PreserveFormScroll mount problems:\n${mountViolations.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      'PreserveFormScroll belongs in exactly one place: src/app/layout.tsx. Mounting it a second time in another layout is the per-route duplication this component replaced (it used to be mounted separately in the staff shop shell, the public shop shell, and the trip-prep "ready" route, and every new bearer-token/account-lifecycle route silently had no scroll preservation until someone remembered to add it there too). Remove the extra mount, or restore the root layout\'s.',
    );
  }

  if (hrefViolations.length > 0) {
    console.error(
      `Fake-link hrefs (jump the viewport to the top, or navigate away, on tap):\n${hrefViolations.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      'Neither `href="#"` nor a `javascript:` href is inert: a keyboard Enter still activates the anchor, and `#` under `target="_top"` (or in the ordinary case) jumps the viewport to the top of the page. Use a real `<button type="button">` for something that only runs a handler, or a real destination href for something that only sometimes has one. A line that genuinely must keep this shape says `diveday:allow-scroll-preservation: <why>`.',
    );
  }

  if (mountViolations.length > 0 || hrefViolations.length > 0) {
    process.exit(1);
  }

  console.log(
    `scroll-preservation: PreserveFormScroll is mounted only in the root layout, and no fake-link href was found, across ${files.length} files`,
  );
}
