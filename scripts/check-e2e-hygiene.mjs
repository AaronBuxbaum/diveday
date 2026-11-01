import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { filesUnder } from "./files-under.mjs";
import { bankCounts, ratchetFlags, readCounts } from "./ratchet.mjs";

/**
 * E2E specs may not paper over a race — they must wait for the thing the page
 * itself renders when the awaited work is done.
 *
 * Why this is a guarded invariant, not a style nit: this suite runs with
 * `retries: 0` (playwright.config.ts) precisely so a flake fails loudly and
 * gets root-caused. The failure mode this check exists for is not hypothetical;
 * it is the repo's own history:
 *
 * - `findTripOnBoard` retried its whole crawl 3x, blaming "a sibling test's
 *   parallel worker" shifting pagination — impossible, since every worker owns
 *   an isolated PGlite database. The real race was the navigation landing on
 *   the segment's linkless `loading.tsx` skeleton; the fix was waiting for the
 *   destination page's own link (PR #411).
 * - The offline-fallback assertion was "fixed" three times (#370, then twice
 *   more), each time by moving the same race one layer down, before the fix
 *   that asserted what the page shows rather than how long it took.
 *
 * Most of the banned shapes below encode a guess about timing. The passing form
 * is always the same: an auto-retrying `expect(locator)` assertion on content
 * that exists only after the awaited work completed — never a sleep, never a
 * loop, never "the network went quiet" (which streaming SSR keeps busy).
 *
 * Two rules here are not about timing at all but about **locators that report
 * nothing when they find nothing**, which is the same failure wearing different
 * clothes: a fix that looks right, passes review, and changes nothing.
 * `include-hidden` is one (the option is silently discarded by this suite's own
 * fixture wrapper) and `empty-all` is the other.
 *
 * Escape hatch: a line (or the line above it) carrying
 * `diveday:allow-e2e-hygiene <rule>: <why>` passes. The why must name the
 * mechanism that makes the wait deterministic, not restate that it is needed —
 * mirrors scripts/check-migrations.mjs's acknowledgement marker.
 *
 * Measured here and deliberately not built: a rule refusing a negative
 * assertion (`toHaveCount(0)` / `.not.toBeVisible()`) keyed on a string-literal
 * name, which is how the "Next boat out" rename left two absence assertions
 * passing for the wrong reason (issue #1403). Swept twice — 2026-09-10, and
 * again 2026-09-12 against a suite that had grown to 498 negative assertions —
 * and the counts did not move: the shape that issue specifies flags 98 lines
 * across 46 of the 112 files in `e2e/`, and the narrower
 * `getByRole(…, { name })` form the issue itself nominates flags 56, against
 * its own "if it is fifty, the rule is wrong". The fork is open on #1403 and
 * the counts are in docs/agents/repo-checks.md. Re-measure before re-proposing
 * it; do not re-derive the number.
 */

export const ACKNOWLEDGEMENT = "diveday:allow-e2e-hygiene";

export const rules = [
  {
    id: "sleep",
    pattern: /\.waitForTimeout\s*\(/,
    message:
      "waitForTimeout is a sleep — it encodes a guess about how long the work takes. Wait for the destination's own content with an expect(locator) assertion instead.",
  },
  {
    id: "networkidle",
    pattern: /["'`]networkidle["'`]/,
    message:
      'waiting for "networkidle" is unreliable under streaming SSR (the connection stays busy) and Playwright itself deprecates it. Wait for the specific element the page renders when ready.',
  },
  {
    id: "retries",
    pattern: /\bretries\s*:/,
    message:
      "per-spec retries hide the flake this suite's retries: 0 policy exists to surface. Root-cause the race (see the debug skill) instead of retrying past it.",
  },
  {
    id: "include-hidden",
    pattern: /\bincludeHidden\s*:/,
    message:
      "`includeHidden` on a role query does nothing here: e2e/fixtures.ts wraps getByRole/getByText/getByLabel/getByPlaceholder in `.filter({ visible: true })`, so the option is discarded without a word and the query stays visible-only. That is worse than an error — a fix written with it looks right, passes review, and changes nothing (it cost one CI round on the schedule board's hidden cursor pager). Reach for a hidden element with `page.locator(...)`, which the fixture leaves alone, and give it an attribute to aim at.",
  },
  {
    id: "empty-all",
    pattern: /\.all\s*\(\s*\)/,
    /**
     * Satisfied by a count assertion on the locator in the few lines above —
     * `toHaveCount` is the only shape that *proves* the list is not empty, and
     * `not.toHaveCount(0)` reads as the floor it is. A window rather than an
     * identifier match: the locator is usually built over two or three lines,
     * and a scanner that tried to follow the variable would be guessing.
     */
    precededBy: /toHaveCount\s*\(/,
    window: 6,
    message:
      "an empty `.all()` is silent — it is a no-op loop, not an error, so a loop that finds nothing acts on nothing and reports nothing. Two of these were vacuous passes: `for (const chip of await chipLinks.all()) expect(height).toBeGreaterThanOrEqual(44)` proves exactly as much about zero chips as about ten. It compounds with `getByRole` matching an accessible name by **substring** — a spec waited on a level-3 heading as its arrival gate, the page it was *leaving* carried a row whose name contained it, and the two `.all()` loops after that snapshotted the wrong page, clicked nothing and returned clean. The failure surfaced eleven lines later as a missing element (issue #1111). Prove the list is not empty first — `await expect(locator).not.toHaveCount(0)` — or acknowledge the loop, naming what makes acting on nothing correct.",
  },
  {
    id: "retry-loop",
    pattern:
      /\b(?:for|while)\s*\(\s*(?:let|const|var)?\s*(?:attempts?|retry|retries|retryCount|tries|tryCount)\b/i,
    message:
      "a hand-rolled retry loop is the same hack as retries: — it converts a deterministic failure into an intermittent pass. Find what the loop is racing and wait for it directly.",
  },
  {
    id: "action-race",
    pattern: /\.(?:goto|reload)\s*\(/,
    predicate: submitFollowedByNavigation,
    message:
      "navigating away in the statement straight after submitting a server action races it: the click returns when the request is *sent*, not when the write has landed, so the goto/reload can tear the page down mid-flight and the destination then renders the state from before the save. Wait for what the destination itself shows — `page.waitForURL()` on the action's own `?notice=`/`?created=` redirect, or, for a `useActionState` form that re-renders in place and never redirects, an `expect(locator)` on what the row shows once it has landed. Never a timeout, a retry, or networkidle — and never the field you just filled: an `expect(field).toHaveValue(<what this test typed>)` passes on its first poll whether or not the write landed, so it does not count as the wait here. Both instances that reached CI pointed nowhere near the cause: one closed the destination's stream early and read as a server error, and the other spent the visual shard's whole 210-second budget before failing on an assertion forty lines below, which is exactly how this gets misread as slow CI.",
  },
  {
    id: "pre-hydration-click",
    pattern: /\.click\s*\(/,
    predicate: clickBeforeHydration,
    message:
      'this click follows a navigation that opted out of the fixture\'s hydration wait (`waitUntil: "commit"`), so it can land on the server-rendered page before React owns it, and the press is lost: the flake class of 2026-10-12/13, four specs in 21 runs (code re-review 2026-10-13, item 15). Every other `goto`/`reload`/`waitForURL` on a fixture page returns only once the staff Search trigger says `data-hydrated` (`settleStaffHydration` in e2e/fixtures.ts). Drop the opt-out, or call `settleStaffHydration(page)` before the click, or acknowledge the line when the test is *about* a click beating hydration.',
  },
];

/**
 * The nearest navigation above a click, in the same test, opted out of the
 * fixture's hydration wait with `waitUntil: "commit"`, and nothing between the
 * two waits for React.
 *
 * Every `page.goto` on a fixture page settles staff hydration by itself
 * (`settleStaffHydration` in e2e/fixtures.ts), so the one way left to click a
 * server-rendered staff page before React owns it is to ask the navigation to
 * return at commit, before there is a DOM to wait on. `domcontentloaded` is not
 * that: the document is parsed by then and the fixture waits as usual.
 */
function clickBeforeHydration(lines, index) {
  const body = testBodyFrom(lines, index);
  for (let at = index - 1; at >= body; at -= 1) {
    const line = lines[at];
    if (isProse(line)) continue;
    if (/data-hydrated|settleStaffHydration\s*\(/.test(line)) return false;
    if (!/\.(?:goto|reload)\s*\(/.test(line)) continue;
    let statement = line;
    for (let end = at + 1; end < lines.length && end - at < 8; end += 1) {
      if (statement.trimEnd().endsWith(";")) break;
      statement += `\n${lines[end]}`;
    }
    return /waitUntil\s*:\s*["'`]commit["'`]/.test(statement);
  }
  return false;
}

/**
 * A submit-shaped click as the **immediately preceding code statement** of a
 * `goto`/`reload`.
 *
 * Two clauses, and each one earns its place against the current suite:
 *
 * *Immediately preceding* is what clears the prevailing convention. Nearly every
 * spec here clicks, asserts what the click produced, and then navigates; an
 * `expect`, a `waitFor` or a `waitForURL` between the two makes this not fire,
 * which is precisely the shape the rule is asking for.
 *
 * *Submit-shaped* is what clears the two `"Copy link"` clicks that are followed
 * by `page.goto(await waiverLinkFromToast(page))` — not races at all, since that
 * helper opens by awaiting the toast. Dropping this clause would take the sweep
 * from two hits and no false positives to two and two, and a rule that fires on
 * correct code is one people learn to silence.
 *
 * The list was drawn from the labels the suite actually clicks — `Add`, `Save`,
 * `Book`, `Mark`, `Create`, `Send`, `Sign`, `Record`, `Import` and the rest are
 * all in it because they are all in `e2e/` — and it accepts the three forms a
 * name is written in here: a quoted string, a template literal, and a regular
 * expression with or without a leading `^`. It is a maintenance surface and is
 * **not** meant to be complete. It only matters when a click carrying one of
 * these labels is immediately followed by a navigation, which is rare; a
 * client-only button that happens to say "Send" would be a false positive, and
 * the acknowledgement marker covers it.
 */
const SUBMIT_LABEL =
  /name:\s*(?:["'`]|\/\^?)(?:Save|Add|Create|Put it on the board|Confirm|Book|Send|Sign|Publish|Delete|Remove|Update|Submit|Reinstate|Import|Mark|Record|Check in|Apply|Approve|Issue)/;

/** The trimmed-comment test the scanner already applies, reused so a comment
 *  between the click and the navigation does not hide the race. */
const isProse = (line) => {
  const trimmed = line.trim();
  return (
    !trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")
  );
};

/**
 * The whole statement holding a `.click()`, read upward from it.
 *
 * Bounded by the *previous statement* rather than by a line count: a click is
 * often built over several lines, and how many depends on how the formatter
 * broke the chain that day, so a fixed window is a guess that silently stops
 * catching anything longer (Sourcery finding on #1561). A preceding line that
 * ends in `;` is a different statement and is where this stops; so is a blank
 * line or a comment. The hard cap only exists so a malformed file cannot walk
 * the scanner to the top.
 */
function statementStart(lines, at) {
  let from = at;
  while (from > 0 && at - from < 12) {
    const previous = lines[from - 1];
    if (isProse(previous) || previous.trimEnd().endsWith(";")) break;
    from -= 1;
  }
  return from;
}

function statementAbove(lines, at) {
  return lines.slice(statementStart(lines, at), at + 1).join("\n");
}

/**
 * The subjects whose value the test itself put there: a form control.
 *
 * Anything else an assertion can name — a row, a heading, a toast — is rendered
 * by the destination rather than typed by the test, so asserting on it is a
 * real wait and stays one.
 */
const FORM_CONTROL_SUBJECT =
  /getByLabel\s*\(|getByPlaceholder\s*\(|getByRole\s*\(\s*["'`](?:textbox|combobox|checkbox|radio|spinbutton|switch)["'`]|\[name=/;

/** Where the enclosing test body starts, so "earlier" cannot reach a sibling test. */
function testBodyFrom(lines, at) {
  for (let from = at; from >= 0; from -= 1) {
    if (/\b(?:test|it)\s*(?:\.\w+)*\s*\(/.test(lines[from])) return from;
  }
  return 0;
}

const escapeForRegExp = (source) => source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * An assertion that reads a form control back for what this same test typed
 * into it, which passes on its first poll whether or not the write ever landed.
 *
 * It is syntactically a wait and semantically nothing, and that is the whole
 * defect: `action-race` asks only whether *some* statement stands between the
 * submit and the navigation, so this shape satisfied the rule while leaving the
 * race exactly as it was. One stood in the visual spec (then a single file) from 2026-09-05
 * until it cost a visual shard its whole 210-second budget on PR #1618, with
 * the trace showing the action's POST at status -1 and the destination
 * rendering pre-save state (issue #1644).
 *
 * Deliberately the narrow, decidable case rather than an attempt to prove in
 * general that an assertion depends on the action: the awaited expression has
 * to be the *same source text* the test passed to `fill` earlier in the same
 * body, or, for a checkbox, the same quoted name it called `check` on. A test
 * that means to assert a round-tripped value still can — it just has to say
 * what it waited for first, which is what its siblings in
 * `e2e/depth-and-age-surfaces.spec.ts` and `e2e/courses.spec.ts` already do.
 */
function echoesAnEarlierEdit(lines, at) {
  const from = statementStart(lines, at);
  const statement = lines.slice(from, at + 1).join("\n");
  if (!/\bexpect\s*\(/.test(statement) || !FORM_CONTROL_SUBJECT.test(statement)) return false;
  const earlier = lines.slice(testBodyFrom(lines, from), from).join("\n");

  const awaited = statement.match(/toHaveValue\s*\(([^)]*)\)/);
  if (awaited) {
    const argument = awaited[1].trim();
    if (!argument) return false;
    return new RegExp(`\\.fill\\(\\s*${escapeForRegExp(argument)}\\s*\\)`).test(earlier);
  }

  if (/toBeChecked\s*\(/.test(statement)) {
    // The locator's own name, matched to the statement that ticked it. Bounded
    // to the chain it opens rather than to the rest of the test: a name and a
    // `.check()` far apart are two different locators.
    const name = statement.match(/["'`]([^"'`]+)["'`]/);
    if (!name) return false;
    return new RegExp(
      `["'\`]${escapeForRegExp(name[1])}["'\`][^;]{0,200}?\\.(?:check|uncheck|setChecked)\\s*\\(`,
    ).test(earlier);
  }

  return false;
}

function submitFollowedByNavigation(lines, index) {
  let at = index - 1;
  while (at >= 0 && isProse(lines[at])) at -= 1;
  // A round-trip assertion is transparent: step over it and keep looking for
  // the submit, exactly as if it were a comment.
  while (at >= 0 && echoesAnEarlierEdit(lines, at)) {
    at = statementStart(lines, at) - 1;
    while (at >= 0 && isProse(lines[at])) at -= 1;
  }
  if (at < 0 || !/\.click\s*\(/.test(lines[at])) return false;
  return SUBMIT_LABEL.test(statementAbove(lines, at));
}

/**
 * Pure scanner, exported for tests. Returns { rule, line, text } per hit;
 * a line acknowledged by the marker (on itself or the line above) is skipped.
 */
export function findHygieneViolations(source) {
  const lines = source.split("\n");
  const violations = [];
  lines.forEach((line, index) => {
    // Comment lines are prose about the pattern, not the pattern — the a11y
    // spec documents *why* its one networkidle wait is sound in comments that
    // would otherwise trip this scan.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    const acknowledged =
      line.includes(ACKNOWLEDGEMENT) || (index > 0 && lines[index - 1].includes(ACKNOWLEDGEMENT));
    if (acknowledged) return;
    for (const rule of rules) {
      if (!rule.pattern.test(line)) continue;
      // A rule may name a proof that makes the shape sound — see `empty-all`.
      // The window looks back only: a proof written *after* the loop it is
      // meant to guard has already let the loop run on nothing.
      if (rule.precededBy) {
        const from = Math.max(0, index - rule.window);
        const before = lines.slice(from, index + 1).join("\n");
        if (rule.precededBy.test(before)) continue;
      }
      // The mirror of `precededBy`: a lookback that *creates* the hit rather
      // than clearing it — see `action-race`, where the pattern alone matches
      // every navigation in the suite and only what precedes it is the defect.
      if (rule.predicate && !rule.predicate(lines, index)) continue;
      violations.push({ rule: rule.id, line: index + 1, text: line.trim() });
    }
  });
  return violations;
}

/**
 * **Quarantine: a proven flake leaves the PR path for at most seven days.**
 *
 * A test tagged `@quarantine` (in its title or its `tag:` option) is skipped by
 * every PR and local run (`grepInvert` in playwright.config.ts) and runs nightly
 * in e2e-nightly.yml, where `DIVEDAY_RUN_QUARANTINE=1` lets it back in. The tag
 * is owned, not parked: the line carrying it, or one of the
 * {@link QUARANTINE_WINDOW} lines above it, says
 *
 *     // diveday:quarantine #1234 until 2026-10-22: <what flakes>
 *
 * naming the open issue that tracks the fix and a date no more than
 * {@link QUARANTINE_MAX_DAYS} days out. The day after that date this guard fails
 * on every branch, so a lapsed quarantine turns CI red rather than becoming a
 * permanent skip. At most {@link QUARANTINE_CAP} tests are quarantined at once
 * (testing review decision 4, 2026-10-14). Whether the issue is still open is not
 * read here: check:repo opens no network connection.
 */
export const QUARANTINE_MARKER = "diveday:quarantine";
export const QUARANTINE_MAX_DAYS = 7;
export const QUARANTINE_CAP = 3;
const QUARANTINE_WINDOW = 4;
const QUARANTINE_TAG = /@quarantine\b/;
const QUARANTINE_LINE = /diveday:quarantine\s+#(\d+)\s+until\s+(\d{4}-\d{2}-\d{2})/;

const isCommentLine = (line) => {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
};

/** Every `@quarantine` tag in a spec, with the issue and expiry its marker names (or nulls). */
export function findQuarantines(source) {
  const lines = source.split("\n");
  const found = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line) || !QUARANTINE_TAG.test(line)) return;
    let marker = null;
    for (let at = index; at >= Math.max(0, index - QUARANTINE_WINDOW); at -= 1) {
      if (lines[at].includes(QUARANTINE_MARKER)) {
        marker = lines[at];
        break;
      }
    }
    const parsed = marker?.match(QUARANTINE_LINE);
    found.push({
      line: index + 1,
      issue: parsed ? Number(parsed[1]) : null,
      until: parsed ? parsed[2] : null,
    });
  });
  return found;
}

/** `YYYY-MM-DD` plus `days`, in UTC. */
function addDays(day, days) {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * The problems with a set of quarantines (`[{ file, line, issue, until }]`) on `today`
 * (`YYYY-MM-DD`). Pure, so the date is an argument rather than a clock read.
 */
export function auditQuarantines(quarantines, today) {
  const problems = [];
  const latest = addDays(today, QUARANTINE_MAX_DAYS);
  for (const { file, line, issue, until } of quarantines) {
    const where = `${file}:${line}`;
    if (issue === null || until === null) {
      problems.push(
        `${where} [quarantine]: @quarantine needs \`// ${QUARANTINE_MARKER} #<open issue> until <YYYY-MM-DD>: <what flakes>\` on the tag's line or the ${QUARANTINE_WINDOW} above it.`,
      );
    } else if (until < today) {
      problems.push(
        `${where} [quarantine]: the quarantine for #${issue} expired on ${until}. Fix the flake and drop the tag; a quarantine is never renewed by moving the date.`,
      );
    } else if (until > latest) {
      problems.push(
        `${where} [quarantine]: expiry ${until} is more than ${QUARANTINE_MAX_DAYS} days out (latest ${latest}) for #${issue}.`,
      );
    }
  }
  if (quarantines.length > QUARANTINE_CAP) {
    problems.push(
      `${quarantines.length} tests are quarantined; at most ${QUARANTINE_CAP} may be at once. Fix one before quarantining another.`,
    );
  }
  return problems;
}

/**
 * **Long English sentences in locators, ratcheted.**
 *
 * A spec that finds an element by a whole sentence (`getByText("…")`,
 * `toContainText("…")`) breaks on every rewording, and only the run that happens
 * to include that spec notices: the dominant break class in the 2026-10-14 CI
 * audit (242 such literals). A string literal of {@link LONG_LITERAL} or more
 * characters passed to either is counted per file in scripts/ratchets.json under
 * `e2e-long-literals`; a count may only fall. Find the element by role and
 * accessible name, or read the sentence from its message bundle
 * (`.claude/rules/e2e.md` shows both). Interpolations in a template literal do
 * not count toward its length.
 */
export const LONG_LITERAL = 40;
export const LITERAL_GUARD = "e2e-long-literals";
const LITERAL_CALL = /\b(?:getByText|toContainText)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** Each long literal passed to getByText/toContainText: `[{ line, text }]`. */
export function findLongLiterals(source) {
  const hits = [];
  const lines = source.split("\n");
  for (const match of source.matchAll(LITERAL_CALL)) {
    const text = match[1] === "`" ? match[2].replace(/\$\{[^}]*\}/g, "") : match[2];
    if (text.length < LONG_LITERAL) continue;
    const line = source.slice(0, match.index).split("\n").length;
    if (isCommentLine(lines[line - 1])) continue;
    hits.push({ line, text: match[2] });
  }
  return hits;
}

/** Per-file long-literal counts (`Map<file, hits>`) against the banked allowance. */
export function auditLongLiterals(counts, allowed) {
  const failures = [];
  for (const [file, hits] of counts) {
    const allowance = allowed[file] ?? 0;
    if (hits.length > allowance) {
      failures.push(
        `${file} [long-literal]: ${hits.length} getByText/toContainText literals of ${LONG_LITERAL}+ characters, baseline allows ${allowance}:\n${hits.map((hit) => `    ${hit.line}: ${hit.text}`).join("\n")}\n    Find it by role and name, or read the sentence from its message bundle (.claude/rules/e2e.md).`,
      );
    } else if (hits.length < allowance) {
      failures.push(
        `${file} [long-literal]: down to ${hits.length} from ${allowance} — bank it in this change (\`node scripts/check-e2e-hygiene.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(allowed)) {
    if (!counts.has(file)) {
      failures.push(
        `${file} [long-literal]: clean or gone — remove its baseline entry (\`node scripts/check-e2e-hygiene.mjs --write\`).`,
      );
    }
  }
  return failures;
}

async function walk(relativeDirectory) {
  return filesUnder(
    relativeDirectory,
    (directory) => readdir(path.join(process.cwd(), directory), { withFileTypes: true }),
    (_relativePath, entry) => /\.tsx?$/.test(entry.name),
  );
}

async function main() {
  const root = process.cwd();
  const problems = [];
  const quarantines = [];
  const literals = new Map();
  for (const file of await walk("e2e")) {
    const contents = await readFile(path.join(root, file), "utf8");
    for (const violation of findHygieneViolations(contents)) {
      const rule = rules.find((r) => r.id === violation.rule);
      problems.push(
        `${file}:${violation.line} [${violation.rule}]: ${violation.text}\n    ${rule.message}`,
      );
    }
    for (const quarantine of findQuarantines(contents)) quarantines.push({ file, ...quarantine });
    const long = findLongLiterals(contents);
    if (long.length > 0) literals.set(file, long);
  }

  const { counts: allowed, exists } = await readCounts(root, LITERAL_GUARD);
  const { write, absorb } = ratchetFlags();
  if (write || absorb !== null) {
    process.exit(
      await bankCounts({
        root,
        guard: LITERAL_GUARD,
        script: "check-e2e-hygiene",
        counts: literals,
        allowed,
        exists,
        note: `getByText/toContainText string literals of ${LONG_LITERAL}+ characters in e2e/, per file, written before the ratchet (testing review decision 8). A count may only fall. Written by \`node scripts/check-e2e-hygiene.mjs --write\`.`,
        refusal: "Find the new element by role and name, or read its sentence from the bundle",
        absorb,
        summary: (files, total) => `${files} files, ${total} long literals`,
      }),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const policy = [...auditQuarantines(quarantines, today), ...auditLongLiterals(literals, allowed)];

  if (problems.length > 0 || policy.length > 0) {
    console.error(
      `E2E hygiene violations:\n${[...problems, ...policy].map((p) => `- ${p}`).join("\n")}`,
    );
    if (problems.length > 0) {
      console.error(
        `A timing guess is never the fix — wait for what the page renders when the work is done (debug skill: "A flake is a bug"). If a line is genuinely deterministic, acknowledge it with \`${ACKNOWLEDGEMENT} <rule>: <why>\` naming the mechanism.`,
      );
    }
    process.exit(1);
  }

  const total = [...literals.values()].reduce((sum, hits) => sum + hits.length, 0);
  console.log(
    `e2e-hygiene: no sleeps, networkidle waits, or retry shims in e2e/; ${quarantines.length}/${QUARANTINE_CAP} quarantined; ${total} banked long literals`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
