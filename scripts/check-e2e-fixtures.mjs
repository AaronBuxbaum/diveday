import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Two Activity-safety invariants for `e2e/*.spec.ts` (docs/engineering/testing.md,
 * the e2e-and-visual skill, ADR 20260801-cache-components-e2e-activity-migration):
 *
 * 1. Every spec must import `test`/`expect` from `./fixtures`, never directly
 *    from `@playwright/test`. `e2e/fixtures.ts`'s `page` fixture patches
 *    `getByText`/`getByRole`/`getByLabel`/`getByPlaceholder` to filter by
 *    visibility, so it stays Activity-safe once `cacheComponents` is on — a
 *    spec that imports the bare Playwright `test` silently loses that patch.
 * 2. A second actor's `Page` opened via `browser.newContext()`/
 *    `context.newPage()` is a separate `Page` instance the fixture never
 *    touches, so it must be wrapped in `makeActivitySafe(...)` (also exported
 *    from `./fixtures`) at the point it's created — otherwise that page's
 *    locators silently lose the same patch.
 */

const ROOT = process.cwd();
const E2E_DIR = "e2e";
// Only a value import of `test`/`expect` bypasses the fixture — a type-only
// import (`import type { Page } from "@playwright/test"`, or an inline
// `import("@playwright/test").Page` type reference) carries no runtime
// `test`/`expect` and is unaffected by which one a spec uses.
const importPattern =
  /import\s*\{[^}]*\b(?:test|expect)\b[^}]*\}\s*from\s*["']@playwright\/test["']/;
// A `const x = await y.newPage()` not immediately wrapped in
// `makeActivitySafe(...)`. Deliberately narrow (declaration-site only) rather
// than trying to prove every subsequent use is safe — a false negative here
// just means a spec discovers the gap the way Phase 2 did, empirically; a
// false positive would block an unrelated change for no reason.
const unwrappedNewPagePattern = /=\s*await\s+(?!makeActivitySafe\()[\w.]+\.newPage\(\)/;

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

  const badImports = [];
  const unwrappedPages = [];
  for (const relativePath of specFiles) {
    const contents = await readFile(path.join(ROOT, relativePath), "utf8");
    if (importPattern.test(contents)) badImports.push(relativePath);
    if (unwrappedNewPagePattern.test(contents)) unwrappedPages.push(relativePath);
  }

  if (badImports.length > 0 || unwrappedPages.length > 0) {
    if (badImports.length > 0) {
      console.error(
        "check:e2e-fixtures: spec(s) import test/expect from @playwright/test directly:",
      );
      for (const file of badImports) console.error(`  - ${file}`);
      console.error('Import from "./fixtures" instead, so the Activity-safe page fixture applies.');
    }
    if (unwrappedPages.length > 0) {
      console.error("check:e2e-fixtures: spec(s) call .newPage() without makeActivitySafe(...):");
      for (const file of unwrappedPages) console.error(`  - ${file}`);
      console.error(
        'Wrap it: const p = makeActivitySafe(await ctx.newPage()); (import from "./fixtures").',
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(`check:e2e-fixtures: ok — ${specFiles.length} spec files import from ./fixtures`);
}

await main();
