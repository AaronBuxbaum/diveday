#!/usr/bin/env node
// Fast confidence for uncommitted work. Full CI remains the release gate.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { affectedSpecs, durations, readSpecs, smokeTests } from "./e2e-affected.mjs";
import { gitReader } from "./stack-map.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import { sourceReaders, testPlan } from "./test-affected.mjs";
import { worktreeIdentity } from "./verify-agent-inputs.mjs";
import { agentSteps, browserPlan, REACH_BUDGET_MS } from "./verify-agent-plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function main(args = process.argv.slice(2)) {
  const git = gitReader(ROOT);
  const option = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const identity = worktreeIdentity(ROOT, git);
  const selection = affectedSpecs({ root: ROOT, base: option("--base"), workingTree: true, git });
  if (!selection) throw new Error("Cannot resolve diff base; pass --base <ref>");
  const browser = browserPlan({
    selection,
    record: durations(ROOT),
    budgetMs:
      option("--browser-minutes") === undefined
        ? REACH_BUDGET_MS
        : Number(option("--browser-minutes")) * 60_000,
  });
  if (browser.specs.length) {
    const smoke = smokeTests(readSpecs(ROOT));
    if (smoke.missing.length)
      throw new Error(`Mandatory smoke tests not found: ${smoke.missing.join("; ")}`);
    // Include smoke even when the trigger is config, assets or an edited browser spec.
    for (const test of smoke.found)
      if (!browser.specs.includes(test) && !browser.specs.includes(test.replace(/:\d+$/, "")))
        browser.specs.push(test);
  }
  const units = testPlan({ changed: selection.changed, readers: () => sourceReaders(ROOT) });
  const steps = agentSteps({ units, browser });
  const receipt = {
    version: 1,
    mode: "agent",
    identity,
    base: selection.base,
    changed: selection.changed,
    browser,
    units,
    steps: [],
    fullCi: false,
    passed: false,
    notRunHere: [
      "Full unit suite unless fallback selected it",
      "Visual, mobile, hosted integration and full CI checks",
      ...browser.deferred,
    ],
  };
  console.log(JSON.stringify({ ...receipt, plannedSteps: steps }, null, 2));
  if (args.includes("--plan")) return;
  const directory = git(["rev-parse", "--git-path", "diveday-agent-verification"]);
  if (!directory) throw new Error("Cannot locate verification receipts directory");
  const out = path.resolve(ROOT, directory);
  mkdirSync(out, { recursive: true });
  const save = () =>
    writeFileSync(path.join(out, "result.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  save();
  for (const step of steps) {
    if (worktreeIdentity(ROOT, git) !== identity)
      throw new Error("Working inputs changed; rerun verification");
    console.log(`verify:agent: ${step.name}`);
    const start = Date.now();
    const result = runBounded(step.command, step.args, {
      cwd: ROOT,
      stdio: "inherit",
      env: step.browser
        ? { ...process.env, E2E_WORKERS: process.env.E2E_WORKERS ?? "1" }
        : process.env,
      timeoutMs: SUBPROCESS_TIMEOUTS.verifyPushStep,
    });
    receipt.steps.push({
      name: step.name,
      durationMs: Date.now() - start,
      status: result.status === 0 ? "passed" : "failed",
    });
    save();
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
  }
  if (worktreeIdentity(ROOT, git) !== identity)
    throw new Error("Inputs changed during verification; no passing receipt");
  receipt.passed = true;
  save();
  console.log(
    `verify:agent: selected checks passed for ${identity.slice(0, 12)}. NOT full CI; deferred checks are recorded in ${path.join(out, "result.json")}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`verify:agent: ${error.message}`);
    process.exitCode = 1;
  }
}
