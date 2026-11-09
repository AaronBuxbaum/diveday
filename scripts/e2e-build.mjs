#!/usr/bin/env node
import { e2eBuildEnv } from "./e2e-build-env.mjs";
import { buildFingerprint, writeBuildEvidence } from "./e2e-build-evidence.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const root = process.cwd();
const sw = runBounded("pnpm", ["build:sw"], {
  stdio: "inherit",
  timeoutMs: SUBPROCESS_TIMEOUTS.build,
});
if (sw.status !== 0) process.exit(sw.status ?? 1);
const fingerprint = buildFingerprint(root);
const result = runBounded("pnpm", ["exec", "next", "build"], {
  stdio: "inherit",
  timeoutMs: SUBPROCESS_TIMEOUTS.build,
  env: e2eBuildEnv(),
});
if (result.status !== 0) process.exit(result.status ?? 1);
const swAssets = runBounded("pnpm", ["build:sw:assets"], {
  stdio: "inherit",
  timeoutMs: SUBPROCESS_TIMEOUTS.build,
});
if (swAssets.status !== 0) process.exit(swAssets.status ?? 1);
writeBuildEvidence(root, fingerprint);
console.log("e2e: production build input fingerprint recorded.");
