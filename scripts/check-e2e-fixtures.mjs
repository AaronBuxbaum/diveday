import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Every `e2e/*.spec.ts` file must import `test`/`expect` from `./fixtures`,
 * never directly from `@playwright/test` (docs/engineering/testing.md, the
 * e2e-and-visual skill, ADR 20260801-cache-components-e2e-activity-migration).
 * `e2e/fixtures.ts` patches the `page` fixture's `getByText` to filter by
 * visibility, so it stays Activity-safe once `cacheComponents` is on — a spec
 * that imports the bare Playwright `test` silently loses that patch and can
 * pick up a stale strict-mode failure with no signal pointing at the fixture.
 */

const ROOT = process.cwd();
const E2E_DIR = "e2e";
// Only a value import of `test`/`expect` bypasses the fixture — a type-only
// import (`import type { Page } from "@playwright/test"`, or an inline
// `import("@playwright/test").Page` type reference) carries no runtime
// `test`/`expect` and is unaffected by which one a spec uses.
const importPattern =
  /import\s*\{[^}]*\b(?:test|expect)\b[^}]*\}\s*from\s*["']@playwright\/test["']/;

async function main() {
  const absoluteDir = path.join(ROOT, E2E_DIR);
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log("check:e2e-fixtures: no e2e/ directory, nothing to check");
      return;
    }
    throw error;
  }

  const specFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
    .map((entry) => path.join(E2E_DIR, entry.name));

  const offenders = [];
  for (const relativePath of specFiles) {
    const contents = await readFile(path.join(ROOT, relativePath), "utf8");
    if (importPattern.test(contents)) offenders.push(relativePath);
  }

  if (offenders.length > 0) {
    console.error("check:e2e-fixtures: spec(s) import test/expect from @playwright/test directly:");
    for (const file of offenders) console.error(`  - ${file}`);
    console.error('Import from "./fixtures" instead, so the Activity-safe page fixture applies.');
    process.exitCode = 1;
    return;
  }

  console.log(`check:e2e-fixtures: ok — ${specFiles.length} spec files import from ./fixtures`);
}

await main();
