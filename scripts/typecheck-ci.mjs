import path from "node:path";
import { fileURLToPath } from "node:url";
import { e2eBuildEnv } from "./e2e-build-env.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/** Keep the full app checker in Next's required build; otherwise generate then check here. */
export function typecheckCI(run = runBounded, buildChecksApp = false) {
  const commands = buildChecksApp
    ? [["exec", "tsc", "--noEmit", "-p", "src/worker"]]
    : [["exec", "next", "typegen"], ["typecheck"]];
  for (const args of commands) {
    const result = run("pnpm", args, {
      stdio: "inherit",
      timeoutMs: SUBPROCESS_TIMEOUTS.build,
      env: e2eBuildEnv(),
    });
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = typecheckCI(runBounded, process.argv.includes("--build-checks-app"));
}
