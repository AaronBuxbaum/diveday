import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Nothing that unwinds the render may sit inside a `try` block.
 *
 * In Next, `redirect()`, `permanentRedirect()`, `notFound()`, `forbidden()` and
 * `unauthorized()` do not return — they **throw** a sentinel the framework
 * catches at the boundary and turns into a 307/404/403/401. A `try` wrapped
 * around one therefore catches the refusal itself: the `catch` runs as though
 * the call had *failed*, the function carries on past the gate it just tripped,
 * and the staffer lands nowhere. `.catch(…)` chained onto the call swallows it
 * the same way, without a `try` anywhere in sight, so that shape is refused too.
 *
 * That is a tenant-isolation bug rather than a style regression. `requireShopSurface`
 * (src/lib/session.ts) refuses a cross-shop slug with `notFound()` and refuses a
 * failed permission gate with `redirect()`, and its whole contract is that
 * **every refusal throws** — a caller that wraps it in a `try/catch` converts
 * that contract back into the `{ allowed: false }` the helper exists to avoid,
 * except silently: the page below the gate renders for someone the gate said no
 * to. `src/lib/session.test.ts` pins that the helper throws; this pins that its
 * callers let the throw through. Filed as FU-20260815-refusal-landings-that-say-nothing.
 *
 * Three shapes are deliberately **not** refused, because each is correct:
 *
 * - `catch { redirect(…) }` — a refusal *decided by* the failure. Only the
 *   `try` block's own body is scanned.
 * - A test that asserts a helper throws. `*.test.ts(x)` is skipped: catching the
 *   sentinel is the only way to make that assertion, and `session.test.ts` does
 *   exactly this.
 * - A `try` in a file that never navigates at all — there is nothing to match.
 *
 * And one that is **not covered**, stated rather than implied: a
 * `finally { return … }`, which discards an in-flight throw including the
 * sentinel. It needs a `return` in a `finally` to bite, which lint already
 * refuses, and pretending to cover it would be the false claim this repo keeps
 * getting burned by.
 *
 * A line that genuinely needs a refused shape says
 * `diveday:allow-redirect-in-try: <why>` — with the reason, which the marker
 * pattern requires: anyone reaching for the hatch is claiming the sentinel is
 * re-thrown, and that is a claim a reader has to be able to check.
 *
 * **This rule fails loudly rather than open.** A lexical scan that gets derailed
 * — one unterminated string, one construct the masker misreads — sees *zero*
 * `try` blocks and reports a clean tree, which is the worst possible outcome for
 * a security control. So every `try` token must produce a matched span, and the
 * run prints how many bodies it scanned: a derailment is an error naming the
 * file, and a silent collapse to nothing shows up as the count falling.
 */

const ROOT = process.cwd();
const guardedRoots = ["src"];
const sourceExtensions = new Set([".ts", ".tsx"]);
/** The hatch, and the reason it is worthless without: `<marker>: <why>`. */
const ALLOW_MARKER = /diveday:allow-redirect-in-try:\s*\S/;

/**
 * Every call that unwinds rather than returns.
 *
 * The first five are Next's own (`next/navigation`). The last three are this
 * repo's cross-file wrappers whose docblocks promise the same thing — listed by
 * name because the throw happens one frame down, where no scan of the call site
 * can see it, and a `try` around them is the exact bug this rule was filed for.
 *
 * A *local* wrapper is found rather than listed; see `neverReturningNames`. An
 * enumerated list was the first version and it was already three helpers short
 * on the day it was written, `settings/export/actions.ts`'s `done()` among them
 * — the refusal path of the full-shop data export (security review finding).
 */
const THROWING_CALLS = [
  "redirect",
  "permanentRedirect",
  "notFound",
  "forbidden",
  "unauthorized",
  "revalidateAndRedirect",
  "requireStaffSession",
  "requireShopSurface",
];

/**
 * The functions declared in *this* file that never return normally.
 *
 * TypeScript already carries the signal: a helper whose whole job is to redirect
 * is annotated `: never` or `: Promise<never>` (`refuse` in
 * `app/actions/seat-diver.ts`, `done` in the two settings action files,
 * `landAfterAdd` in the schedule board's). Reading the annotation closes the
 * class generically instead of chasing each new helper into the list above.
 */
function neverReturningNames(masked) {
  const names = new Set();
  for (const match of masked.matchAll(
    /\b(?:function\s+|const\s+|let\s+)([A-Za-z_$][\w$]*)\b[^\n]*?\)\s*:\s*(?:Promise\s*<\s*never\s*>|never)\s*(?:\{|=>)/g,
  )) {
    names.add(match[1]);
  }
  return names;
}

const callPattern = (names) => new RegExp(`(?<![.\\w$])(${[...names].join("|")})\\s*\\(`, "g");

/**
 * Whether a `/` at this offset opens a regex literal rather than dividing.
 *
 * Deliberately narrow. The tempting wide answer — "any punctuation may precede
 * a regex" — includes `<`, and `</Foo>` is the single commonest three
 * characters in this tree: reading a JSX closing tag as a regex swallows the
 * rest of the line, braces and all, and silently loses whole `try` blocks
 * (18 files masked to unbalanced braces before this was narrowed). So the
 * openers are the ones a regex is actually written after here — after `(`, `,`,
 * `=`, `:`, `[`, `!`, `&`, `|`, `?`, `;`, `{`, after a fat arrow, and after the
 * handful of keywords a value can follow.
 */
function startsValue(contents, index, previous, previous2) {
  if (previous === "") return true;
  if ("(,=:[!&|?;{".includes(previous)) return true;
  // `=>` — `.filter((x) => /re/.test(x))`, the commonest regex position of all.
  if (previous === ">" && previous2 === "=") return true;
  return /(?:^|[^\w$])(return|typeof|case|yield|await|in|of|delete|void|instanceof)\s*$/.test(
    contents.slice(Math.max(0, index - 24), index),
  );
}

/**
 * The source with every comment and string body blanked to spaces, same length
 * and same line breaks.
 *
 * Both halves of this rule are lexical — matching braces, and finding a call —
 * and both go wrong on text that only *looks* like code: the word `redirect(` in
 * a docblock (this file's own prose is full of them), or a `{` inside a string.
 * Masking rather than stripping keeps every offset, so a violation still reports
 * the line it is really on.
 */
export function maskSource(contents) {
  // `.split("")`, not `Array.from`: the latter iterates *code points*, so one
  // emoji in a source file (this tree has a demo-role icon per line) shifts
  // every index after it by one against `contents[i]`, and the mask lands on the
  // wrong characters from there on. Every offset here is a UTF-16 code unit.
  const out = contents.split("");
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== "\n") out[i] = " ";
  };
  let index = 0;
  // The last two meaningful characters, which is how a `/` is told apart from a
  // division sign and from JSX: a regex may only begin where a *value* may
  // begin. Two rather than one because the commonest position of all is after a
  // fat arrow, whose last character is `>`.
  let previous = "";
  let previous2 = "";
  const remember = (character) => {
    previous2 = previous;
    previous = character;
  };
  /**
   * Code, or the text of a template literal, all the way down — a template's
   * `${…}` is code again, and that code may open another template.
   *
   * The brace counter per code frame is what tells the `}` that *closes* an
   * interpolation from an ordinary one: only the former pops back to template
   * text. Both are kept in the mask, so the pair balances and the brace matching
   * `tryBodySpans` does is unaffected by however many templates a try body holds.
   */
  const stack = [{ template: false, depth: 0 }];
  while (index < contents.length) {
    const character = contents[index];
    const next = contents[index + 1];
    const frame = stack[stack.length - 1];
    if (frame.template) {
      if (character === "\\") {
        blank(index, index + 2);
        index += 2;
        continue;
      }
      if (character === "`") {
        blank(index, index + 1);
        stack.pop();
        remember("`");
        index += 1;
        continue;
      }
      if (character === "$" && next === "{") {
        // `$` goes, `{` stays — its partner below keeps the pair balanced.
        blank(index, index + 1);
        stack.push({ template: false, depth: 0 });
        index += 2;
        continue;
      }
      blank(index, index + 1);
      index += 1;
      continue;
    }
    if (character === "{") {
      frame.depth += 1;
      remember("{");
      index += 1;
      continue;
    }
    if (character === "}") {
      if (frame.depth === 0 && stack.length > 1) stack.pop();
      else frame.depth -= 1;
      remember("}");
      index += 1;
      continue;
    }
    if (character === "`") {
      blank(index, index + 1);
      stack.push({ template: true, depth: 0 });
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      const end = contents.indexOf("\n", index);
      blank(index, end === -1 ? contents.length : end);
      index = end === -1 ? contents.length : end;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = contents.indexOf("*/", index + 2);
      blank(index, end === -1 ? contents.length : end + 2);
      index = end === -1 ? contents.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      let cursor = index + 1;
      // Bounded at the newline: a JS string literal cannot hold a raw one, so a
      // scan that reaches the end of the line is looking at something that was
      // never a string — an apostrophe in JSX text, most likely. Unbounded, that
      // one apostrophe blanked everything up to the next quote *anywhere later
      // in the file*, braces included, and every `try` after it vanished from
      // the rule while the run still reported clean (security review finding).
      while (cursor < contents.length && contents[cursor] !== "\n") {
        if (contents[cursor] === "\\") cursor += 2;
        else if (contents[cursor] === character) break;
        else cursor += 1;
      }
      if (contents[cursor] !== character) {
        // Not a string after all. Consume the one character and carry on, rather
        // than blanking a line of real code.
        remember(character);
        index += 1;
        continue;
      }
      blank(index, cursor + 1);
      remember(character);
      index = cursor + 1;
      continue;
    }
    if (character === "/" && startsValue(contents, index, previous, previous2)) {
      // A regex literal. Its body can hold quotes and braces, which would
      // otherwise derail everything after it.
      let cursor = index + 1;
      let inClass = false;
      while (cursor < contents.length && contents[cursor] !== "\n") {
        if (contents[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        // A `/` inside a character class does not end the literal — `/[/]/`.
        if (contents[cursor] === "[") inClass = true;
        else if (contents[cursor] === "]") inClass = false;
        else if (contents[cursor] === "/" && !inClass) break;
        cursor += 1;
      }
      if (contents[cursor] === "/") {
        blank(index, cursor + 1);
        remember("/");
        index = cursor + 1;
        continue;
      }
    }
    if (!/\s/.test(character)) remember(character);
    index += 1;
  }
  return out.join("");
}

/**
 * The `[start, end)` character span of every `try` block's own body — the braces
 * after the keyword, and nothing else. `catch` and `finally` bodies sit outside
 * these spans by construction, which is what lets `catch { redirect(…) }` pass.
 */
function tryBodySpans(masked) {
  const spans = [];
  let seen = 0;
  for (const match of masked.matchAll(/\btry\s*\{/g)) {
    seen += 1;
    const open = match.index + match[0].length - 1;
    let depth = 0;
    for (let index = open; index < masked.length; index += 1) {
      if (masked[index] === "{") depth += 1;
      else if (masked[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          spans.push([open + 1, index]);
          break;
        }
      }
    }
  }
  // Every `try` token must have produced a matched body. One that did not means
  // the mask lost track of the braces, and the only honest answer then is "this
  // file was not scanned" — never the clean report a missing span would
  // otherwise produce.
  return { spans, derailed: spans.length !== seen };
}

/**
 * The index just past a call's closing paren, so the caller can ask what is
 * chained onto it. Walks bracket depth from the opening paren; the mask has
 * already removed every string and comment that could hold a stray one.
 */
function afterCall(masked, openParen) {
  let depth = 0;
  for (let index = openParen; index < masked.length; index += 1) {
    if ("([{".includes(masked[index])) depth += 1;
    else if (")]}".includes(masked[index])) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return masked.length;
}

/**
 * Every unwinding call this file swallows — inside a `try` body, or with a
 * `.catch(…)` chained straight onto it. Exported so
 * `check-redirect-in-try.test.mjs` can exercise the shapes it must catch — and
 * the several it must not — without a fixture tree on disk.
 *
 * Throws when the mask was derailed, rather than answering "nothing here".
 */
export function findRedirectsInTry(contents) {
  const masked = maskSource(contents);
  const { spans, derailed } = tryBodySpans(masked);
  if (derailed) throw new Error("unbalanced braces: this file was not scanned");
  const names = new Set([...THROWING_CALLS, ...neverReturningNames(masked)]);
  const lines = contents.split("\n");
  const found = [];
  for (const match of masked.matchAll(callPattern(names))) {
    const inTry = spans.some(([start, end]) => match.index >= start && match.index < end);
    // `await requireShopSurface(slug).catch(() => null)` swallows the refusal
    // exactly as a `try` around it would, with no `try` anywhere to find.
    const chained = /^\s*\.\s*catch\b/.test(
      masked.slice(afterCall(masked, match.index + match[0].length - 1)),
    );
    if (!inTry && !chained) continue;
    const line = contents.slice(0, match.index).split("\n").length;
    if (ALLOW_MARKER.test(lines[line - 1] ?? "")) continue;
    found.push({ call: match[1], line, shape: chained && !inTry ? "catch" : "try" });
  }
  return found;
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

/** A test may — must — catch the sentinel to assert that a helper throws it. */
const isTest = (file) => /\.test\.tsx?$/.test(file);

// Imported by the test, which must not run the scan or exit the process.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = [];
  const derailed = [];
  let scanned = 0;
  for (const root of guardedRoots) {
    for (const file of await walk(root)) {
      if (isTest(file)) continue;
      const contents = await readFile(path.join(ROOT, file), "utf8");
      try {
        for (const { call, line, shape } of findRedirectsInTry(contents)) {
          violations.push(
            `${file}:${line}: ${call}() ${shape === "catch" ? "with .catch() chained onto it" : "inside a try block"}`,
          );
        }
        scanned += 1;
      } catch {
        derailed.push(file);
      }
    }
  }

  // Never a clean report from a scan that lost its footing: a masker that
  // mis-reads one construct sees no `try` blocks at all, and silence from that
  // is indistinguishable from silence from a clean tree.
  if (derailed.length > 0) {
    console.error(
      `The brace scan could not read these files, so they were NOT checked:\n${derailed.map((file) => `- ${file}`).join("\n")}`,
    );
    console.error(
      "This is a bug in scripts/check-redirect-in-try.mjs's `maskSource`, not in the file — some construct in it (an unusual literal, a regex the heuristic mis-classifies) leaves the brace count unbalanced. Fix the masker; do not silence the file, because a file this rule cannot read is a file where a swallowed refusal would go unseen.",
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error(
      `Calls that unwind the render, with something above them to swallow it:\n${violations.map((v) => `- ${v}`).join("\n")}`,
    );
    console.error(
      "These do not return — they throw a sentinel Next catches at the request boundary. A `try` around one catches the refusal instead: the `catch` runs as though the call failed, execution continues past the gate, and the user lands nowhere. For a permission gate (`requireShopSurface`) that means the page renders for someone it just refused.",
    );
    console.error(
      "Move the call after the `try`/`catch`, or put it in the `catch` if the failure is what decides the refusal. If the sentinel really is re-thrown, say so on the line: `diveday:allow-redirect-in-try: <why>` — with the reason, which the marker requires.",
    );
    process.exit(1);
  }

  // The count is the point: this rule is only as good as the files it could
  // read, so a run that silently stopped reading them shows up as it falling.
  console.log(`redirect-in-try: no unwinding call is swallowed, across ${scanned} files`);
}
