import path from "node:path";
import type { Reporter, TestModule } from "vitest/node";

/**
 * Names each failed test file as a GitHub annotation whose path is the test file itself.
 *
 * `pnpm verify:push` reads the layer below's red CI before it stamps a push
 * (`scripts/base-ci.mjs`): a layer pushed on a red base is a red run for it and every layer
 * above, so the gate re-runs the base's failing files here and stamps only when they pass.
 * It can only re-run what CI names, and a unit shard's log is out of a script's reach (its
 * download is a redirect the cloud egress policy refuses). Annotations are not, and Vitest's
 * own `github-actions` reporter anchors each one at the nearest stack frame, which is as
 * often a helper (`src/test/db.ts`) as the test file.
 *
 * Off outside GitHub Actions. Added beside the run's real reporter, never instead of it.
 */
export const ANNOTATION_TITLE = "Failed test file";

/** The workflow command for one failed file, repo-relative and POSIX. */
export function failedFileCommand(moduleId: string, root: string): string {
  const file = path.relative(root, moduleId).split(path.sep).join("/");
  return `::error file=${file},title=${ANNOTATION_TITLE}::${file}`;
}

export default class FailedFilesReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    if (process.env.GITHUB_ACTIONS !== "true") return;
    for (const module of testModules) {
      if (module.state() !== "failed") continue;
      console.log(failedFileCommand(module.moduleId, module.project.config.root));
    }
  }
}
