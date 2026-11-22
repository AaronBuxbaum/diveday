#!/usr/bin/env node
// A pull request that loosens the rules that judge it says so in plain words and has a fresh reviewer read just that part.
//
// The tests, coverage floors, ratchets and `check:*` scripts decide whether a change is fine, so
// they are what an agent in a hurry could quietly weaken to turn a red check green, and with nobody
// reading the diff, nothing else would notice. This reads the diff for the ways that happens:
//
//   - a test file deleted (unless the code it tested was deleted with it), or a test that lost
//     assertions, gained a `.skip`, `.todo` or `.only`, or whose expected answer or matcher changed
//     (`toBe(100)` became `toBe(90)`; `toEqual({...})` became `toBeTruthy()`);
//   - a coverage floor lowered or removed, a ratchet's allowance raised, a reason added to an
//     `//absorbed` list;
//   - a check script, the CI workflow, a lint or build or test setting, the shared test harness
//     or the rules agents follow edited (a removed line) or deleted.
//
// Such a pull request must carry a `## Rules changed` section saying in plain words what loosened
// and why, and a `referee-reviewer` line under `## Reviews launched`: a fresh agent that reads only
// those edits and answers whether they make a bad change easier to merge. Additions that only
// tighten (a new test, a higher floor, a new check) are listed and need nothing.
//
// It cannot tell whether the loosening is right. It makes sure a person or a second reader was
// shown it, and that the risk card puts it where Aaron reads. The author's sentence is quoted on
// the card as the author's account, not as a finding.
//
//   node scripts/check-referee-edits.mjs --base <ref> [--head HEAD] --body-file <path> [--out <json>]
//   node scripts/check-referee-edits.mjs --base <ref> --explain      (what to hand the reviewer)
//
// CI runs it in the safeguards job on every pull request, against the stack's base, and hands the
// JSON to the risk card. Heuristics over source text, so it over-reports a little and says what it saw.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { reviewAnswered, reviewsSection } from "./check-pr-body.mjs";
import { areasOf, isTestFile, ruleFileKind } from "./guardrail-areas.mjs";
import { bodySection } from "./risk-card.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { parseNameStatus } from "./warn-untested-logic.mjs";

export const REFEREE_AGENT = "referee-reviewer";

/** Areas where a weakened test is a decision for Aaron rather than a line in a list. */
const WEIGHTY = new Set(["money", "safety", "privacy", "offline"]);

// --- reading source ---------------------------------------------------------------------------

/** Source with comments removed, so a commented-out assertion is not counted. */
function withoutComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** How many tests, assertions and switched-off tests a test file holds. */
export function testCounts(source) {
  const text = withoutComments(source);
  const count = (re) => text.match(re)?.length ?? 0;
  return {
    tests: count(/(?:^|[\s;(])(?:it|test)(?:\.(?:each|concurrent|fails|for))?\s*[(`]/gm),
    assertions: count(/\b(?:expect(?:\.soft)?|assert(?:\.\w+)?)\s*\(|\.toThrow|\.rejects\b/g),
    switchedOff: count(
      /\b(?:it|test|describe)\.(?:skip|todo|fixme|only)\b|\bx(?:it|describe)\s*\(|@quarantine\b/g,
    ),
  };
}

/** What a changed test file lost, given its text before and after; `after` null means deleted. */
export function testLoss(before, after) {
  const was = testCounts(before);
  if (after === null)
    return { deleted: true, tests: was.tests, assertions: was.assertions, switchedOff: 0 };
  const now = testCounts(after);
  return {
    deleted: false,
    tests: Math.max(0, was.tests - now.tests),
    assertions: Math.max(0, was.assertions - now.assertions),
    switchedOff: Math.max(0, now.switchedOff - was.switchedOff),
  };
}

const STRONG = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toBeCloseTo",
  "toHaveLength",
  "toThrow",
  "toThrowError",
  "toHaveBeenCalledWith",
  "toHaveBeenCalledTimes",
  "toBeNull",
  "toBeUndefined",
  "toBeFalsy",
]);
const WEAK = new Set([
  "toBeTruthy",
  "toBeDefined",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "toContain",
  "toMatchObject",
  "toBeInstanceOf",
  "toHaveBeenCalled",
  "toMatch",
]);

/** `expect(subject).matcher(args)` on one line, or null. */
export function parseExpect(line) {
  const match = String(line)
    .trim()
    .match(/^(?:await\s+)?expect\((.*)\)\.((?:not\.|resolves\.|rejects\.)*)(to\w+)\((.*)\);?$/);
  if (!match) return null;
  return { subject: match[1], prefix: match[2], matcher: match[3], args: match[4] };
}

/** Hunks of a `git diff -U0` text: `{ file, removed, added }` with the lines' own text. */
export function parseHunks(patch) {
  const hunks = [];
  let file = null;
  let fallback = null;
  let hunk = null;
  for (const line of String(patch).split("\n")) {
    if (line.startsWith("--- ")) {
      fallback = line.startsWith("--- a/") ? line.slice(6) : null;
    } else if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : fallback;
      hunk = null;
    } else if (line.startsWith("@@")) {
      hunk = { file, removed: [], added: [] };
      hunks.push(hunk);
    } else if (hunk && line.startsWith("-")) hunk.removed.push(line.slice(1));
    else if (hunk && line.startsWith("+")) hunk.added.push(line.slice(1));
  }
  return hunks.filter((entry) => entry.file);
}

/**
 * Expectations whose answer or strength changed in place: `expect(x).toBe(100)` becoming
 * `toBe(90)`, or `toEqual(...)` becoming `toBeTruthy()`. Moves and rewrites that change the
 * subject are not paired, so they are not reported (a heuristic that stays quiet when unsure).
 */
export function changedExpectations(hunks) {
  const found = [];
  for (const hunk of hunks) {
    if (!isTestFile(hunk.file)) continue;
    const added = hunk.added.map(parseExpect).filter(Boolean);
    const used = new Set();
    for (const old of hunk.removed.map(parseExpect).filter(Boolean)) {
      const at = added.findIndex(
        (now, index) =>
          !used.has(index) &&
          now.subject === old.subject &&
          now.prefix === old.prefix &&
          (now.matcher !== old.matcher || now.args !== old.args),
      );
      if (at === -1) continue;
      used.add(at);
      const now = added[at];
      if (now.matcher === old.matcher) {
        found.push({
          file: hunk.file,
          kind: "answer",
          subject: old.subject,
          was: old.args,
          became: now.args,
        });
      } else if (STRONG.has(old.matcher) && WEAK.has(now.matcher)) {
        found.push({
          file: hunk.file,
          kind: "weaker",
          subject: old.subject,
          was: old.matcher,
          became: now.matcher,
        });
      }
    }
  }
  return found;
}

// --- floors, ratchets, allowances -------------------------------------------------------------

/** Every number in a JSON value, keyed by its path. */
export function numericLeaves(value, prefix = "", into = new Map()) {
  if (typeof value === "number") into.set(prefix, value);
  else if (Array.isArray(value))
    for (const [i, item] of value.entries()) numericLeaves(item, `${prefix}[${i}]`, into);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "//" || key === "note") continue;
      numericLeaves(item, prefix ? `${prefix}.${key}` : key, into);
    }
  }
  return into;
}

/** Floors that fell, or whose file is no longer measured though it still exists. */
export function loweredFloors(before, after, exists = () => true) {
  const was = numericLeaves(before);
  const now = numericLeaves(after);
  const lowered = [];
  for (const [key, value] of was) {
    if (!key.startsWith("src/")) continue;
    if (!now.has(key)) {
      if (exists(key)) lowered.push({ key, was: value, now: null });
    } else if (now.get(key) < value) lowered.push({ key, was: value, now: now.get(key) });
  }
  return lowered.toSorted((a, b) => a.key.localeCompare(b.key));
}

/** A ratchet key in words: `architecture.src/lib/auth.ts` is "the architecture allowance for `src/lib/auth.ts`". */
export function allowanceName(key) {
  const dot = key.indexOf(".");
  const guard = dot === -1 ? key : key.slice(0, dot);
  const rest = (dot === -1 ? "" : key.slice(dot + 1)).replace(/^budgets\./, "");
  return rest ? `the ${guard} allowance for \`${rest}\`` : `the ${guard} allowance`;
}

/** Ratchet allowances that rose, or appeared above zero. */
export function raisedAllowances(before, after) {
  const was = numericLeaves(before);
  const raised = [];
  for (const [key, value] of numericLeaves(after)) {
    const old = was.get(key) ?? 0;
    if (value > old) raised.push({ key, was: old, now: value });
  }
  return raised.toSorted((a, b) => a.key.localeCompare(b.key));
}

/** Reasons newly added to any `//absorbed` list: each is a recorded loosening and says why. */
export function newAbsorbedReasons(before, after) {
  const reasons = [];
  const walk = (was, now) => {
    if (!now || typeof now !== "object") return;
    for (const [key, value] of Object.entries(now)) {
      if (key === "//absorbed" && Array.isArray(value)) {
        const seen = new Set(
          (Array.isArray(was?.[key]) ? was[key] : []).map((item) => JSON.stringify(item)),
        );
        for (const item of value)
          if (!seen.has(JSON.stringify(item)) && item?.why) reasons.push(String(item.why));
      } else walk(was?.[key], value);
    }
  };
  walk(before, after);
  return reasons;
}

// --- rule files -------------------------------------------------------------------------------

// --- the verdict ------------------------------------------------------------------------------

const GENERIC_NONE = /^(?:none|n\/a|na|no|nothing|-+|—|\.+)\.?$/i;

/** The author's `## Rules changed` answer, or "" when it is empty or only "none". */
export function statementOf(body) {
  const text = bodySection(body, "Rules changed").replace(/\s+/g, " ").trim();
  return text.length >= 20 && !GENERIC_NONE.test(text) ? text : "";
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quote = (text, limit = 220) => {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit).replace(/\s+\S*$/, "")}…`;
};

/**
 * What the referee found, from measured data. Pure.
 *
 *   changes   [{ path, status, added, removed }]
 *   before / after   `(path) => text | null` for the file at the fork and at the head
 *   hunks     parseHunks(-U0 patch over the changed files)
 *   body      the pull request body
 */
export function refereeReport({ changes, before, after, hunks, body }) {
  const statement = statementOf(body);
  const reason = statement ? `The author's reason: "${quote(statement)}"` : "No reason was given.";
  const needsEyes = [];
  const watch = [];
  const protects = [];
  let loosens = 0;
  let tightens = 0;

  const deleted = new Set(
    changes.filter((change) => change.status === "D").map((change) => change.path),
  );
  const sourceFor = (test) => {
    const stem = test.replace(/\.(?:test|spec)(?:\.[\w-]+)*\.[cm]?[jt]sx?$/, "");
    return [".ts", ".tsx", ".mjs", ".js"].map((ext) => `${stem}${ext}`);
  };
  const tier = (file) => (areasOf(file).some((id) => WEIGHTY.has(id)) ? needsEyes : watch);
  const item = (file, what, ask) => ({ what: `${what} (\`${file}\`).`, ask: `${ask} ${reason}` });

  for (const change of changes) {
    if (!isTestFile(change.path)) continue;
    if (change.status === "D") {
      if (sourceFor(change.path).some((source) => deleted.has(source))) continue;
      const loss = testLoss(before(change.path) ?? "", null);
      if (loss.tests === 0 && loss.assertions === 0) continue;
      loosens += 1;
      tier(change.path).push(
        item(
          change.path,
          `A test file was deleted (${plural(loss.tests, "test")}, ${plural(loss.assertions, "check")}) and the code it tested was not`,
          "Is that behavior still protected somewhere?",
        ),
      );
    } else if (change.status === "M") {
      const loss = testLoss(before(change.path) ?? "", after(change.path) ?? "");
      if (loss.switchedOff > 0) {
        loosens += 1;
        tier(change.path).push(
          item(
            change.path,
            `${plural(loss.switchedOff, "test")} switched off (skipped, set to do later or run alone)`,
            "Why is it safe to not run it?",
          ),
        );
      }
      const weighty = areasOf(change.path).some((id) => WEIGHTY.has(id));
      if (loss.assertions >= (weighty ? 1 : 5)) {
        const was = testCounts(before(change.path) ?? "");
        const now = testCounts(after(change.path) ?? "");
        loosens += 1;
        tier(change.path).push(
          item(
            change.path,
            `A test now makes ${plural(loss.assertions, "check")} fewer (${was.assertions} before, ${now.assertions} now)`,
            "Did the rule get simpler, or did the test get weaker?",
          ),
        );
      }
    }
  }

  for (const found of changedExpectations(hunks)) {
    loosens += 1;
    const words =
      found.kind === "answer"
        ? `A test's expected answer changed: \`${quote(found.subject, 60)}\` was expected to be ${quote(found.was, 60)} and is now ${quote(found.became, 60)}`
        : `A test's check got weaker: \`${quote(found.subject, 60)}\` was held to \`${found.was}\` and is now held to \`${found.became}\``;
    tier(found.file).push(
      item(found.file, words, "Was the old answer wrong, or was the code made to fit?"),
    );
  }

  const floorPatches = (file, parse) => {
    if (!changes.some((change) => change.path === file)) return null;
    const read = (text) => {
      try {
        return JSON.parse(text ?? "{}");
      } catch {
        return {};
      }
    };
    return parse(read(before(file)), read(after(file)));
  };

  floorPatches("scripts/coverage-floors.json", (was, now) => {
    for (const lowered of loweredFloors(was, now, (key) => after(key) !== null)) {
      loosens += 1;
      needsEyes.push(
        item(
          lowered.key,
          `A coverage floor was ${lowered.now === null ? "removed" : `lowered from ${lowered.was}% to ${lowered.now}%`}: fewer branches of this safety file must be tested`,
          "Is the lower bar deliberate?",
        ),
      );
    }
    for (const why of newAbsorbedReasons(was, now)) {
      watch.push(`A floor fall was recorded with this reason: "${quote(why)}"`);
    }
    return null;
  });
  floorPatches("scripts/mutation/floors.json", (was, now) => {
    for (const lowered of loweredFloors(was, now, (key) => after(key) !== null)) {
      loosens += 1;
      needsEyes.push(
        item(
          lowered.key,
          `A breakage-drill score floor was ${lowered.now === null ? "removed" : `lowered from ${lowered.was}% to ${lowered.now}%`}: fewer deliberate breaks of this file must be caught`,
          "Is the lower bar deliberate?",
        ),
      );
    }
    for (const why of newAbsorbedReasons(was, now)) {
      watch.push(`A breakage-drill floor fall was recorded with this reason: "${quote(why)}"`);
    }
    return null;
  });
  floorPatches("scripts/cross-shop-coverage.json", (was, now) => {
    const raised =
      before("scripts/cross-shop-coverage.json") === null ? [] : raisedAllowances(was, now);
    if (raised.length > 0) {
      loosens += 1;
      needsEyes.push({
        what: `The count of database functions the cross-shop sweep cannot check yet went up (${raised
          .map((entry) => `${entry.was} to ${entry.now}`)
          .join(", ")}): more of them can now hand one shop's rows to another unseen.`,
        ask: `Is that deliberate? ${reason}`,
      });
    }
    return null;
  });
  floorPatches("scripts/ratchets.json", (was, now) => {
    const raised = raisedAllowances(was, now);
    if (raised.length > 0) {
      loosens += 1;
      needsEyes.push({
        what: `${plural(raised.length, "allowance")} in the ratchets was raised (${raised
          .slice(0, 3)
          .map((entry) => `\`${entry.key}\` ${entry.was} to ${entry.now}`)
          .join(
            ", ",
          )}${raised.length > 3 ? ` and ${raised.length - 3} more` : ""}): the codebase may now carry more of something a check used to hold down.`,
        ask: `Is the extra allowance deliberate? ${reason}`,
      });
    }
    for (const why of newAbsorbedReasons(was, now)) {
      watch.push(`A ratchet rise was recorded with this reason: "${quote(why)}"`);
    }
    return null;
  });

  const ruleEdits = [];
  for (const change of changes) {
    const kind = ruleFileKind(change.path);
    if (!kind || kind.kind === "floors") continue;
    if (change.status === "A") {
      tightens += 1;
      ruleEdits.push({ ...change, ...kind, how: "added" });
    } else if (change.status === "D") {
      loosens += 1;
      ruleEdits.push({ ...change, ...kind, how: "removed" });
    } else if (change.removed > 0) {
      loosens += 1;
      ruleEdits.push({ ...change, ...kind, how: "edited" });
    } else {
      tightens += 1;
      ruleEdits.push({ ...change, ...kind, how: "extended" });
    }
  }
  for (const edit of ruleEdits) {
    if (edit.how === "removed") {
      needsEyes.push(
        item(
          edit.path,
          `${edit.words[0].toUpperCase()}${edit.words.slice(1)} was deleted`,
          "Is the rule it held still held somewhere?",
        ),
      );
    } else if (edit.how === "edited") {
      watch.push(
        `The rules changed: ${edit.words} was edited, ${plural(edit.removed, "line")} removed and ${edit.added} added (\`${edit.path}\`).`,
      );
    } else {
      protects.push(
        `${edit.how === "added" ? "Added" : "Extended"} ${edit.words} (\`${edit.path}\`).`,
      );
    }
  }

  const suppressions = hunks
    .filter((hunk) => /^src\//.test(hunk.file) && !isTestFile(hunk.file))
    .flatMap((hunk) =>
      hunk.added
        .filter((line) =>
          /biome-ignore|@ts-ignore|@ts-expect-error|mutation-ok|diveday:allow-/.test(line),
        )
        .map(() => hunk.file),
    );
  if (suppressions.length > 0) {
    watch.push(
      `${plural(suppressions.length, "rule was")} switched off in product code with a written excuse (${[
        ...new Set(suppressions),
      ]
        .slice(0, 3)
        .map((file) => `\`${file}\``)
        .join(", ")}${new Set(suppressions).size > 3 ? " and more" : ""}).`,
    );
  }

  if (loosens === 0 && needsEyes.length === 0) {
    protects.unshift(
      "Referee: no test was deleted or weakened, no floor lowered, no check loosened.",
    );
  }
  return { loosens, tightens, needsEyes, watch, protects, statement };
}

/**
 * Whether the body answers for a loosening: a `## Rules changed` sentence, and a `referee-reviewer`
 * line under `## Reviews launched`. Returns the sentences to fix, empty when nothing loosened or it is answered.
 */
export function refereeProblems({ loosens }, body) {
  if (loosens === 0) return [];
  const problems = [];
  if (!statementOf(body)) {
    problems.push(
      `This pull request loosens a rule (${plural(loosens, "change")}) and its "## Rules changed" section says nothing. Write one or two plain sentences: what got looser, and why that is safe. "none" is not an answer to a pull request that edits a test's expected answer, lowers a floor or edits a check.`,
    );
  }
  if (!reviewAnswered(reviewsSection(body), REFEREE_AGENT)) {
    problems.push(
      `This pull request loosens a rule and its "## Reviews launched" section does not name \`${REFEREE_AGENT}\` with an answer. Launch it on the rule changes (\`node scripts/check-referee-edits.mjs --base origin/main --explain\` prints what to hand it) and write what it found, or write "\`${REFEREE_AGENT}\`: not needed because <reason>".`,
    );
  }
  return problems;
}

// --- running against git ----------------------------------------------------------------------

function git(args) {
  return String(
    readBounded("git", args, {
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
      maxBuffer: 256 * 1024 * 1024,
    }),
  );
}

function shown(rev, file) {
  try {
    return git(["show", `${rev}:${file}`]);
  } catch {
    return null;
  }
}

/** The report for `base...head`, with the git reads in one place. */
export function reportFor({ base, head, body }) {
  const range = `${base}...${head}`;
  const fork = git(["merge-base", base, head]).trim();
  const status = parseNameStatus(git(["diff", "--name-status", "--no-renames", range]));
  const numstat = new Map(
    git(["diff", "--numstat", "--no-renames", range])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [added, removed, ...rest] = line.split("\t");
        return [rest.join("\t"), { added: Number(added) || 0, removed: Number(removed) || 0 }];
      }),
  );
  const changes = status.map(({ status: code, path: file }) => ({
    path: file,
    status: code,
    added: numstat.get(file)?.added ?? 0,
    removed: numstat.get(file)?.removed ?? 0,
  }));
  // Test files, for changed answers, and product files, for new switched-off rules.
  const interesting = changes
    .filter((change) => change.status !== "D")
    .filter((change) => isTestFile(change.path) || /^src\//.test(change.path))
    .map((change) => change.path);
  const patch =
    interesting.length > 0 ? git(["diff", "-U0", "--no-renames", range, "--", ...interesting]) : "";
  const report = refereeReport({
    changes,
    before: (file) => shown(fork, file),
    after: (file) => shown(head, file),
    hunks: parseHunks(patch),
    body,
  });
  return { report, changes, fork };
}

function parseArgs(argv) {
  const args = { head: "HEAD" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--explain") args.explain = true;
    else if (["--base", "--head", "--body-file", "--out"].includes(arg)) {
      args[arg.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else {
      console.error(`check-referee-edits: unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = args.base ?? "origin/main";
  const body =
    args.bodyFile && existsSync(args.bodyFile) ? readFileSync(args.bodyFile, "utf8") : "";
  const { report, changes, fork } = reportFor({ base, head: args.head, body });
  if (args.explain) {
    const rule = changes.filter((change) => ruleFileKind(change.path) || isTestFile(change.path));
    for (const change of rule) {
      if (change.status === "A") continue;
      const text = git([
        "diff",
        "-U3",
        "--no-renames",
        `${fork}...${args.head}`,
        "--",
        change.path,
      ]);
      console.log(
        `=== ${change.path} (${change.status}) ===\n${text.slice(0, 6000)}${text.length > 6000 ? "\n… cut" : ""}`,
      );
    }
    return 0;
  }
  const problems = refereeProblems(report, body);
  const json = {
    schema: 1,
    loosens: report.loosens,
    statementOk: report.loosens === 0 || Boolean(report.statement),
    statement: report.statement,
    needsEyes: report.needsEyes,
    watch: report.watch,
    protects: report.protects,
    problems,
  };
  if (args.out) {
    mkdirSync(path.dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(json, null, 2)}\n`);
  }
  if (problems.length > 0) {
    console.error("referee-edits: a rule was loosened without saying so\n");
    for (const problem of problems) console.error(`- ${problem}`);
    console.error("");
    for (const line of [...report.needsEyes.map((entry) => entry.what), ...report.watch])
      console.error(`  saw: ${line}`);
    return 1;
  }
  console.log(
    `referee-edits: ${plural(report.loosens, "loosening")}, ${plural(report.tightens, "tightening")}; ${report.loosens > 0 ? "named and reviewed" : "nothing to answer for"}`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
