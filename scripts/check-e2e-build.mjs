#!/usr/bin/env node
import { requireFreshBuild } from "./e2e-build-evidence.mjs";

try {
  const evidence = requireFreshBuild();
  console.log(`e2e: fresh build ${evidence.buildId} (${evidence.fingerprint.slice(0, 12)}).`);
} catch (error) {
  console.error(`e2e: ${error.message}`);
  process.exitCode = 1;
}
