#!/usr/bin/env node
// Breakage drills (ADR 20261122-diff-mutation-testing): break the lines a branch changed in
// money and dive-safety code, one small break at a time, and check that a test goes red for each.
// A break no test notices is a survivor: that line is not really protected.
//
//   node scripts/mutation/run.mjs --diff [<base>]        the changed lines since <base> (origin/main)
//   node scripts/mutation/run.mjs --file <path> [--write [--absorb "<why>"]]   one whole file, weekly
//
// Options: --out <json>, --summary <markdown file to append to>, --max-mutants <n>,
// --budget-minutes <n>, --parallel <n>. The JSON is always written (.agent-out/mutation-diff.json
// or .agent-out/mutation-file.json); its shape is the risk card's contract.
//
// Each mutant runs as its own Vitest process (vitest.mutation.config.ts) with the mutated text
// handed to Vite by scripts/mutation/vite-plugin.mjs, so no file on disk changes. Exit 1 when a
// survivor is in a class scripts/mutation/policy.json sets to "block", when the unmutated tests
// are red, or (file mode) when a score falls below its floor.

import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { runBoundedAsync, SUBPROCESS_TIMEOUTS } from "../subprocess.mjs";
import { changedLines, gitChangedFiles, gitDiff, gitHead } from "./diff.mjs";
import { applyMutant, chooseMutants, isSkippedFile, mutantsFor } from "./engine.mjs";
import { checkFloor, nextFloors, readFloors, score, writeFloors } from "./floors.mjs";
import { classifyScope, scopeFiles } from "./scope.mjs";
import { buildTestIndex } from "./select-tests.mjs";

const ROOT = path.join(import.meta.dirname, "..", "..");

export const MAX_MUTANTS = 150;
export const MAX_MUTANTS_FILE = 1500;
export const BUDGET_MS = 20 * 60_000;
export const BUDGET_MS_FILE = 40 * 60_000;
export const NOTHING_CHANGED = "No money or safety line changed.";

const INSTRUCTION =
  "Add a test that fails when this line is wrong, or, if the change cannot alter behavior, add `// mutation-ok: <why>`";

export function readPolicy(root) {
  const policy = JSON.parse(readFileSync(path.join(root, "scripts/mutation/policy.json"), "utf8"));
  for (const cls of ["money", "safety"]) {
    if (!["block", "warn"].includes(policy[cls]))
      throw new Error(`scripts/mutation/policy.json: "${cls}" must be "block" or "warn".`);
  }
  return { money: policy.money, safety: policy.safety };
}

/** One Vitest process over `testFiles`; `{ status, log }`. */
async function vitest(root, workDir, name, testFiles, { env = {}, timeoutMs, workers }) {
  const logPath = path.join(workDir, `${name}.log`);
  const fd = openSync(logPath, "w");
  let result;
  try {
    result = await runBoundedAsync(
      process.execPath,
      [
        path.join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "vitest.mutation.config.ts",
        `--maxWorkers=${workers}`,
        ...testFiles,
      ],
      {
        cwd: root,
        timeoutMs,
        stdio: ["ignore", fd, fd],
        env: {
          // A run started from inside a Vitest worker (run.test.mjs) must not inherit its markers.
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
          ),
          // Annotations for every caught break would flood a pull request's checks.
          GITHUB_ACTIONS: "",
          VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
          ...env,
        },
      },
    );
  } finally {
    closeSync(fd);
  }
  const log = readFileSync(logPath, "utf8");
  rmSync(logPath, { force: true });
  return { status: result.status, timedOut: result.error === "ETIMEDOUT", log };
}

/** The first test file a red Vitest run names. */
export function firstFailingFile(log) {
  const match = /FAIL\s+(?:\|[^|\n]+\|\s+)?(\S+)/.exec(log);
  return match ? match[1] : null;
}

/** A mutant the transform step refused: neither caught nor a survivor. */
function transformFailed(log) {
  return /Transform failed|\[PARSE_ERROR\]|vite:oxc\]/.test(log);
}

async function pool(items, size, work, { deadline }) {
  let next = 0;
  let stopped = false;
  const runners = Array.from({ length: Math.max(1, size) }, async () => {
    while (next < items.length) {
      if (Date.now() > deadline) {
        stopped = true;
        return;
      }
      const index = next;
      next += 1;
      await work(items[index], index);
    }
  });
  await Promise.all(runners);
  return { stopped };
}

/**
 * What to drill: `[{ file, class, lines|null, changedLines }]` for diff mode (the changed lines
 * of the in-scope files) or file mode (each named file whole).
 */
export function planTargets(root, { mode, base, files }) {
  if (mode === "file") {
    return files.map((file) => ({
      file,
      class: classifyScope(file),
      lines: null,
      changedLines: readFileSync(path.join(root, file), "utf8").split("\n").length,
    }));
  }
  const inScope = scopeFiles(gitChangedFiles(root, base));
  const changed = changedLines(gitDiff(root, base, inScope));
  return [...changed.entries()]
    .filter(([file]) => classifyScope(file) !== null)
    .map(([file, lines]) => ({ file, class: classifyScope(file), lines, changedLines: lines.size }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function emptyReport({ mode, base, head, policy }) {
  return {
    schema: 1,
    mode,
    base,
    head,
    policy,
    notRun: null,
    capped: false,
    timeBoxed: false,
    eligible: 0,
    tried: 0,
    totals: { killed: 0, survived: 0, uncompilable: 0, accepted: 0, notTried: 0 },
    files: [],
  };
}

/**
 * Runs the drills and returns `{ report, outcomes }`: `report` is the JSON the card reads,
 * `outcomes` every mutant that ran with its result (`killed`, `survived`, `uncompilable`).
 */
export async function runDrills({
  root = ROOT,
  mode,
  base = null,
  files = [],
  targets,
  head = gitHead(root) ?? "unknown",
  maxMutants = mode === "file" ? MAX_MUTANTS_FILE : MAX_MUTANTS,
  budgetMs = mode === "file" ? BUDGET_MS_FILE : BUDGET_MS,
  parallel = Math.min(4, availableParallelism()),
  policy = readPolicy(root),
  log = () => {},
}) {
  const started = Date.now();
  const deadline = started + budgetMs;
  const report = emptyReport({ mode, base, head, policy });
  const plan = (targets ?? planTargets(root, { mode, base, files })).filter((target) => {
    const source = readFileSync(path.join(root, target.file), "utf8");
    return !isSkippedFile(target.file, source);
  });
  if (plan.length === 0) {
    report.notRun = NOTHING_CHANGED;
    return { report, outcomes: [] };
  }

  const select = buildTestIndex(root);
  const sources = new Map();
  const byFile = new Map();
  const entries = new Map();
  for (const target of plan) {
    const source = readFileSync(path.join(root, target.file), "utf8");
    sources.set(target.file, source);
    const found = mutantsFor(target.file, source, { lines: target.lines ?? undefined });
    if (found.refused.length > 0) {
      const at = found.refused.map((entry) => `${target.file}:${entry.line}`).join(", ");
      report.notRun = `A bare \`// mutation-ok\` at ${at}: give the reason, at least 8 characters, after a colon.`;
      return { report, outcomes: [] };
    }
    const selected = select(target.file);
    const entry = {
      path: target.file,
      class: target.class,
      changedLines: target.changedLines,
      testFiles: selected.files,
      killed: 0,
      survivors: [],
      accepted: found.accepted,
      uncompilable: found.unparsable,
    };
    entries.set(target.file, { entry, selected });
    byFile.set(target.file, found.mutants);
    report.totals.uncompilable += found.unparsable;
    report.totals.accepted += found.accepted.length;
  }

  const all = [...byFile.values()].flat();
  report.eligible = all.length;
  const chosen = chooseMutants(byFile, maxMutants, head);
  report.capped = chosen.length < all.length;
  report.files = [...entries.values()].map(({ entry }) => entry);
  if (all.length === 0 && report.totals.accepted === 0) {
    report.notRun = NOTHING_CHANGED;
    return { report, outcomes: [] };
  }

  const workDir = path.join(root, ".agent-out", "mutation", `run-${process.pid}-${started}`);
  mkdirSync(workDir, { recursive: true });
  const workers = Math.max(1, Math.floor(availableParallelism() / Math.max(1, parallel)));
  const outcomes = [];
  try {
    // Every baseline before any mutant: a red baseline claims no result at all.
    for (const { entry, selected } of entries.values()) {
      if (selected.files.length === 0 || !byFile.get(entry.path).some((m) => chosen.includes(m)))
        continue;
      log(`baseline: ${entry.path} (${selected.files.length} test files)`);
      const run = await vitest(root, workDir, "baseline", selected.files, {
        timeoutMs: SUBPROCESS_TIMEOUTS.mutationBaseline,
        workers: availableParallelism(),
      });
      if (run.status !== 0) {
        report.notRun = `baseline red: ${firstFailingFile(run.log) ?? entry.path}`;
        report.files = [];
        report.eligible = 0;
        report.capped = false;
        report.totals = { killed: 0, survived: 0, uncompilable: 0, accepted: 0, notTried: 0 };
        log(run.log.split("\n").slice(-30).join("\n"));
        return { report, outcomes: [] };
      }
    }

    const { stopped } = await pool(
      chosen,
      parallel,
      async (mutant, index) => {
        const { entry, selected } = entries.get(mutant.file);
        let outcome;
        if (selected.files.length === 0) {
          outcome = "survived";
        } else {
          const ext = path.extname(mutant.file);
          const sourcePath = path.join(workDir, `mutant-${index}${ext}`);
          writeFileSync(sourcePath, applyMutant(sources.get(mutant.file), mutant));
          const env = {
            DIVEDAY_MUTANT_FILE: path.join(root, mutant.file),
            DIVEDAY_MUTANT_SOURCE: sourcePath,
          };
          // Cheapest and likeliest first; the first red tier ends the mutant.
          const rest = selected.files.filter(
            (file) => !selected.db.includes(file) && !selected.near.includes(file),
          );
          const tiers = [
            [selected.near, SUBPROCESS_TIMEOUTS.mutantRun],
            [rest, SUBPROCESS_TIMEOUTS.mutantRun],
            [selected.db, SUBPROCESS_TIMEOUTS.mutantRunDb],
          ].filter(([tier]) => tier.length > 0);
          outcome = "survived";
          for (const [tier, timeoutMs] of tiers) {
            const run = await vitest(root, workDir, `mutant-${index}`, tier, {
              env,
              timeoutMs,
              workers,
            });
            if (run.status === 0) continue;
            outcome = !run.timedOut && transformFailed(run.log) ? "uncompilable" : "killed";
            break;
          }
          rmSync(sourcePath, { force: true });
        }
        outcomes.push({ ...mutant, outcome });
        report.tried += 1;
        if (outcome === "killed") {
          entry.killed += 1;
          report.totals.killed += 1;
        } else if (outcome === "uncompilable") {
          entry.uncompilable += 1;
          report.totals.uncompilable += 1;
        } else {
          entry.survivors.push({
            line: mutant.line,
            column: mutant.column,
            operator: mutant.operator,
            was: mutant.was,
            became: mutant.became,
            snippet: mutant.snippet,
            ...(selected.files.length === 0 ? { reason: "no test imports this file" } : {}),
          });
          report.totals.survived += 1;
        }
        log(
          `${outcome.padEnd(12)} ${mutant.file}:${mutant.line}  ${mutant.operator}: ${mutant.was} -> ${mutant.became}`,
        );
      },
      { deadline },
    );
    report.timeBoxed = stopped;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  report.totals.notTried = report.eligible - report.tried;
  for (const entry of report.files) {
    entry.survivors.sort((a, b) => a.line - b.line || a.column - b.column);
    if (mode === "file") entry.score = score(entry.killed, entry.survivors.length);
  }
  return { report, outcomes };
}

/** The plain-words lines a person reads, and whether the run blocks. */
export function describe(report) {
  const lines = [];
  if (report.notRun) {
    lines.push(`Breakage drills: ${report.notRun}`);
    return { lines, blocking: /^baseline red|bare `\/\/ mutation-ok`/.test(report.notRun) };
  }
  const t = report.totals;
  lines.push(
    `Breakage drills: tried ${report.tried} of ${report.eligible} breaks; tests caught ${t.killed}, missed ${t.survived}.` +
      (t.accepted ? ` ${t.accepted} line(s) marked mutation-ok.` : "") +
      (report.capped ? " Capped: the rest were not tried." : "") +
      (report.timeBoxed ? " Out of time: the rest were not tried." : ""),
  );
  let blocking = false;
  for (const file of report.files) {
    const protectedNote =
      file.survivors.length === 0
        ? "every drilled line is protected"
        : `${file.survivors.length} break(s) no test noticed`;
    const scoreNote =
      file.score === undefined || file.score === null ? "" : `, score ${file.score}%`;
    lines.push(
      `${file.path} (${file.class ?? "unclassified"}): ${file.killed} caught, ${protectedNote}${scoreNote}`,
    );
    for (const s of file.survivors) {
      lines.push(`${file.path}:${s.line}  ${s.operator}: ${s.was} -> ${s.became}  | ${s.snippet}`);
      lines.push(`  ${s.reason ? `${s.reason}. ` : ""}${INSTRUCTION}`);
    }
    for (const a of file.accepted) lines.push(`${file.path}:${a.line}  accepted: ${a.reason}`);
    if (
      report.mode === "diff" &&
      file.survivors.length > 0 &&
      report.policy[file.class] === "block"
    )
      blocking = true;
  }
  return { lines, blocking };
}

function parseArgs(argv) {
  const args = { files: [], write: false, absorb: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return undefined;
      i += 1;
      return next;
    };
    if (flag === "--diff") {
      args.mode = "diff";
      args.base = value() ?? "origin/main";
    } else if (flag === "--file") {
      args.mode = "file";
      const file = value();
      if (!file) throw new Error("--file needs a repository path");
      args.files.push(file);
    } else if (flag === "--out") args.out = value();
    else if (flag === "--summary") args.summary = value();
    else if (flag === "--max-mutants") args.maxMutants = Number(value());
    else if (flag === "--budget-minutes") args.budgetMs = Number(value()) * 60_000;
    else if (flag === "--parallel") args.parallel = Number(value());
    else if (flag === "--write") args.write = true;
    else if (flag === "--absorb") args.absorb = value() ?? "";
    else throw new Error(`unknown argument ${flag}`);
  }
  if (!args.mode) throw new Error("pass --diff [<base>] or --file <path>");
  return args;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`mutation: ${error.message}`);
    return 1;
  }
  const out =
    args.out ??
    path.join(
      ROOT,
      ".agent-out",
      args.mode === "diff" ? "mutation-diff.json" : "mutation-file.json",
    );
  const { report } = await runDrills({
    root: ROOT,
    mode: args.mode,
    base: args.base ?? null,
    files: args.files,
    ...(args.maxMutants ? { maxMutants: args.maxMutants } : {}),
    ...(args.budgetMs ? { budgetMs: args.budgetMs } : {}),
    ...(args.parallel ? { parallel: args.parallel } : {}),
    log: (line) => console.log(line),
  });
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  const { lines, blocking } = describe(report);
  let failed = blocking;
  if (report.mode === "file" && !report.notRun) {
    const floors = readFloors(ROOT);
    for (const file of report.files) {
      if (args.write) {
        if (args.absorb === "") {
          lines.push('--absorb needs a reason: --absorb "<why>".');
          failed = true;
          continue;
        }
        const next = nextFloors(readFloors(ROOT), file.path, file.score, args.absorb);
        if (next.refused) {
          lines.push(`Refusing a lower floor without --absorb "<why>": ${next.refused}`);
          failed = true;
        } else {
          writeFloors(ROOT, next.floors);
          lines.push(`${file.path}: floor set to ${file.score}%.`);
        }
      } else {
        const check = checkFloor(floors, file.path, file.score);
        lines.push(check.message);
        if (!check.ok) failed = true;
      }
    }
  }
  console.log("");
  for (const line of lines) console.log(line);
  console.log(`Result: ${path.relative(ROOT, out)}`);
  if (args.summary)
    appendFileSync(args.summary, `### Breakage drills\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
  if (blocking)
    console.log(
      "A survivor in a class scripts/mutation/policy.json sets to block fails this run. See docs/engineering/testing.md#breakage-drills.",
    );
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
