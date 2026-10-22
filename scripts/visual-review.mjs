#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireFreshBuild } from "./e2e-build-evidence.mjs";
import { listedTests } from "./e2e-shard.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export function reviewPlan(args) {
  const value = (name) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? null : args[i + 1];
  };
  const grep = value("grep");
  if (!grep || grep.startsWith("--"))
    throw new Error("Use --grep <specific capture test title> to bound review scope.");
  new RegExp(grep);
  const contract = Object.fromEntries(
    ["route", "role", "fixture", "state", "expect"].map((key) => [key, value(key)]),
  );
  if (
    !args.includes("--plan") &&
    Object.values(contract).some((value) => !value || value.startsWith("--"))
  )
    throw new Error(
      "Capture requires --route <template> --role <role> --fixture <seed> --state <state> --expect <CSS selector proving changed content>.",
    );
  const color = args.includes("--color");
  return {
    grep,
    contract,
    color,
    review: "not-reviewed",
    comparison: "not-run (CI Linux baseline comparison is separate)",
    omitted: color
      ? []
      : [
          "dark: omitted because color work was not requested",
          "print and standalone harness tests: select separately with --color",
        ],
    captureArgs: [
      "exec",
      "playwright",
      "test",
      "e2e/visual",
      "--grep",
      color ? grep : `(?=.*light mode)(?=.*(?:${grep}))`,
      "--workers=1",
      "--reporter=line",
    ],
  };
}

export function main(args = process.argv.slice(2)) {
  const plan = reviewPlan(args);
  if (args.includes("--plan")) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  const build = requireFreshBuild();
  const listing = runBounded(
    "pnpm",
    ["exec", "playwright", "test", "e2e/visual", "--list", "--reporter=json"],
    { encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript, maxBuffer: 16 * 1024 * 1024 },
  );
  if (listing.status !== 0) throw new Error("Cannot enumerate visual tests; no captures started.");
  const every = listedTests(JSON.parse(listing.stdout));
  const pattern = new RegExp(plan.captureArgs[plan.captureArgs.indexOf("--grep") + 1]);
  const selectedTests = every.filter((title) => pattern.test(title));
  if (!selectedTests.length) throw new Error("Scope selects no visual tests; refine --grep.");
  const directory = path.resolve(".agent-out", "visual-review", `${Date.now()}-${process.pid}`);
  const evidenceDir = path.join(directory, "captures");
  mkdirSync(evidenceDir, { recursive: true });
  const env = {
    ...process.env,
    PIXEL_PROBE: "1",
    VISUAL_PROBE_DIR: path.join(directory, "probe"),
    VISUAL_EVIDENCE_DIR: evidenceDir,
    VISUAL_ROUTE: plan.contract.route,
    VISUAL_ROLE: plan.contract.role,
    VISUAL_FIXTURE: plan.contract.fixture,
    VISUAL_STATE: plan.contract.state,
    VISUAL_EXPECT: plan.contract.expect,
  };
  const started = Date.now();
  const capture = runBounded("pnpm", plan.captureArgs, {
    env,
    stdio: "inherit",
    timeoutMs: SUBPROCESS_TIMEOUTS.verifyPushStep,
  });
  const records = readdirSync(evidenceDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(evidenceDir, file), "utf8")));
  let fresh = true;
  try {
    requireFreshBuild();
  } catch {
    fresh = false;
  }
  const probe = runBounded("node", ["scripts/pixel-probe-report.mjs"], {
    env,
    stdio: "inherit",
    timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
  });
  const manifest = {
    ...plan,
    selectedTests,
    omittedTests: {
      count: every.length - selectedTests.length,
      reason: "outside explicit grep or scheme scope",
    },
    build,
    fresh,
    durationMs: Date.now() - started,
    captureExit: capture.status,
    probeExit: probe.status,
    captures: records,
    probeReport: path.join(env.VISUAL_PROBE_DIR, "REPORT.md"),
    rerun: ["node", "scripts/visual-review.mjs", ...args],
    status:
      capture.status === 0 && fresh && records.length ? "captured-not-reviewed" : "incomplete",
    review: "not-reviewed",
  };
  writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Visual evidence: ${directory}/manifest.json (${manifest.status}). Inspect images and probe report before recording a review.`,
  );
  if (manifest.status === "incomplete" || probe.status !== 0) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
