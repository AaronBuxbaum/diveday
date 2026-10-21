#!/usr/bin/env node

// `pnpm verify:push`: everything a push must survive that this container can answer, run once,
// and a stamp saying HEAD passed it. `scripts/guard-push.mjs` refuses a `git push` without one.
//
// Of the 90 CI jobs that failed on the open stack between 2026-10-09 and 2026-10-12, almost
// none were flakes or infrastructure. They were (docs/agents/verifying.md#the-pre-push-gate):
//
//   - Playwright specs the change broke and nobody ran (47 jobs): the verify skill said "a flow
//     changed: run one spec", and the author cannot know which spec quotes the sentence they
//     deleted. `e2e-affected.mjs` names them.
//   - unit tests that read the source from disk (23 jobs): `form.test.tsx`, `button.test.ts`,
//     `EntryShell.test.tsx`, the erasure and rehearsal coverage scans. They import nothing they
//     check, so `vitest --changed` never selects them. The whole unit suite runs here now.
//   - the `guards` Vitest project (CI's Repository safeguards job), which no local step ran.
//   - typecheck after a merge from the layer below, which nobody re-ran because the layer's
//     own checks had already passed. The stamp is per commit, so a merge is a new HEAD.
//
// Steps, cheapest first; it stops at the first red one, because a later step on a broken tree
// spends minutes saying the same thing:
//
//   base CI → regen → lint → typecheck → check:repo → guards → unit tests 1/4 … 4/4
//         → e2e build → affected Playwright specs → stamp
//
// Every unit test and every affected spec runs, with no time budget (Aaron, 2026-10-15: "run
// everything"), and the output and the stamp end with what was not run here (`notRunHere`), so a
// green gate is never mistaken for a green suite.
//
//   pnpm verify:push                      run it
//   pnpm verify:push --plan               print the base, the steps and the selected specs, run nothing
//   pnpm verify:push --base-red <file…>   also run these, when the base is red on a job that names none
//   pnpm verify:push --quick              static checks and selected units; browser replay only
//                                         for named failures on the base
//
// `--quick` is the default way to push (Aaron, 2026-10-16: "stop the pattern of waiting for the
// full validations on these, just batch up work into single large PRs and stack them, adapting
// when CI fails"). The full run took most of an hour on a four-core cloud container and held the
// stack queue. The quick run keeps the cheap steps that caught most of the 2026-10-12 red jobs
// (typecheck after a merge, the guards, check:repo) and leaves the browser to CI, which a layer
// then fixes forward. Its stamp says `"mode": "quick"` and names what it left to CI; the guard
// accepts either stamp and still refuses a commit with none.
//
// "Base CI" reads the layer below's latest CI (`scripts/base-ci.mjs`): a push on a red base is a
// red run for this layer and every layer above, so the base's failing specs run here too (its
// unit files are in the full suite), and the stamp means this layer carries their fix.
//
// The diff is measured against the layer below (`stackBase`), not `origin/main`: on a fifteen-
// layer stack every route would count as reached. Each step's output goes to a log under the git dir; a red
// step prints only its tail.

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readState } from "./agent-task-state.mjs";
import { baseDecision, baseRedArgs, readBaseVerdict, repoSlug } from "./base-ci.mjs";
import {
  affectedSpecs,
  captureGrep,
  captureMs,
  changedDiff,
  durations,
  estimateMs,
  withinBudget,
} from "./e2e-affected.mjs";
import { requireFreshBuild } from "./e2e-build-evidence.mjs";
import { verifiedFile } from "./guard-push.mjs";
import { gitReader } from "./stack-map.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { appendMetric } from "./task-metrics.mjs";
import { sourceReaders, testArgs, testPlan } from "./test-affected.mjs";
import { readPullRequestBase, resolveVerificationBase } from "./verification-base.mjs";
import {
  collectStages,
  installationIdentity,
  lintToolIdentity,
  runStageAsync,
  stageKey,
  verificationInputsStable,
} from "./verification-stages.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Specs per Playwright step: about twenty local minutes at two workers. */
export const E2E_CHUNK = 25;

/**
 * Cores one Playwright worker needs locally: its own Next server, its Chromium and its runner.
 * Measured 2026-10-15 on an idle four-core cloud container: two workers timed out on specs CI
 * passes (readiness.spec.ts:131, diver-merge.spec.ts:42, at CI's 15-second ceiling), one worker
 * passed them (readiness alone in 14.9s). The container's older fallback Chromium was ruled out
 * the same day: a Playwright pinned to that same browser failed identically.
 */
export const CORES_PER_E2E_WORKER = 3;

/**
 * As many Playwright workers as the box has free compute for, and no more (Aaron, 2026-10-15:
 * "We shouldn't run more than we have compute for, but we also shouldn't be single-threading
 * the problem"): free cores (cores minus the one-minute load, so another thread's gate counts)
 * over CORES_PER_E2E_WORKER, at least one, at most CI's own cores/2. Read just before each step,
 * so the count follows the load. An `E2E_WORKERS` the operator set wins.
 */
export function e2eWorkers({ cores, load, override } = {}) {
  const set = Number(override);
  if (Number.isFinite(set) && set > 0) {
    return { workers: Math.floor(set), formula: `E2E_WORKERS=${override} set by the operator` };
  }
  const free = Math.max(0, cores - load);
  const workers = Math.max(
    1,
    Math.min(Math.floor(free / CORES_PER_E2E_WORKER), Math.floor(cores / 2)),
  );
  return {
    workers,
    formula:
      `max(1, min(floor((${cores} cores - ${load.toFixed(1)} load) / ` +
      `${CORES_PER_E2E_WORKER}), ${cores}/2))`,
  };
}

/** e2eWorkers for this box, now. */
function e2eWorkersHere() {
  return e2eWorkers({
    cores: availableParallelism(),
    load: loadavg()[0],
    override: process.env.E2E_WORKERS,
  });
}

/** The line e2e/browser.ts prints when the pinned Chromium is missing. */
const BROWSER_FALLBACK = /^e2e: the Chromium pinned by @playwright\/test is not installed.*$/m;

/** A unit, script or guard test: no page imports one, so no browser spec can move with it. */
const UNIT_TEST = /\.test\.(?:ts|tsx|mts|mjs|js)$/;

/** Paths the e2e build never reads: a change to only these reuses the build already made. */
const NOT_BUILT = /(?:^|\/)[^/]+\.test\.(?:ts|tsx|mts|mjs|js)$|^e2e\/|^docs\/|\.md$|^\.claude\//;

/** A diff of only these changes no code: CI skips the unit and browser jobs for it too. */
const DOCS_ONLY = /^(?:docs\/|\.claude\/|[^/]+\.md$)|\.md$/;

/** Whether every changed file is one CI skips the unit and browser jobs for. */
export function docsOnlyDiff(changed) {
  return changed.length > 0 && changed.every((file) => DOCS_ONLY.test(file));
}

/** Files whose change can move the export-bundle snapshot; then `regen` reruns it. */
const SNAPSHOT_INPUTS = /^src\/db\/(?:schema\/|seed|export)/;

/** Name of the stamp file inside the git dir (`git rev-parse --git-path`). */
export const STAMP = "diveday-verified.json";

/** CI's unit shards; each runs here as its own step, so a red one names itself. */
export const UNIT_SHARDS = 4;

/** The static steps every run starts with, cheapest first. */
function staticSteps(changed) {
  const snapshot = changed.some((file) => SNAPSHOT_INPUTS.test(file));
  return [
    {
      name: "regen",
      command: "pnpm",
      args: ["regen", ...(snapshot ? [] : ["--no-snapshot"])],
      thenClean: true,
    },
    { name: "lint", command: "pnpm", args: ["lint"] },
    { name: "typecheck", command: "pnpm", args: ["typecheck"] },
    { name: "check:repo", command: "node", args: ["scripts/check-repo.mjs"] },
    {
      name: "guards",
      command: "pnpm",
      args: ["exec", "vitest", "run", "--project", "guards", "--reporter=dot"],
    },
  ];
}

/**
 * `--quick`: static checks plus native dependency/source-reader selection, direct
 * changed leaf tests, or a full fallback for global/unknown/deleted inputs.
 */
export function quickPlan({ changed, selection, specs = [] }) {
  const steps = staticSteps(changed);
  const selected = selection ?? testPlan({ changed, readers: [] });
  if (selected.mode === "all" || selected.files.length > 0)
    steps.push({ name: "related unit tests", command: "pnpm", args: testArgs(selected) });
  steps.push(...browserSteps({ specs }));
  return steps;
}

/** A named base failure must run or stop the gate; deletion is not verification. */
export function baseReplayFiles({ files, existing }) {
  const missing = files.filter((file) => !existing(file));
  if (missing.length > 0)
    throw new Error(
      `named base test files are missing; cannot verify their failures: ${missing.join(" ")}`,
    );
  return [...new Set(files)];
}

/** Coverage in a stamp follows the actual browser plan in either verification mode. */
export function stampCoverage({ specs, verdict, decision }) {
  return {
    specs,
    baseCi: verdict.unknown
      ? { unknown: verdict.unknown }
      : {
          red: verdict.red,
          ran: [...decision.files, ...decision.specs.filter((spec) => specs.includes(spec))],
        },
  };
}

/**
 * The steps for a diff. `changed` is the file list against the base, `specs` the Playwright
 * files to run, `captures` the titles of the visual captures to run (light mode only, after
 * the functional specs).
 */
export function plan({ changed, specs, captures = [] }) {
  const steps = staticSteps(changed);
  if (docsOnlyDiff(changed)) return steps;
  // The whole unit suite, sharded exactly as CI's four jobs are (Aaron, 2026-10-15: "run
  // everything"). It replaced the source scans plus `vitest related`, which left every test that
  // neither read source nor imported the diff to CI. The base's red files are in it too.
  for (let shard = 1; shard <= UNIT_SHARDS; shard++) {
    steps.push({
      name: `unit tests ${shard}/${UNIT_SHARDS}`,
      command: "pnpm",
      args: [
        "exec",
        "vitest",
        "run",
        "--project",
        "!guards",
        "--reporter=dot",
        `--shard=${shard}/${UNIT_SHARDS}`,
      ],
    });
  }
  steps.push(...browserSteps({ specs, captures }));
  return steps;
}

/** Shared build reuse, chunk bounds and worker policy for both verification modes. */
function browserSteps({ specs, captures = [] }) {
  const steps = [];
  if (specs.length > 0 || captures.length > 0) {
    steps.push({ name: "e2e build", command: "pnpm", args: ["e2e:build"], build: true });
    // Chunked so a hub-route change, which selects most of the suite, stays inside each step's
    // hour (SUBPROCESS_TIMEOUTS.verifyPushStep) and prints progress between chunks.
    const chunks = [];
    for (let at = 0; at < specs.length; at += E2E_CHUNK)
      chunks.push(specs.slice(at, at + E2E_CHUNK));
    chunks.forEach((chunk, i) => {
      steps.push({
        name: chunks.length === 1 ? "e2e specs" : `e2e specs ${i + 1}/${chunks.length}`,
        command: "pnpm",
        args: ["e2e:run", ...chunk, "--reporter=line"],
        workers: true,
      });
    });
    const grep = captureGrep(captures);
    if (grep) {
      steps.push({
        name: "visual captures",
        command: "pnpm",
        args: ["e2e:run", "e2e/visual", "-g", grep, "--reporter=line"],
        workers: true,
      });
    }
  }
  return steps;
}

/**
 * The Playwright specs to run: every one the diff names, then every one it only reaches,
 * narrowest route first. There is no time budget: a spec left to CI was a red CI run nobody saw
 * coming (#2619, 2026-10-15: 30 of 129 affected specs left to CI, and one of them went red). A
 * diff of only unit tests (and docs) runs none, so it never pays for an e2e build: nothing a page
 * imports changed.
 */
export function browserSpecs({ changed, strong, reach, rank, record }) {
  const testsOnly =
    changed.length > 0 &&
    changed.every((file) => UNIT_TEST.test(file) || DOCS_ONLY.test(file)) &&
    changed.some((file) => UNIT_TEST.test(file));
  if (testsOnly) return { specs: [], reached: [], testsOnly };
  const named = [...strong.keys()].sort();
  const { run } = withinBudget(reach, rank, record, Number.POSITIVE_INFINITY);
  return { specs: [...named, ...run], reached: run, testsOnly };
}

/**
 * What this run did not run, said plainly in the output and the stamp, so "verify:push is
 * green" is never read as "every test passed here". CI runs all of it.
 */
export function notRunHere({ docsOnly, testsOnly, specs, allSpecs, captures = [], quick = false }) {
  if (quick) {
    const ran = new Set(specs.map((spec) => spec.replace(/:\d+$/, "")));
    const skipped = allSpecs.filter(
      (spec) => !/(?:^|\/)visual[^/]*\.spec\.ts$/.test(spec) && !ran.has(spec),
    );
    return [
      "unit tests outside native dependency selection and conservative source-reader contracts (quick run)",
      ...(skipped.length > 0
        ? [`${ran.size === 0 ? "all " : ""}${skipped.length} Playwright specs (quick run)`]
        : []),
      "visual captures (reg-suit): CI only, and a difference never fails the build",
    ];
  }
  const lines = [];
  const visual = (spec) => /(?:^|\/)visual[^/]*\.spec\.ts$/.test(spec);
  // A smoke pick is `file:line`; its file counts as run, though only that test of it ran.
  const ran = new Set(specs.map((spec) => spec.replace(/:\d+$/, "")));
  const skipped = allSpecs.filter((spec) => !visual(spec) && !ran.has(spec));
  if (skipped.length > 0) {
    lines.push(
      testsOnly || docsOnly
        ? `all ${skipped.length} Playwright specs (no page code changed)`
        : `${skipped.length} Playwright specs the diff neither names nor reaches`,
    );
  }
  lines.push(
    captures.length > 0
      ? `visual captures (reg-suit): the ${captures.length} the diff names ran here in light mode; the rest, dark mode and the comparison are CI's, and a difference never fails the build`
      : "visual captures (reg-suit): CI only, and a difference never fails the build",
  );
  return lines;
}

/**
 * The build's key: every path the e2e build reads, with its blob, from `git ls-tree -r HEAD`.
 * Keyed on the tree minus tests, specs and docs rather than on the whole tree, so a commit that
 * only fixes a spec or a unit test reuses the build it already has instead of spending two more
 * minutes making the same one.
 */
export function appTreeKey(lsTree) {
  const built = lsTree
    .split("\n")
    .filter((line) => line && !NOT_BUILT.test(line.slice(line.indexOf("\t") + 1)));
  return createHash("sha256").update(built.join("\n")).digest("hex");
}

/**
 * Writes the stamp twice: the per-worktree file older guards read, and `<git common dir>/
 * diveday-verified/<sha>`, which every worktree of the clone shares, so a push from any worktree
 * (or from the shared checkout naming one) finds it (`scripts/guard-push.mjs`).
 */
export function writeStamps(
  stamp,
  {
    git = gitReader(ROOT),
    write = writeFileSync,
    mkdir = (dir) => mkdirSync(dir, { recursive: true }),
  } = {},
) {
  const text = `${JSON.stringify(stamp, null, 2)}\n`;
  const own = gitPath(git, STAMP);
  if (own) write(own, text);
  const shared = verifiedFile(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    stamp.sha,
  );
  if (shared) {
    mkdir(path.dirname(shared));
    write(shared, text);
  }
}

function gitPath(git, name) {
  const relative = git(["rev-parse", "--git-path", name]);
  return relative ? path.resolve(ROOT, relative) : null;
}

/** Lines that name a failure in vitest, Playwright, tsc, Biome or `check:repo` output. */
const FAILURE_LINE = /FAILED|\bFAIL\b|✗|×|error TS\d|^\s+\d+\) \[|Error:/;

/**
 * What a red step printed that a reader needs: the first failure and the lines after it, then
 * the tail, where every runner here puts its summary. A long log's first failure is often above
 * its last sixty lines (`check:repo` lists every guard's result after it).
 */
export function excerpt(text, lines = 40) {
  const all = text.split("\n");
  const first = all.findIndex((line) => FAILURE_LINE.test(line));
  const tailStart = Math.max(0, all.length - lines);
  if (first === -1 || first >= tailStart) return all.slice(tailStart).join("\n");
  return [...all.slice(first, first + 20), "…", ...all.slice(tailStart)].join("\n");
}

function tail(file) {
  try {
    return excerpt(readFileSync(file, "utf8"));
  } catch {
    return "";
  }
}

/**
 * Runs one step in a process group of its own and kills the whole group when it returns.
 * `runBounded` kills only the child it spawned at the ceiling, so an `e2e:run` that hit it left
 * Playwright and both e2e servers running (issue #2623: about 70 minutes on 2026-10-15, holding
 * the checkout's ports so the next run in it timed out across dozens of specs). After a clean
 * exit the group is already empty and the kill finds nothing.
 */
export function runStep(command, args, { run = runBounded, kill = process.kill, ...options }) {
  const result = run(command, args, { ...options, detached: true });
  if (result.pid) {
    try {
      kill(-result.pid, "SIGKILL");
    } catch {}
  }
  return result;
}

/** Every Playwright spec in the repository, as `e2e/<name>.spec.ts`. */
function allSpecFiles() {
  return readdirSync(path.join(ROOT, "e2e"), { recursive: true })
    .map((file) => `e2e/${String(file).split(path.sep).join("/")}`)
    .filter((file) => file.endsWith(".spec.ts"))
    .sort();
}

/** The {@link appTreeKey} a build was made from, so a commit that changes none of it reuses it. */

function buildTreeFile() {
  return path.join(ROOT, ".next", "diveday-build-tree");
}

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes("--quick");
  const git = gitReader(ROOT);
  const head = git(["rev-parse", "HEAD"]);
  // Falls back to the whole tree when git cannot list it, which only ever costs a rebuild.
  const listed = git(["ls-tree", "-r", "HEAD"]);
  const tree = listed ? appTreeKey(listed) : git(["rev-parse", "HEAD^{tree}"]);
  if (!head) {
    console.error("verify:push: git could not read HEAD.");
    process.exit(1);
  }
  const dirty = git(["status", "--porcelain", "--untracked-files=normal"]);
  if (dirty && !args.includes("--plan")) {
    console.error(
      "verify:push: the working tree has uncommitted changes. The stamp vouches for a commit, so commit first:\n" +
        dirty,
    );
    process.exit(1);
  }

  const resolvedBase = resolveVerificationBase(git, {
    prBase: readPullRequestBase(git),
    explicitBase: args.includes("--base") ? args[args.indexOf("--base") + 1] : undefined,
  });
  const base = resolvedBase.ref;
  if (resolvedBase.warning) console.log(resolvedBase.warning);
  const selection = quick
    ? changedDiff({ root: ROOT, base, git })
    : affectedSpecs({ root: ROOT, base, git });
  if (!selection) {
    console.error("verify:push: could not diff against a base (is origin/main fetched?).");
    process.exit(1);
  }
  const record = durations(ROOT);
  const {
    specs,
    reached: reachRun,
    testsOnly,
  } = browserSpecs({
    changed: selection.changed,
    strong: selection.strong ?? new Map(),
    reach: selection.reach ?? new Map(),
    rank: selection.rank ?? new Map(),
    record,
  });
  const strong = specs.filter((spec) => !reachRun.includes(spec));
  const docsOnly = docsOnlyDiff(selection.changed);
  const verdict = readBaseVerdict(git(["rev-parse", selection.base]), {
    repo: repoSlug(git(["remote", "get-url", "origin"])) ?? process.env.GITHUB_REPOSITORY ?? null,
  });
  const decision = baseDecision(verdict, { base: selection.base, extra: baseRedArgs(args) });
  for (const line of decision.lines) console.log(line);
  if (decision.refuse && !docsOnly) {
    console.error(`verify:push: ${decision.refuse}`);
    if (!args.includes("--plan")) process.exit(1);
  }
  const existing = (file) => existsSync(path.join(ROOT, file));
  let baseSpecs;
  try {
    baseReplayFiles({ files: [...decision.files, ...decision.specs], existing });
    baseSpecs = docsOnly ? [] : [...new Set(decision.specs)];
  } catch (error) {
    console.error(`verify:push: ${error.message}`);
    process.exit(1);
  }
  if (quick) specs.splice(0, specs.length, ...baseSpecs);
  else specs.push(...baseSpecs.filter((spec) => !specs.includes(spec)));
  const captures = quick || docsOnly || testsOnly ? [] : [...selection.captures.keys()].sort();
  const unitSelection = quick
    ? testPlan({
        changed: selection.changed,
        readers: sourceReaders(ROOT),
        extra: decision.files.filter(existing),
      })
    : null;
  const steps = quick
    ? quickPlan({ changed: selection.changed, selection: unitSelection, specs })
    : plan({ changed: selection.changed, specs, captures });

  if (quick) {
    for (const reason of unitSelection.reasons) console.log(`  unit selection: ${reason}`);
    console.log(
      `verify:push --quick: ${selection.changed.length} file(s) against ${selection.base}; ` +
        "static checks and the unit tests they reach. CI runs the rest; fix forward if it goes red.",
    );
    if (baseSpecs.length > 0)
      console.log(`  replaying red browser specs on the base: ${baseSpecs.join(" ")}`);
  } else {
    console.log(
      `verify:push: ${selection.changed.length} file(s) against ${selection.base}; ` +
        `${strong.length} spec(s) the diff names, ${reachRun.length} it reaches, all run here ` +
        `(about ${Math.round(estimateMs(specs, record) / 60000)} CI-minutes of browser tests).`,
    );
    for (const spec of strong) {
      console.log(`  ${spec}  — ${[...selection.strong.get(spec)].slice(0, 2).join("; ")}`);
    }
    if (reachRun.length > 0) console.log(`  reached: ${reachRun.join(" ")}`);
    if (captures.length > 0) {
      console.log(
        `  ${captures.length} visual capture(s) the diff names, light mode only ` +
          `(about ${Math.round(captureMs(captures) / 60000)} CI-minutes):`,
      );
      for (const title of captures) {
        console.log(`    ${title}  — ${[...selection.captures.get(title)].slice(0, 2).join("; ")}`);
      }
    }
    if (baseSpecs.length > 0) console.log(`  red on the base: ${baseSpecs.join(" ")}`);
    if (testsOnly) console.log("  only tests changed: no e2e build, no browser specs.");
  }
  const skipped = notRunHere({
    docsOnly,
    testsOnly,
    specs,
    allSpecs: allSpecFiles(),
    captures,
    quick,
  });
  if (args.includes("--plan")) {
    for (const step of steps) {
      const env = step.workers ? `E2E_WORKERS=${e2eWorkersHere().workers} ` : "";
      console.log(`  step ${step.name}: ${env}${step.command} ${step.args.join(" ")}`);
    }
    for (const line of skipped) console.log(`  not run here: ${line}`);
    return;
  }

  const logs = gitPath(git, "diveday-verify");
  mkdirSync(logs, { recursive: true });
  const ran = [];
  const evidence = {
    version: 1,
    sha: head,
    base: selection.base,
    baseSource: resolvedBase.source,
    mode: quick ? "quick" : "full",
    startedAt: new Date().toISOString(),
    steps: [],
    notRunHere: skipped,
  };
  const saveEvidence = () =>
    writeFileSync(path.join(logs, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  const fullTree = git(["rev-parse", "HEAD^{tree}"]);
  const dependencies = installationIdentity(ROOT);
  const lintTool = lintToolIdentity(ROOT);
  const tools = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    exec: process.execPath,
  };
  const cacheFile = path.join(logs, "static-cache.json");
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, "utf8"));
  } catch {}
  const staticNames = new Set(["lint", "typecheck", "check:repo", "guards"]);
  const runStatic = async (step) => {
    const log = path.join(logs, `${step.name.replace(/\W+/g, "-")}.log`);
    // Repository checks inspect live git/network state; guards can read arbitrary files.
    // They are collected together but deliberately never reused.
    const lintReusable =
      step.name === "lint" &&
      lintTool &&
      readFileSync(path.join(ROOT, "package.json"), "utf8").includes('"lint": "biome check ."');
    // Include local/global git excludes because Biome honors them; changing exclusions invalidates receipt.
    const excludeFile = git(["config", "--path", "--get", "core.excludesfile"]);
    let excludes = "";
    try {
      excludes += readFileSync(gitPath(git, "info/exclude"), "utf8");
    } catch {}
    if (excludeFile) {
      try {
        excludes += readFileSync(excludeFile, "utf8");
      } catch {
        excludes = null;
      }
    }
    const key =
      lintReusable && excludes !== null
        ? stageKey({
            tree: fullTree,
            step,
            env: process.env,
            tools: { ...tools, lintTool, excludes },
            dependencies,
          })
        : null;
    if (key && cache[step.name]?.key === key) {
      const result = {
        name: step.name,
        status: "passed",
        reused: true,
        key,
        command: [step.command, ...step.args],
        log: cache[step.name].log,
      };
      evidence.steps.push(result);
      return result;
    }
    const fd = openSync(log, "w");
    const start = Date.now();
    console.log(`… ${step.name}`);
    const result = await runStageAsync(
      lintReusable ? lintTool.binary : step.command,
      lintReusable ? ["check", "."] : step.args,
      {
        cwd: ROOT,
        env: process.env,
        stdio: ["ignore", fd, fd],
        timeoutMs: SUBPROCESS_TIMEOUTS.verifyPushStep,
      },
    );
    closeSync(fd);
    const receipt = {
      name: step.name,
      status: result.status === 0 ? "passed" : "failed",
      durationMs: Date.now() - start,
      command: [step.command, ...step.args],
      log,
      key,
    };
    if (receipt.status === "passed" && key) cache[step.name] = { key, log };
    evidence.steps.push(receipt);
    console.log(`${receipt.status === "passed" ? "✓" : "✗"} ${step.name}: ${log}`);
    if (receipt.status === "failed") console.error(tail(log));
    return receipt;
  };
  const stable = () =>
    verificationInputsStable(
      {
        head: git(["rev-parse", "HEAD"]),
        tree: git(["rev-parse", "HEAD^{tree}"]),
        status: git(["status", "--porcelain", "--untracked-files=normal"]),
      },
      { head, tree: fullTree },
    );
  let collected = false;
  let browserNote;
  const workerCounts = [];
  for (const step of steps) {
    if (staticNames.has(step.name)) {
      if (collected) continue;
      collected = true;
      const receipts = await collectStages(
        steps.filter((item) => staticNames.has(item.name)),
        runStatic,
        2,
      );
      if (!stable()) {
        console.error(
          "verify:push: inputs changed during verification; no receipts banked. Restore a clean committed tree and rerun.",
        );
        process.exitCode = 1;
        return;
      }
      for (const receipt of receipts)
        if (!evidence.steps.some((item) => item.name === receipt.name))
          evidence.steps.push(receipt);
      writeFileSync(cacheFile, `${JSON.stringify(cache)}\n`);
      saveEvidence();
      if (receipts.some((item) => item.status === "failed")) {
        process.exitCode = 1;
        return;
      }
      ran.push(...receipts.map((item) => item.name));
      continue;
    }
    if (step.build) {
      try {
        requireFreshBuild(ROOT);
        evidence.steps.push({ name: step.name, status: "passed", reused: true });
        saveEvidence();
        ran.push(step.name);
        console.log(`✓ ${step.name} (reused: inputs verified)`);
        continue;
      } catch {}
    }
    const log = path.join(logs, `${step.name.replace(/\W+/g, "-")}.log`);
    const fd = openSync(log, "w");
    const started = Date.now();
    let env = process.env;
    if (step.workers) {
      const { workers, formula } = e2eWorkersHere();
      env = { ...process.env, E2E_WORKERS: String(workers) };
      workerCounts.push({ step: step.name, workers, formula });
      process.stdout.write(`… ${step.name} on ${workers} worker(s): ${formula}\n`);
    } else {
      process.stdout.write(`… ${step.name}\n`);
    }
    const result = runStep(step.command, step.args, {
      cwd: ROOT,
      env,
      stdio: ["ignore", fd, fd],
      timeoutMs: SUBPROCESS_TIMEOUTS.verifyPushStep,
    });
    closeSync(fd);
    const seconds = Math.round((Date.now() - started) / 1000);
    let failed = result.status !== 0;
    let why = "";
    if (!failed && step.thenClean) {
      const after = git(["status", "--porcelain", "--untracked-files=normal"]);
      if (after) {
        failed = true;
        why = `\nIt rewrote generated files; look at them, commit them, and run verify:push again:\n${after}`;
      }
    }
    const fallback = step.workers && readFileSync(log, "utf8").match(BROWSER_FALLBACK);
    if (fallback && !browserNote) {
      browserNote = fallback[0];
      // Said once, pass or fail: the older Chromium is not why a functional spec fails here
      // (CORES_PER_E2E_WORKER above), so nobody chases it again.
      console.log(`${browserNote}\n(not a cause of functional failures; see CORES_PER_E2E_WORKER)`);
    }
    evidence.steps.push({
      name: step.name,
      status: failed ? "failed" : "passed",
      durationMs: Date.now() - started,
      command: [step.command, ...step.args],
      log,
    });
    saveEvidence();
    if (failed) {
      console.error(`✗ ${step.name} (${seconds}s) — full log: ${log}\n${tail(log)}${why}`);
      console.error(
        "\nverify:push: red. Fix it and run again. A failure that is red on the base branch too " +
          "is still yours to name: see docs/agents/verifying.md#the-pre-push-gate.",
      );
      process.exit(1);
    }
    if (step.build) writeFileSync(buildTreeFile(), `${tree}\n`);
    console.log(`✓ ${step.name} (${seconds}s)`);
    ran.push(step.name);
  }

  if (!stable()) {
    console.error(
      "verify:push: HEAD or working inputs changed during checks; no push stamp written.",
    );
    process.exitCode = 1;
    return;
  }
  const stamp = {
    sha: head,
    mode: quick ? "quick" : "full",
    base: selection.base,
    at: new Date().toISOString(),
    steps: ran,
    ...stampCoverage({ specs, verdict, decision }),
    captures: !quick && captures.length > 0 ? captures : undefined,
    e2eWorkers: workerCounts.length > 0 ? workerCounts : undefined,
    browser: browserNote ?? undefined,
    notRunHere: skipped,
  };
  writeStamps(stamp, { git });
  try {
    const state = readState(ROOT);
    if (state?.task)
      appendMetric(
        {
          task: state.task,
          provider: state.provider ?? "unknown",
          taskClass: state.taskClass ?? "unknown",
          event: "verified",
          sha: head,
          baseSha: git(["rev-parse", selection.base]),
          eventId: `verified:${state.task}:${head}:${stamp.mode}`,
          evidence: path.join(logs, "result.json"),
        },
        { root: ROOT, git },
      );
  } catch (error) {
    console.warn(`Verification passed, but task metrics could not be recorded: ${error.message}`);
  }
  console.log(`verify:push${quick ? " --quick" : ""}: green. ${head.slice(0, 9)} may be pushed.`);
  console.log("Not run here, so CI is the first to run it:");
  for (const line of skipped) console.log(`  - ${line}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
