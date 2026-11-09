import path from "node:path";
import { fileURLToPath } from "node:url";
import { e2eBuildEnv } from "./e2e-build-env.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/** Fail closed before tsc if fresh production route validation cannot be generated. */
export function typecheckCI(run = runBounded) {
  for (const args of [["exec", "next", "typegen"], ["typecheck"]]) {
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
  process.exitCode = typecheckCI();
}
