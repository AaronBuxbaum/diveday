#!/usr/bin/env node
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
  env: {
    ...process.env,
    APP_HOST: "https://e2e.diveday.example",
    DATABASE_URL: "",
    DATABASE_URL_UNPOOLED: "",
    PGLITE_DATA_DIR: "memory",
    DIVEDAY_E2E: "1",
    NEXT_PUBLIC_SENTRY_DSN: "",
  },
});
if (result.status !== 0) process.exit(result.status ?? 1);
const swAssets = runBounded("pnpm", ["build:sw:assets"], {
  stdio: "inherit",
  timeoutMs: SUBPROCESS_TIMEOUTS.build,
});
if (swAssets.status !== 0) process.exit(swAssets.status ?? 1);
writeBuildEvidence(root, fingerprint);
console.log("e2e: production build input fingerprint recorded.");
