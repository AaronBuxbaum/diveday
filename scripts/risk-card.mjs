#!/usr/bin/env node
// The risk card: what a pull request changed, in plain words, and what does and does not protect it.
//
// Aaron checks screens, not diffs, and no human reads the code an agent writes. This card is what
// he reads instead. It sorts the changed files into the areas where a mistake hurts (money, dive
// safety, privacy, offline roll call, the database), says what tests changed beside them, what
// the breakage drills and the referee guard found, and ends in one of two verdicts: "fine to merge
// once the checks are green" or "needs your eyes", with the plain-words reason and the question to
// answer. It never says a change is *right*: it reads which files changed and what the other
// guardrails reported, and says so in its last section.
//
// It is advisory. Every path exits 0 and the workflow step is `continue-on-error`: the gates that
// block a merge are their own CI jobs (`mutation-diff`, the referee guard in `check:repo`, the
// coverage floors); this card shows what they found. It needs only bare `node` and git, so it
// still reports when install is what broke, like `scripts/visual-pr-comment.mjs`.
//
//   node scripts/risk-card.mjs --base <ref> [--head HEAD] [--body-file f] [--mutation f]
//        [--referee f] [--out dir] [--post]
//
// `--post` writes the sticky comment (marker below) to the pull request named by `PR_NUMBER`,
// `GITHUB_REPOSITORY` and `GH_TOKEN`, and appends the card to `$GITHUB_STEP_SUMMARY`. Without it the
// card prints. `--mutation` is the JSON `scripts/mutation/run.mjs` wrote and `--referee` the JSON
// `scripts/check-referee-edits.mjs` wrote; each section is left out when its file is absent, and the card
// says it did not run.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { AREAS, areasOf, isLogicFile, isTestFile } from "./guardrail-areas.mjs";
import { classifyScope } from "./mutation/scope.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { parseNameStatus } from "./warn-untested-logic.mjs";

export const MARKER = "<!-- diveday:risk-card -->";
export const GUARDRAILS_DOC = "docs/engineering/guardrails.md";

/** `git diff --numstat --no-renames` as `{ path, added, removed }`; a binary file counts as zero. */
export function parseNumstat(output) {
  return String(output)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...rest] = line.split("\t");
      return { path: rest.join("\t"), added: Number(added) || 0, removed: Number(removed) || 0 };
    });
}

/** Whether a line of source says which shop a query belongs to. */
const SHOP_MENTION = /shop_?id/i;

/**
 * Files that mention the shop in fewer places than before, from `git diff -U0` text. A query that
 * stops saying which shop it belongs to is how one shop reads another's rows, and nobody reads
 * the query, so the count of mentions is the signal. A refactor that moves the mention shows up
 * too; the card asks, it does not accuse.
 */
export function shopScopingLosses(patch) {
  const files = new Map();
  let current = null;
  for (const line of String(patch).split("\n")) {
    if (line.startsWith("+++ ")) {
      current = line.startsWith("+++ b/") ? line.slice(6) : null;
      continue;
    }
    if (!current || line.startsWith("--- ") || !/^[+-]/.test(line)) continue;
    if (!SHOP_MENTION.test(line)) continue;
    const entry = files.get(current) ?? { added: 0, removed: 0 };
    if (line[0] === "+") entry.added += 1;
    else entry.removed += 1;
    files.set(current, entry);
  }
  return [...files]
    .filter(([file, { added, removed }]) => isLogicFile(file) && removed > added)
    .map(([file, { added, removed }]) => ({ file, lost: removed - added }))
    .toSorted((a, b) => a.file.localeCompare(b.file));
}

/** Added, removed and re-versioned packages between two `package.json` texts. */
export function packageChanges(beforeText, afterText) {
  const read = (text) => {
    try {
      const json = JSON.parse(text);
      return { run: json.dependencies ?? {}, dev: json.devDependencies ?? {} };
    } catch {
      return { run: {}, dev: {} };
    }
  };
  const before = read(beforeText);
  const after = read(afterText);
  const out = { added: [], removed: [], bumped: [] };
  for (const kind of ["run", "dev"]) {
    for (const [name, version] of Object.entries(after[kind])) {
      const was = before.run[name] ?? before.dev[name];
      if (was === undefined) out.added.push({ name, kind });
      else if (was !== version && kind === (name in before.run ? "run" : "dev")) {
        const major = (v) =>
          String(v)
            .replace(/^[^\d]*/, "")
            .split(".")[0];
        out.bumped.push({
          name,
          kind,
          from: was,
          to: version,
          major: major(was) !== major(version),
        });
      }
    }
    for (const name of Object.keys(before[kind])) {
      if (!(name in after.run) && !(name in after.dev)) out.removed.push({ name, kind });
    }
  }
  return out;
}

/** The statements in migration SQL that remove data or structure, in plain words. */
export function removingStatements(sql) {
  const found = [];
  const text = String(sql).replace(/--[^\n]*/g, "");
  const rules = [
    [/\bDROP\s+TABLE\b/i, "removes a table"],
    [/\bDROP\s+COLUMN\b/i, "removes a column"],
    [/\bDROP\s+(?:SCHEMA|TYPE)\b/i, "removes a schema or type"],
    [/\bTRUNCATE\b/i, "empties a table"],
    [/\bDELETE\s+FROM\b/i, "deletes rows"],
  ];
  for (const [re, words] of rules) if (re.test(text)) found.push(words);
  return found;
}

/** The text under a `## <title>` heading of a pull request body, comments removed. */
export function bodySection(body, title) {
  let text = String(body ?? "").replace(/\r\n/g, "\n");
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/<!--[\s\S]*?-->/g, "");
  }
  const re = new RegExp(`^##\\s+${title}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "im");
  return text.match(re)?.[1].trim() ?? "";
}

/** A one-paragraph excerpt, cut on a word and marked when cut. */
export function excerpt(text, limit = 600) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit).replace(/\s+\S*$/, "")}…`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Test files that sit beside a logic file: same folder, same stem. */
export function siblingTests(file, testFiles) {
  const dir = path.posix.dirname(file);
  const stem = path.posix.basename(file).replace(/\.[cm]?[jt]sx?$/, "");
  return testFiles.filter((test) => {
    if (path.posix.dirname(test) !== dir) return false;
    const name = path.posix.basename(test);
    return (
      name.startsWith(`${stem}.test.`) || name.startsWith(`${stem}.`) || name.startsWith(`${stem}-`)
    );
  });
}

/**
 * Everything the card says, from what was measured. Pure: `input` is data, the result is the
 * verdict, the reasons and the Markdown.
 *
 *   changes   [{ path, status, added, removed }]  git's view of the whole stack against its base
 *   body      the pull request body
 *   packages  result of packageChanges, or null
 *   migrations [{ path, removes: string[] }] added migration files
 *   shopLosses result of shopScopingLosses
 *   mutation  parsed `.agent-out/mutation-diff.json`, or null when the job did not run
 *   referee   parsed `.agent-out/referee-edits.json`, or null
 */
export function buildRiskCard(input) {
  const changes = input.changes.filter(
    (change) => change.status !== "D" || isLogicFile(change.path) || isTestFile(change.path),
  );
  const live = changes.filter((change) => change.status !== "D");
  const tests = live.filter((change) => isTestFile(change.path));
  const testPaths = tests.map((change) => change.path);
  const logic = live.filter((change) => isLogicFile(change.path));

  const needs = []; // { what, ask }
  const watch = []; // lines under "Worth a look"
  const protects = [];
  const gaps = [];

  // Areas touched, in card order.
  const touched = [];
  for (const area of AREAS) {
    const hit = changes.filter((change) => areasOf(change.path).includes(area.id));
    if (hit.length === 0) continue;
    const hitTests = hit.filter((change) => isTestFile(change.path));
    const hitLogic = hit.filter((change) => !isTestFile(change.path));
    touched.push({ area, hitLogic, hitTests });
  }

  for (const { area, hitLogic, hitTests } of touched) {
    if (!area.weighty || hitLogic.length === 0) continue;
    const code = hitLogic.filter((change) => isLogicFile(change.path) && change.status !== "D");
    const bare = code.filter((change) => siblingTests(change.path, testPaths).length === 0);
    if (code.length > 0 && hitTests.length === 0) {
      gaps.push(
        `${area.label}: ${plural(code.length, "code file")} changed and no test file changed beside ${code.length === 1 ? "it" : "them"}.`,
      );
    } else if (bare.length > 0) {
      gaps.push(
        `${area.label}: no test changed beside ${listFiles(bare.map((change) => change.path))}.`,
      );
    }
  }

  // Outside code.
  if (input.packages) {
    const runtime = input.packages.added.filter((pkg) => pkg.kind === "run");
    if (runtime.length > 0) {
      needs.push({
        what: `A new library the product runs on was added: ${runtime.map((pkg) => pkg.name).join(", ")}.`,
        ask: "Do we want this dependency? It ships to every shop and is code nobody here wrote.",
      });
    }
    const dev = input.packages.added.filter((pkg) => pkg.kind === "dev");
    if (dev.length > 0)
      watch.push(
        `New development tools (not shipped to shops): ${dev.map((pkg) => pkg.name).join(", ")}.`,
      );
    const majors = input.packages.bumped.filter((pkg) => pkg.major && pkg.kind === "run");
    if (majors.length > 0) {
      needs.push({
        what: `A library the product runs on jumped a major version: ${majors.map((pkg) => `${pkg.name} ${pkg.from} to ${pkg.to}`).join(", ")}.`,
        ask: "Major versions change behavior. Is the thread's evidence that it still works enough?",
      });
    }
  }

  // Database.
  for (const migration of input.migrations ?? []) {
    if (migration.removes.length > 0) {
      needs.push({
        what: `A database change ${migration.removes.join(" and ")} (${path.posix.basename(path.posix.dirname(migration.path))}).`,
        ask: "Is it right to lose that data or structure? There are no users yet, so this may be fine.",
      });
    }
  }
  const newMigrations = (input.migrations ?? []).length;
  if (newMigrations > 0) watch.push(`${plural(newMigrations, "database migration")} added.`);

  // One shop reading another's rows.
  if (input.shopLosses?.length > 0) {
    needs.push({
      what: `Code that limits a query to one shop mentions the shop in fewer places: ${listFiles(input.shopLosses.map((loss) => loss.file))}.`,
      ask: "Does every read there still stay inside one shop? Ask the thread to show the test that proves it.",
    });
  }

  // The referee (the tests and rules that judge every change).
  if (input.referee) {
    for (const item of input.referee.needsEyes ?? []) needs.push(item);
    for (const line of input.referee.watch ?? []) watch.push(line);
    for (const line of input.referee.protects ?? []) protects.push(line);
  } else {
    gaps.push(
      "The referee guard (loosened tests, lowered floors, edited rules) did not report on this change.",
    );
  }

  // Breakage drills.
  const mutation = input.mutation;
  // The drills break only the files `scripts/mutation/scope.mjs` names (the folders of pure rules
  // and database functions). A money or safety file outside them, a route or a page, is never
  // broken on purpose, and the card says so rather than letting "fine" cover it.
  const drillable = logic.filter((change) => classifyScope(change.path));
  const moneyOrSafetyOutOfReach = touched
    .filter(({ area }) => area.id === "money" || area.id === "safety")
    .flatMap(({ hitLogic }) => hitLogic)
    .filter((change) => isLogicFile(change.path) && change.status !== "D")
    .filter((change) => !classifyScope(change.path))
    .map((change) => change.path);
  if (moneyOrSafetyOutOfReach.length > 0) {
    gaps.push(
      `The breakage drills do not reach ${listFiles([...new Set(moneyOrSafetyOutOfReach)])}: a route, page or component is never broken on purpose.`,
    );
  }
  if (!mutation) {
    if (drillable.length > 0) {
      gaps.push(
        "The breakage drills did not run, so nothing here shows the tests would notice a broken money or safety line.",
      );
    }
  } else if (mutation.notRun) {
    protects.push(`Breakage drills: ${mutation.notRun}`);
  } else {
    const { killed, survived, accepted, notTried } = mutation.totals;
    const policy = mutation.policy ?? {};
    protects.push(
      `Breakage drills: broke ${plural(mutation.tried, "changed line")} on purpose; the tests caught ${killed}` +
        `${survived > 0 ? `, missed ${survived}` : ""}${accepted > 0 ? `, ${accepted} waved through with a reason` : ""}.`,
    );
    if (mutation.capped || notTried > 0) {
      gaps.push(
        `Breakage drills tried ${mutation.tried} of ${mutation.eligible} possible breaks; the rest were not tried.`,
      );
    }
    for (const file of mutation.files ?? []) {
      for (const survivor of file.survivors ?? []) {
        const blocks = policy[file.class] !== "warn";
        needs.push({
          what: `${file.path}:${survivor.line}: I ${survivor.operator} (${survivor.was} to ${survivor.became}) and no test failed${blocks ? "; CI blocks this" : ""}.`,
          ask: "That line is not really protected. The thread should add a test that fails when it is wrong.",
        });
      }
      for (const accept of file.accepted ?? []) {
        watch.push(
          `${file.path}:${accept.line} excused from the breakage drills: ${accept.reason}.`,
        );
      }
    }
  }

  // Coverage floors are the referee's; a PR that changed none of the safety tests simply has no line.

  // Safety or money code changed with no tests at all.
  const weightyLogic = touched.filter(
    ({ area, hitLogic }) =>
      area.weighty && area.id !== "database" && hitLogic.some((change) => isLogicFile(change.path)),
  );
  if (weightyLogic.length > 0 && tests.length === 0) {
    needs.push({
      what: "Money, safety or privacy code changed and not one test file did.",
      ask: "Ask the thread which existing test would fail if this change were wrong.",
    });
  }

  // Deploy and CI.
  const deploy = touched.find(({ area }) => area.id === "deploy");
  if (deploy) {
    watch.push(
      `How the product is built or shipped changed (${listFiles(deploy.hitLogic.map((change) => change.path))}).`,
    );
  }

  const verdict = needs.length > 0 ? "eyes" : "ok";
  const lines = [MARKER, "## Risk card", ""];
  if (verdict === "ok") {
    lines.push(
      "**Fine to merge once the checks are green.** Nothing below needs a decision from you.",
      "",
    );
  } else {
    lines.push(
      `**Needs your eyes.** ${plural(needs.length, "thing")} for you to settle before merging:`,
      "",
    );
    for (const item of needs.slice(0, 12)) lines.push(`- ${item.what} *${item.ask}*`);
    if (needs.length > 12)
      lines.push(`- …and ${needs.length - 12} more; the full list is in the job summary.`);
    lines.push("");
  }

  lines.push("### What changed", "");
  if (touched.length === 0) {
    lines.push("Nothing in money, dive safety, privacy, offline roll call or the database.", "");
  } else {
    for (const { area, hitLogic, hitTests } of touched) {
      const code = hitLogic.length;
      const parts = [];
      if (code > 0) parts.push(plural(code, "file"));
      if (hitTests.length > 0) parts.push(`${plural(hitTests.length, "test file")}`);
      lines.push(`- **${area.label}** (${area.sentence}): ${parts.join(" and ")}.`);
    }
    lines.push("");
  }
  const total = live.reduce((sum, change) => sum + change.added + change.removed, 0);
  lines.push(
    `${plural(live.length, "file")} changed in all (${plural(logic.length, "behavior file")}, ${plural(tests.length, "test file")}), ${total} lines.`,
    "",
  );

  const before = excerpt(bodySection(input.body, "Before"));
  const after = excerpt(bodySection(input.body, "After"));
  if (before || after) {
    lines.push("### What the author says changed", "");
    if (before) lines.push(`- **Before:** ${before}`);
    if (after) lines.push(`- **After:** ${after}`);
    lines.push("", "*That is the author's account, not something CI checked.*", "");
  }

  if (protects.length > 0) {
    lines.push("### What protects it", "");
    for (const line of protects) lines.push(`- ${line}`);
    lines.push("");
  }

  if (watch.length > 0) {
    lines.push("### Worth a look", "");
    for (const line of watch.slice(0, 10)) lines.push(`- ${line}`);
    if (watch.length > 10) lines.push(`- …and ${watch.length - 10} more.`);
    lines.push("");
  }

  lines.push("### What this card cannot tell you", "");
  for (const line of gaps) lines.push(`- ${line}`);
  lines.push(
    "- It reads which files changed and what the other checks found. It does not know whether the new behavior is right: how it looks and feels is yours, through the screenshots.",
    `- What the guardrails never cover is in \`${GUARDRAILS_DOC}\`.`,
    "",
  );

  const markdown = `${lines.join("\n")}\n`;
  return {
    verdict,
    needs,
    watch,
    gaps,
    protects,
    areas: touched.map(({ area, hitLogic, hitTests }) => ({
      id: area.id,
      files: hitLogic.length,
      testFiles: hitTests.length,
    })),
    markdown,
  };
}

/** A short, plain file list: the first three names and a count of the rest. */
export function listFiles(files) {
  const names = files.map((file) => `\`${file}\``);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

// --- reading the repository ------------------------------------------------------------------

function git(args) {
  return String(
    readBounded("git", args, {
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
      maxBuffer: 256 * 1024 * 1024,
    }),
  );
}

function gitShow(rev, file) {
  try {
    return git(["show", `${rev}:${file}`]);
  } catch {
    return "";
  }
}

function readJson(file) {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Gather everything the card reads, for `base...head`. */
export function gather({ base, head, body, mutation, referee }) {
  const range = `${base}...${head}`;
  const status = parseNameStatus(git(["diff", "--name-status", "--no-renames", range]));
  const stats = new Map(
    parseNumstat(git(["diff", "--numstat", "--no-renames", range])).map((row) => [row.path, row]),
  );
  const changes = status.map(({ status: code, path: file }) => ({
    path: file,
    status: code,
    added: stats.get(file)?.added ?? 0,
    removed: stats.get(file)?.removed ?? 0,
  }));
  const fork = git(["merge-base", base, head]).trim();
  const packages = changes.some((change) => change.path === "package.json")
    ? packageChanges(gitShow(fork, "package.json"), gitShow(head, "package.json"))
    : null;
  const migrations = changes
    .filter(
      (change) => change.status === "A" && /^drizzle\/[^/]+\/migration\.sql$/.test(change.path),
    )
    .map((change) => ({
      path: change.path,
      removes: removingStatements(gitShow(head, change.path)),
    }));
  const patch = git(["diff", "-U0", "--no-renames", range, "--", "src"]);
  return {
    changes,
    body,
    packages,
    migrations,
    shopLosses: shopScopingLosses(patch),
    mutation: readJson(mutation),
    referee: readJson(referee),
  };
}

// --- posting ---------------------------------------------------------------------------------

async function post(markdown) {
  const { GH_TOKEN, GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER } = process.env;
  const token = GH_TOKEN || GITHUB_TOKEN;
  if (!token || !GITHUB_REPOSITORY || !PR_NUMBER) {
    console.warn("risk-card: no pull request to post to; printing instead.");
    return false;
  }
  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
  const base = `${api}/repos/${GITHUB_REPOSITORY}/issues`;
  const listed = await fetch(`${base}/${PR_NUMBER}/comments?per_page=100`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!listed.ok) throw new Error(`listing comments answered ${listed.status}`);
  const existing = (await listed.json()).find((comment) => String(comment.body).includes(MARKER));
  const url = existing ? `${base}/comments/${existing.id}` : `${base}/${PR_NUMBER}/comments`;
  const saved = await fetch(url, {
    method: existing ? "PATCH" : "POST",
    headers,
    body: JSON.stringify({ body: markdown }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!saved.ok) throw new Error(`saving the comment answered ${saved.status}`);
  return true;
}

function parseArgs(argv) {
  const args = { head: "HEAD", out: ".agent-out" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--post") args.post = true;
    else if (
      ["--base", "--head", "--body-file", "--mutation", "--referee", "--out"].includes(arg)
    ) {
      args[arg.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else console.warn(`risk-card: ignoring unknown argument ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.base) {
    console.error("risk-card: --base <ref> is required");
    return 0;
  }
  let card;
  try {
    const body =
      args.bodyFile && existsSync(args.bodyFile) ? readFileSync(args.bodyFile, "utf8") : "";
    card = buildRiskCard(
      gather({
        base: args.base,
        head: args.head,
        body,
        mutation: args.mutation,
        referee: args.referee,
      }),
    );
  } catch (error) {
    console.warn(
      `risk-card: could not build the card: ${error instanceof Error ? error.message : error}`,
    );
    return 0;
  }
  mkdirSync(args.out, { recursive: true });
  writeFileSync(path.join(args.out, "risk-card.md"), card.markdown);
  writeFileSync(
    path.join(args.out, "risk-card.json"),
    `${JSON.stringify({ ...card, markdown: undefined }, null, 2)}\n`,
  );
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, card.markdown);
  if (args.post) {
    try {
      if (await post(card.markdown)) return 0;
    } catch (error) {
      console.warn(
        `risk-card: could not post the comment: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  process.stdout.write(card.markdown);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
