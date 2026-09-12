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
 * 5. **A page-local helper that forwards its own argument to `noticeUrl`** —
 *    `done(path, notice)` in the WhatsApp settings actions, `done(path, notice,
 *    reason?)` in the export actions, `backTo(base, notice, form?, card?)` on
 *    the diver record. Together those three carry about 60 literals the guard
 *    could not see, because shape 2 reads only a literal passed *directly* to
 *    `noticeUrl` and these pass a variable. A snake_case code sat on the
 *    WhatsApp page for a while and worked, because `noticeCode` lower-cases and
 *    replaces underscores on the way through — one code with two spellings in
 *    the tree, which is the fork this rule exists to prevent, one indirection
 *    to the left (issue #1768). Every large staff page eventually grows a
 *    `done`-shaped helper, so this is not a one-off.
 *
 * **The helper rule is syntactic, and deliberately narrow.** A sink is a
 * function whose parameter is passed as `noticeUrl`'s *second argument* in the
 * same file; the literal is then checked at **that parameter's position only**,
 * which is what keeps `backTo(base, "invalid", "notes")`'s third argument — a
 * form name, not a notice — out of the rule. Dataflow analysis is not on the
 * table: a false refusal teaches people to route around the guard, so anything
 * this cannot read syntactically it declines to judge. A signature it cannot
 * read as a plain list of named parameters (destructuring, a rest argument, a
 * type with a comma in it) makes the helper invisible rather than guessed at,
 * and a helper called from another file is out of reach of a per-file scan.
 *
 * **A conditional in the notice position is read, both branches.**
 * `noticeUrl(path, deleted ? "shift-deleted" : "invalid")` and `done(path,
 * saved ? "captured" : "invalid")` are the ordinary way a refusal rides beside
 * a success, and there are a dozen of them in `src/app/shop/**`. A literal in
 * that argument is a notice code by position, whatever expression surrounds it,
 * so every top-level literal there is checked. Nested one call deeper —
 * `noticeUrl(path, codeFor(x, "raw"))` — is not: at that depth the literal
 * belongs to the inner call's vocabulary, not to this one.
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

/** 1-based line number of an offset, for the report. */
function lineAt(contents, index) {
  return contents.slice(0, index).split("\n").length;
}

/**
 * The arguments of one call, split at its **top-level** commas.
 *
 * A regex cannot do this: an argument is routinely a nested call with its own
 * commas and parens (`noticeUrl(shopPath(slug, "orders"), "…")`), a template
 * literal, or an object. So this walks from the call's opening paren tracking
 * bracket depth and string state, and answers `null` on an unbalanced call —
 * saying nothing rather than guessing, which is the standing trade in this file.
 */
function callArguments(contents, at) {
  const args = [];
  let depth = 1;
  let quote = null;
  let start = at;
  for (let index = at; index < contents.length; index += 1) {
    const character = contents[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      depth -= 1;
      if (depth === 0) {
        args.push({ text: contents.slice(start, index), index: start });
        return args;
      }
    } else if (character === "," && depth === 1) {
      args.push({ text: contents.slice(start, index), index: start });
      start = index + 1;
    }
  }
  return null;
}

/**
 * Every string literal at the top level of one argument's text that is a
 * *value* there rather than something being compared.
 *
 * Top level is half the rule: a literal directly in the notice argument is a
 * notice code whatever surrounds it — including both branches of the `deleted ?
 * "shift-deleted" : "invalid"` shape a dozen staff actions write — while one
 * nested inside a further call belongs to that call's vocabulary instead.
 *
 * A comparison is the other half, and skipping it is not a nicety. The notice
 * argument is routinely a ternary whose *condition* tests a domain reason in
 * its own snake_case spelling — `outcome.reason === "not_checked_in" ?
 * "not-bookable" : outcome.reason`. That literal is not a notice code and never
 * reaches a URL; reading it as one would refuse eight correct call sites in
 * `src/app/shop/**` and teach everyone to route around the guard.
 */
function topLevelLiterals(text) {
  const found = [];
  let depth = 0;
  let quote = null;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) {
        const before = text.slice(0, start);
        const after = text.slice(index + 1);
        const compared = /[=!]==?\s*$/.test(before) || /^\s*[=!]==?/.test(after);
        // A template literal is not a code either: assembled at runtime.
        if (quote !== "`" && depth === 0 && !compared) found.push(text.slice(start + 1, index));
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      start = index;
    } else if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) depth -= 1;
  }
  return found;
}

/**
 * The parameter names of a signature, or `null` when it is not a plain list of
 * them.
 *
 * `null` is the honest answer for a destructured or rest parameter, and for a
 * type carrying its own comma (`Record<string, string>`), which splits into
 * fragments that are no longer parameters. Either way the helper goes unseen
 * rather than being read at a guessed position — a miss costs a check, and a
 * position read wrong costs a false refusal.
 */
function parameterNames(chunks) {
  if (chunks.length === 1 && chunks[0].text.trim() === "") return [];
  const names = [];
  for (const chunk of chunks) {
    const match = /^\s*(\w+)\s*\??\s*(?::|=|$)/.exec(chunk.text);
    if (!match) return null;
    names.push(match[1]);
  }
  return names;
}

/** `function name(`, `const name = (`, and the `async` forms of each. */
const DECLARATION =
  /\b(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;

/**
 * Functions in this file that forward one of their own parameters into
 * `noticeUrl`'s second argument, as `name -> the position of that parameter`.
 *
 * Found by reading each `noticeUrl(` call whose notice argument is a bare
 * identifier and asking whether the nearest declaration above it takes a
 * parameter of that name. That is the whole rule — no dataflow, no scope
 * analysis — and it covers the shape that actually appears: a one-line `done`
 * or `backTo` beside the actions that call it (issue #1768).
 */
export function noticeSinks(contents) {
  const declarations = [...contents.matchAll(DECLARATION)].map((match) => ({
    name: match[1] ?? match[2],
    parameters: parameterNames(callArguments(contents, match.index + match[0].length) ?? []),
    index: match.index,
  }));
  const sinks = new Map();
  for (const match of contents.matchAll(/\bnoticeUrl\s*\(/g)) {
    const args = callArguments(contents, match.index + match[0].length);
    const forwarded = /^\s*(\w+)\s*$/.exec(args?.[1]?.text ?? "");
    if (!forwarded) continue;
    const enclosing = declarations.filter((item) => item.index < match.index).at(-1);
    const position = enclosing?.parameters?.indexOf(forwarded[1]) ?? -1;
    if (enclosing && position !== -1) sinks.set(enclosing.name, position);
  }
  return sinks;
}

/**
 * Every literal notice code passed to `noticeUrl` directly, or to a helper that
 * forwards to it, with the line and the shape it was written in.
 */
function noticeUrlArguments(contents) {
  const found = [];
  const calls = [["noticeUrl", 1]];
  for (const [name, position] of noticeSinks(contents)) calls.push([name, position]);
  for (const [name, position] of calls) {
    for (const match of contents.matchAll(new RegExp(String.raw`\b${name}\s*\(`, "g"))) {
      const args = callArguments(contents, match.index + match[0].length);
      const argument = args?.[position];
      if (!argument) continue;
      for (const code of topLevelLiterals(argument.text)) {
        found.push({ code, line: lineAt(contents, argument.index), call: name });
      }
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
  for (const { code, line, call } of noticeUrlArguments(contents)) {
    found.push({
      code,
      line,
      shape: call === "noticeUrl" ? `noticeUrl(…, "${code}")` : `${call}(…, "${code}") → noticeUrl`,
    });
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
