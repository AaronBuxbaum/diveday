#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Guard for `pnpm e2e:run`.
 *
 * `pnpm e2e:run` skips `next build` on purpose — playwright.config.ts's
 * webServer block reuses whatever production build already sits in `.next`,
 * which is the whole point of the fast iteration path. But that means a
 * missing or stale build fails silently: Playwright just starts serving
 * whatever is (or isn't) there, and the resulting failures look like broken
 * tests instead of a build problem.
 *
 * So: fail loudly when there is no build at all, and warn (without blocking)
 * when the build looks older than the source it's supposed to reflect.
 */

const ROOT = process.cwd();
const buildIdPath = path.join(ROOT, ".next", "BUILD_ID");

if (!existsSync(buildIdPath)) {
  console.error(
    "e2e: no production build found at .next/BUILD_ID. `pnpm e2e:run` reuses whatever build " +
      "is already on disk instead of building one — run `pnpm e2e:build` once, then iterate " +
      "with `pnpm e2e:run <spec> --reporter=line`.",
  );
  process.exit(1);
}

const buildMtimeMs = statSync(buildIdPath).mtimeMs;
const SRC_ROOT = path.join(ROOT, "src");
const SKIP_DIRS = new Set(["node_modules", ".next"]);

// Stop at the first newer file rather than walking the whole tree every time
// — this only needs to prove staleness, not enumerate it.
function findNewerFile(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findNewerFile(full);
      if (found) return found;
    } else if (entry.isFile() && statSync(full).mtimeMs > buildMtimeMs) {
      return full;
    }
  }
  return null;
}

const staleFile = findNewerFile(SRC_ROOT);
if (staleFile) {
  console.warn(
    `e2e: ${path.relative(ROOT, staleFile)} is newer than .next/BUILD_ID — the build on disk ` +
      "may not reflect current source. `pnpm e2e:run` never rebuilds; if a test fails in a " +
      "confusing way, run `pnpm e2e:build` and try again. Continuing with the existing build.",
  );
}
