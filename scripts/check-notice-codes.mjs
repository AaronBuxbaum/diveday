import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Every staff `?notice=` code is spelled one way: lower-case kebab,
 * `/^[a-z0-9-]+$/`.
 *
 * The `?notice=` pattern is a page redirecting back to itself (or to a parent)
 * with a code the destination looks up in its own `Record<code, …>` map. Both
 * halves are written by hand, in different files, often by different sessions —
 * so the only thing holding them together is the code spelling exactly the
 * same way on both sides. It did not. By 2026-08-15 three meanings existed in
 * *both* casings at once (`not_authorized`/`not-authorized`,
 * `payment_not_connected`/`payment-not-connected`,
 * `demo_disabled`/`demo-disabled`), and `orders/new/page.tsx` emitted two
 * casings of one concept on adjacent lines of a single ternary because the two
 * destination pages' maps had been written by different hands.
 *
 * The failure mode is the reason this is a check rather than a convention: a
 * code with no matching map key renders **no banner at all**. The staffer is
 * bounced to a page that says nothing about why, which is indistinguishable
 * from a dead link — and nothing goes red, so it survives review, CI, and
 * production until a human reports "it just doesn't do anything".
 *
 * Two shapes are checked, because after the migration to
 * `noticeUrl`/`noticeCode` (src/lib/staff-notices.ts) most codes no longer sit
 * next to the literal text `notice=`:
 *
 * 1. **`notice=<literal>`** anywhere in the guarded roots — the raw query
 *    string, in source, in a comment, or in an e2e URL assertion. An
 *    interpolated `notice=${…}` is skipped: its value is a runtime one, and
 *    `noticeCode` normalises those at the one door instead.
 * 2. **The second argument of `noticeUrl(…)`** when it is a string literal.
 *    Without this the rule would go blind the moment the migration finished.
 * 3. **`searchParams.set("notice", …)`** — the `URL`-object spelling the two
 *    Stripe Connect callback routes use. It builds the same query as the other
 *    two and forked the same way, but shares no syntax with either.
 * 4. **`notice === "<literal>"`** — the *reader* side. The first three shapes
 *    are all emitters, and an emitter renamed without its reader is precisely
 *    the silent banner this rule exists to stop. Not hypothetical: the
 *    2026-08-15 migration renamed `walkin_trip_prerequisite` in the walk-in
 *    page's `NOTICE_KEYS` and left the `notice === "walkin_trip_prerequisite"`
 *    two lines below it, which quietly turned the counter's "which card is
 *    missing" sentence back into the generic one. A security review caught it;
 *    nothing else could have.
 */

const ROOT = process.cwd();
const guardedRoots = ["src", "e2e", "scripts"];
const sourceExtensions = new Set([".ts", ".tsx", ".mjs"]);
const NOTICE_CODE_PATTERN = /^[a-z0-9-]+$/;

/**
 * This file necessarily contains every shape it refuses, as prose and as test
 * fixtures. It is the rule, not a call site.
 */
const allowed = new Set([
  path.normalize("scripts/check-notice-codes.mjs"),
  path.normalize("scripts/check-notice-codes.test.mjs"),
  // `noticeUrl`'s own test, which must feed it the spellings this rule refuses:
  // its whole job is proving that a `snake_case` domain reason comes out kebab
  // and that a code trying to smuggle a second `notice=` comes out inert. Given
  // only canonical codes it would assert nothing.
  path.normalize("src/lib/staff-notices.test.ts"),
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
 * A `notice=` whose value is written out rather than interpolated.
 *
 * The value must open with a word character, which is what separates a code
 * from the several non-codes that share the spelling: `notice={pageNotice}` (a
 * JSX prop), `notice=${outcome.reason}` (interpolated — normalised by
 * `noticeCode` at the one door instead), `?notice=<code>` and `?notice=%s`
 * (prose and a test title), and a bare `?notice=`, which is how the docs refer
 * to the pattern itself. None of those has a literal in it to hold to anything.
 */
const literalNoticeParam = /notice=(\w[\w-]*)/g;

/** `searchParams.set("notice", "<code>")` — the same query, built through `URL`. */
const searchParamsSet = /\.set\(\s*(["'])notice\1\s*,\s*(["'])([^"']*)\2/g;

/**
 * `notice === "<code>"` and its negation — a page asking which code it got.
 *
 * Deliberately anchored on an identifier *ending* in `notice` (`notice`,
 * `noticeKey`, `builderNotice`, `query.notice`, `reviewParam` is out of scope
 * by design) rather than any comparison anywhere: a bare `=== "some_code"`
 * would sweep in every unrelated enum in the tree.
 */
const noticeComparison = /\b\w*[Nn]otice\s*[!=]==\s*(["'])([^"']*)\1/g;

/**
 * Finds the second argument of every `noticeUrl(` call, when that argument is
 * a plain string literal.
 *
 * A regex cannot do this: the first argument is routinely a nested call with
 * its own commas and parens (`noticeUrl(shopPath(slug, "orders"), "…")`). So
 * this walks the source from the call's opening paren, tracking bracket depth
 * and string/template state, and stops at the first comma seen at depth 1.
 */
function noticeUrlArguments(contents) {
  const found = [];
  for (const match of contents.matchAll(/\bnoticeUrl\s*\(/g)) {
    let index = match.index + match[0].length;
    let depth = 1;
    let quote = null;
    while (index < contents.length) {
      const character = contents[index];
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if ("([{".includes(character)) {
        depth += 1;
      } else if (")]}".includes(character)) {
        depth -= 1;
        // The call closed with only one argument — nothing to check here (and
        // `tsc` will have refused it anyway).
        if (depth === 0) break;
      } else if (character === "," && depth === 1) {
        const literal = /^\s*(["'])([^"'\\]*)\1\s*[,)]/.exec(contents.slice(index + 1));
        if (literal) {
          found.push({ code: literal[2], line: contents.slice(0, index).split("\n").length });
        }
        break;
      }
      index += 1;
    }
  }
  return found;
}

/**
 * Every notice code one file spells out, with the line and the shape it was
 * written in. Exported so `check-notice-codes.test.mjs` can exercise the three
 * shapes — and the several near-misses that must NOT be flagged — without a
 * fixture tree on disk.
 */
export function findNoticeCodes(contents) {
  const found = [];
  contents.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(literalNoticeParam)) {
      found.push({ code: match[1], line: index + 1, shape: `?notice=${match[1]}` });
    }
    for (const match of line.matchAll(searchParamsSet)) {
      found.push({
        code: match[3],
        line: index + 1,
        shape: `searchParams.set("notice", "${match[3]}")`,
      });
    }
    for (const match of line.matchAll(noticeComparison)) {
      found.push({ code: match[2], line: index + 1, shape: `notice === "${match[2]}"` });
    }
  });
  for (const { code, line } of noticeUrlArguments(contents)) {
    found.push({ code, line, shape: `noticeUrl(…, "${code}")` });
  }
  return found;
}

/** The codes in one file that are not in the one canonical spelling. */
export function findNoticeCodeViolations(contents) {
  return findNoticeCodes(contents).filter(({ code }) => !NOTICE_CODE_PATTERN.test(code));
}

// Imported by the test, which must not run the scan or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = [];
  for (const root of guardedRoots) {
    for (const file of await walk(root)) {
      if (allowed.has(path.normalize(file))) continue;
      const contents = await readFile(path.join(ROOT, file), "utf8");
      for (const { line, shape } of findNoticeCodeViolations(contents)) {
        violations.push(`${file}:${line}: ${shape}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `Notice codes that are not lower-case kebab:\n${violations.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      "Rename the code to kebab-case (`not_authorized` -> `not-authorized`) at BOTH ends: the emitter, and every destination page's `Record<code, …>` notice map that resolves it. Grep the code before and after — a map entry left behind renders no banner at all, which looks exactly like a dead link and fails nothing.",
    );
    console.error(
      "Build the URL with `noticeUrl(path, code, extra?)` from src/lib/staff-notices.ts rather than a template string; it encodes the value and normalises the casing of a runtime `result.reason` for you.",
    );
    process.exit(1);
  }

  console.log("notice-codes: every literal ?notice= code is lower-case kebab");
}
