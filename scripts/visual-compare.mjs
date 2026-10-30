#!/usr/bin/env node
// `pnpm visual:compare` — one reg-suit run, with its two snapshot keys named
// rather than inferred.
//
// This exists because `regconfig.json` now interpolates `${REG_ACTUAL_KEY}` and
// `${REG_EXPECTED_KEY}` (reg-simple-keygen-plugin), and reg-suit's own
// substitution writes the literal string `undefined` for a variable that is not
// set — which would publish this commit's screenshots under the key
// `undefined` and quietly overwrite whatever was there. So nothing runs
// reg-suit directly any more: everything goes through here, which resolves the
// keys first (`scripts/reg-suit-keys.mjs`) and refuses to run without one.
//
// CI resolves the keys in an earlier step, because the `visual-publish` job
// needs the expected key *before* the compare to wait for a stacked layer's
// baseline. Values already in the environment win, so that step and this script
// can never disagree — and so a human triaging by hand can override either key
// for one run.
import { appendFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { regSuitConfigArgs } from "./reg-suit-config.mjs";
import { gitReader, resolveRegSuitKeys } from "./reg-suit-keys.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { fillFromExpected, selectionNote } from "./visual-fill.mjs";
import { DEFAULT_BUCKET } from "./visual-report-lib.mjs";
import { nearestPublishedAncestor } from "./wait-for-baseline.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function keysFromEnvironment(env) {
  // `REG_ACTUAL_KEY` present is the signal that an earlier step resolved both.
  // The expected one is legitimately empty (a first commit, a vanished base),
  // so its absence proves nothing.
  if (!env.REG_ACTUAL_KEY) return null;
  return { actualKey: env.REG_ACTUAL_KEY, expectedKey: env.REG_EXPECTED_KEY ?? "" };
}

const fromEnvironment = keysFromEnvironment(process.env);
const resolved = fromEnvironment ?? resolveRegSuitKeys({ git: gitReader(repoRoot) });

// A workstation run resolves its own keys, so it settles its own baseline too:
// the fork point from main may be a docs-only commit or a cancelled main run,
// neither of which published a snapshot (scripts/wait-for-baseline.mjs). CI
// did this in its own step and handed the answer in through the environment.
if (!fromEnvironment && resolved.expectedKey) {
  const bucket = process.env.REG_SUIT_S3_BUCKET_NAME || DEFAULT_BUCKET;
  const nearest = await nearestPublishedAncestor({
    bucket,
    key: resolved.expectedKey,
    git: gitReader(repoRoot),
  }).catch(() => null);
  if (nearest && nearest.skipped > 0) {
    console.log(
      `visual:compare: ${resolved.expectedKey} published no snapshot; comparing against ` +
        `${nearest.key}, ${nearest.skipped} commit(s) before it. Surfaces main moved between the ` +
        "two will read as this branch's.",
    );
    resolved.expectedKey = nearest.key;
  }
}

if (!resolved.actualKey) {
  console.error(
    "visual:compare: could not resolve the commit to publish this run's screenshots under, so there " +
      "is no honest key to use. reg-suit's own fallback is a timestamp, which publishes a snapshot no " +
      "later run can ever ask for. Run this inside a git working copy, or set REG_ACTUAL_KEY yourself.",
  );
  process.exit(1);
}

console.log(`visual:compare: actual key   ${resolved.actualKey}`);
console.log(
  `visual:compare: expected key ${resolved.expectedKey || "(none — nothing will be compared)"}`,
);

// `dotenv -c` loads .env/.env.local so a workstation run finds the bucket and
// its credentials; on CI those arrive as step `env:` and dotenv finds no files,
// which is fine. Resolved from node_modules rather than PATH so this behaves
// the same when invoked as a bare `node scripts/visual-compare.mjs`.
const binDir = path.join(repoRoot, "node_modules", ".bin");
const configArgs = regSuitConfigArgs(process.env.REG_SUIT_CONFIG);
const regSuit = (...args) =>
  runBounded(path.join(binDir, "dotenv"), ["-c", "--", "reg-suit", ...configArgs, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
    // Nothing is logged from here: dotenv is about to load live AWS credentials
    // into this child's environment. `PATH` is extended rather than trusted so
    // dotenv can find `reg-suit` even when this is invoked as a bare
    // `node scripts/visual-compare.mjs` rather than through pnpm.
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      REG_ACTUAL_KEY: resolved.actualKey,
      REG_EXPECTED_KEY: resolved.expectedKey ?? "",
    },
    timeoutMs: SUBPROCESS_TIMEOUTS.regSuitRun,
  });

// A pull request that captured only the surfaces its diff can reach
// (`scripts/visual-affected.mjs`) is finished from the baseline before the
// compare (`scripts/visual-fill.mjs`): reg-suit's own stages, run one by one so
// the expected images are on disk between the fetch and the compare. Every
// other run is the one `reg-suit run` it always was.
//
// `VISUAL_EXPECTED_DIR` is the baseline's images already on disk (CI restores
// them from the Actions cache by the expected key, which names an immutable
// snapshot): they are put where reg-suit's fetch would have written them, and
// the fetch is skipped (code re-review 2026-10-13, item 27).
const fill = process.env.VISUAL_FILL_FROM_EXPECTED === "true";
const restored = process.env.VISUAL_EXPECTED_DIR;
const expectedReady = process.env.VISUAL_EXPECTED_READY === "true";
const compareOnly = process.env.REG_SUIT_COMPARE_ONLY === "true";
if (fill || restored || expectedReady) {
  const expectedDir = path.join(repoRoot, ".reg", "expected");
  const stages = [
    restored ? ["restore"] : expectedReady ? [] : ["sync-expected"],
    ...(fill ? [["fill"]] : []),
    ["compare"],
    ...(!compareOnly
      ? [["publish", ...(process.env.REG_SUIT_SKIP_NOTIFICATION === "true" ? [] : ["-n"])]]
      : []),
  ].filter((stage) => stage.length > 0);
  for (const [stage, ...args] of stages) {
    if (stage === "restore") {
      rmSync(expectedDir, { recursive: true, force: true });
      mkdirSync(path.dirname(expectedDir), { recursive: true });
      cpSync(path.resolve(repoRoot, restored), expectedDir, { recursive: true });
      console.log(`visual:compare: the expected images came from ${restored}, not from S3.`);
      continue;
    }
    if (stage === "fill") {
      const filled = fillFromExpected({
        expectedDir,
        actualDir: path.join(repoRoot, "e2e", "screenshots"),
      });
      console.log(
        `visual:compare: ${filled.captured} captured, ${filled.copied} copied from the baseline.`,
      );
      if (process.env.GITHUB_ENV) {
        appendFileSync(process.env.GITHUB_ENV, `VISUAL_SELECTION_NOTE=${selectionNote(filled)}\n`);
      }
      if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `selection_note=${selectionNote(filled)}\n`);
      }
      continue;
    }
    const step = regSuit(stage, ...args);
    if (step.status !== 0) process.exit(step.status ?? 1);
  }
  process.exit(0);
}

if (process.env.REG_SUIT_SKIP_NOTIFICATION === "true") {
  // Keep `run`'s bundled notifier off for callers that publish GitHub reports
  // elsewhere. The trusted CI workflow now compares in a job without id-token
  // and publishes a prepared bundle in a separate minimal OIDC job.
  const stages = compareOnly
    ? ["sync-expected", "compare"]
    : ["sync-expected", "compare", "publish"];
  for (const stage of stages) {
    const step = regSuit(stage);
    if (step.status !== 0) process.exit(step.status ?? 1);
  }
  process.exit(0);
}

const result = regSuit("run");
process.exit(result.status ?? 1);
