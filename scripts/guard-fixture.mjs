import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

/**
 * Run a `check:repo` guard against a fixture tree rather than this checkout.
 *
 * Most guards read `process.cwd()` at module scope and export nothing, so the honest way to
 * pin their judgement is the way `check-repo.mjs` runs them: a child `node` process, here
 * with its working directory set to a temporary tree holding only `files` (a map of
 * repository-relative path to contents, a `Buffer` where the bytes matter, `undefined` to leave
 * a path out, a trailing `/` for an empty directory). Returns the exit
 * status and both streams; the tree is removed afterwards.
 */
export function runGuard(script, files) {
  const dir = mkdtempSync(path.join(tmpdir(), "guard-fixture-"));
  try {
    for (const [file, contents] of Object.entries(files)) {
      if (contents === undefined) continue;
      const target = path.join(dir, file);
      if (file.endsWith("/")) {
        mkdirSync(target, { recursive: true });
        continue;
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    const result = runBounded(process.execPath, [path.join(SCRIPTS, script)], {
      cwd: dir,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
