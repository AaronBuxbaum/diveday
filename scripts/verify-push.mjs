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
//     check, so `vitest --changed` never selects them. All 157 run here, in about two minutes.
//   - the `guards` Vitest project (CI's Repository safeguards job), which no local step ran.
//   - typecheck after a merge from the layer below, which nobody re-ran because the layer's
//     own checks had already passed. The stamp is per commit, so a merge is a new HEAD.
//
// Steps, cheapest first; it stops at the first red one, because a later step on a broken tree
// spends minutes saying the same thing:
//
//   regen → lint → typecheck → check:repo → guards → source scans → vitest --changed
//         → e2e build → affected Playwright specs → stamp
//
//   pnpm verify:push            run it
//   pnpm verify:push --plan     print the base, the steps and the selected specs, run nothing
//
// The diff is measured against the layer below (`stackBase`), not `origin/main`: on a fifteen-
// layer stack `vitest --changed origin/main` selects the whole suite, which is why several PR
// bodies record it as "cut short". Each step's output goes to a log under the git dir; a red
// step prints only its tail.

import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { affectedSpecs, durations, estimateMs, stackBase, withinBudget } from "./e2e-affected.mjs";
import { gitReader } from "./stack-map.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Recorded CI time the strong and reach tiers may spend together before reach stops adding. */
export const E2E_BUDGET_MS = 15 * 60_000;

/** A diff of only these changes no code: CI skips the unit and browser jobs for it too. */
const DOCS_ONLY = /^(?:docs\/|\.claude\/|[^/]+\.md$)|\.md$/;

/** Files whose change can move the export-bundle snapshot; then `regen` reruns it. */
const SNAPSHOT_INPUTS = /^src\/db\/(?:schema\/|seed|export)/;

/** A test that reads files off disk: what `vitest --changed` cannot select by import. */
const READS_FILES = /\breadFileSync\s*\(|\breadFile\s*\(|\breaddirSync\s*\(|\bglobSync\s*\(/;

/** Name of the stamp file inside the git dir (`git rev-parse --git-path`). */
export const STAMP = "diveday-verified.json";

/** Every `src/` test that reads the repository from disk. */
export function sourceScanTests(root = ROOT) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (
        /\.test\.tsx?$/.test(rel) &&
        READS_FILES.test(readFileSync(path.join(root, rel), "utf8"))
      ) {
        found.push(rel);
      }
    }
  };
  walk("src");
  return found.sort();
}

/**
 * The steps for a diff. `changed` is the file list against the base, `mergeBase` the sha
 * `vitest --changed` diffs from, `specs` the Playwright files to run.
 */
export function plan({ changed, mergeBase, specs, scans }) {
  const docsOnly = changed.length > 0 && changed.every((file) => DOCS_ONLY.test(file));
  const schema = changed.some((file) => file.startsWith("src/db/schema/"));
  const snapshot = changed.some((file) => SNAPSHOT_INPUTS.test(file));
  const steps = [
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
  if (docsOnly) return steps;
  steps.push({
    name: "source scans",
    command: "pnpm",
    args: ["exec", "vitest", "run", ...scans, "--reporter=dot"],
  });
  // A schema module sits in nearly every import chain, so `--changed` would be the whole suite;
  // the coverage guards that answer for a schema edit are named instead (verifying.md).
  steps.push(
    schema
      ? {
          name: "schema guards",
          command: "pnpm",
          args: [
            "exec",
            "vitest",
            "run",
            "src/db/export.test.ts",
            "src/db/diver-merge.test.ts",
            "src/db/delete-path-coverage.test.ts",
            "src/db/retention.test.ts",
            "src/db/export-bundle.snapshot.test.ts",
            "--reporter=dot",
          ],
        }
      : {
          name: "changed tests",
          command: "pnpm",
          args: [
            "exec",
            "vitest",
            "run",
            "--changed",
            mergeBase,
            "--passWithNoTests",
            "--reporter=dot",
          ],
        },
  );
  if (specs.length > 0) {
    steps.push({ name: "e2e build", command: "pnpm", args: ["e2e:build"], build: true });
    steps.push({
      name: "e2e specs",
      command: "pnpm",
      args: ["e2e:run", ...specs, "--reporter=line"],
    });
  }
  return steps;
}

function gitPath(git, name) {
  const relative = git(["rev-parse", "--git-path", name]);
  return relative ? path.resolve(ROOT, relative) : null;
}

function tail(file, lines = 60) {
  try {
    return readFileSync(file, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** The tree a build was made from, so an unchanged HEAD reuses it. */
function buildTreeFile() {
  return path.join(ROOT, ".next", "diveday-build-tree");
}

function main() {
  const args = process.argv.slice(2);
  const git = gitReader(ROOT);
  const head = git(["rev-parse", "HEAD"]);
  const tree = git(["rev-parse", "HEAD^{tree}"]);
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

  const base = stackBase(git);
  const selection = affectedSpecs({ root: ROOT, base, git });
  if (!selection) {
    console.error("verify:push: could not diff against a base (is origin/main fetched?).");
    process.exit(1);
  }
  const mergeBase = git(["merge-base", selection.base, "HEAD"]);
  const record = durations(ROOT);
  const strong = [...selection.strong.keys()].sort();
  const room = Math.max(0, E2E_BUDGET_MS - estimateMs(strong, record));
  const { run: reachRun, left } = withinBudget(selection.reach, selection.rank, record, room);
  const specs = [...strong, ...reachRun];
  const steps = plan({
    changed: selection.changed,
    mergeBase,
    specs,
    scans: sourceScanTests(ROOT),
  });

  console.log(
    `verify:push: ${selection.changed.length} file(s) against ${selection.base}; ` +
      `${strong.length} spec(s) the diff names, ${reachRun.length} it reaches, ` +
      `${left.length} more left to CI (about ${Math.round(estimateMs(specs, record) / 60000)} CI-minutes of browser tests).`,
  );
  for (const spec of strong) {
    console.log(`  ${spec}  — ${[...selection.strong.get(spec)].slice(0, 2).join("; ")}`);
  }
  if (reachRun.length > 0) console.log(`  reached: ${reachRun.join(" ")}`);
  if (args.includes("--plan")) {
    for (const step of steps) {
      const shown =
        step.name === "source scans" ? [`<${step.args.length - 4} test files>`] : step.args;
      console.log(`  step ${step.name}: ${step.command} ${shown.join(" ")}`);
    }
    return;
  }

  const logs = gitPath(git, "diveday-verify");
  mkdirSync(logs, { recursive: true });
  const ran = [];
  for (const step of steps) {
    if (step.build) {
      try {
        if (readFileSync(buildTreeFile(), "utf8").trim() === tree) {
          console.log(`✓ ${step.name} (reused: built from this tree)`);
          continue;
        }
      } catch {}
    }
    const log = path.join(logs, `${step.name.replace(/\W+/g, "-")}.log`);
    const fd = openSync(log, "w");
    const started = Date.now();
    process.stdout.write(`… ${step.name}\n`);
    const result = runBounded(step.command, step.args, {
      cwd: ROOT,
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

  const stamp = {
    sha: head,
    base: selection.base,
    at: new Date().toISOString(),
    steps: ran,
    specs,
    leftToCi: left,
  };
  writeFileSync(gitPath(git, STAMP), `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`verify:push: green. ${head.slice(0, 9)} may be pushed.`);
  if (left.length > 0) console.log(`Left to CI: ${left.join(" ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
