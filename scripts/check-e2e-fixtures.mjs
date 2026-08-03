import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * e2e-shaped invariants nothing else enforces.
 *
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
 *
 * And one for the harness's server-side half:
 *
 * 3. Every HTTP handler under `src/app/api/test/**` must call
 *    `e2eTestRouteAuthorized(request)` (`src/lib/e2e-test-routes.ts`). These
 *    routes exist only so the Playwright fleet can reset and seed state, and
 *    they do things no deployment may ever expose: `seed-account-token` mints
 *    a valid password-reset/invite token for any account by email, `reset`
 *    wipes and reseeds. All five call the guard today; nothing made the next
 *    one do so, and a missed guard plus one misconfigured deployment is
 *    account takeover (the finding behind the guard —
 *    docs/product/archive/specialist-optimization-audit-20260731.md §5).
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

const TEST_ROUTE_DIR = "src/app/api/test";
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const guardImportPattern =
  /import\s*\{[^}]*\be2eTestRouteAuthorized\b[^}]*\}\s*from\s*["']@\/lib\/e2e-test-routes["']/;
// Route handlers are the module's top-level named exports, so anchor to the
// start of a line: `export async function POST(`, `export function GET(`, or
// `export const DELETE = `.
const handlerPattern = new RegExp(
  String.raw`^export\s+(?:async\s+)?(?:function|const)\s+(${HTTP_METHODS.join("|")})\b`,
  "gm",
);
// Deliberately narrow, in the same spirit as unwrappedNewPagePattern: it asks
// only whether the guard is *called* somewhere in each handler's body (the
// slice from its `export` to the next handler's, since these are flat top-level
// declarations), not whether it's called first or that its result is honored.
// Proving those needs a type-aware pass; the failure this catches is the real
// one — a new route that simply forgot the guard exists.
const guardCallPattern = /\be2eTestRouteAuthorized\s*\(/;

// Every exported handler in `contents`, paired with the source slice that runs
// when it's invoked.
function handlerBodies(contents) {
  const starts = [...contents.matchAll(handlerPattern)].map((match) => ({
    method: match[1],
    index: match.index,
  }));
  return starts.map((start, i) => ({
    method: start.method,
    body: contents.slice(start.index, starts[i + 1]?.index ?? contents.length),
  }));
}

async function checkTestRouteGuards() {
  const absoluteDir = path.join(ROOT, TEST_ROUTE_DIR);
  let entries;
  try {
    entries = await readdir(absoluteDir, { recursive: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { count: 0, problems: [] };
    throw error;
  }

  const routeFiles = entries
    .filter((entry) => entry.endsWith("route.ts"))
    .map((entry) => path.join(TEST_ROUTE_DIR, entry))
    .sort();

  const problems = [];
  for (const relativePath of routeFiles) {
    const contents = await readFile(path.join(ROOT, relativePath), "utf8");
    if (!guardImportPattern.test(contents)) {
      problems.push(
        `${relativePath}: does not import e2eTestRouteAuthorized from @/lib/e2e-test-routes`,
      );
      continue;
    }
    const handlers = handlerBodies(contents);
    if (handlers.length === 0) {
      problems.push(
        `${relativePath}: exports no ${HTTP_METHODS.join("/")} handler this check can see`,
      );
      continue;
    }
    for (const handler of handlers) {
      if (!guardCallPattern.test(handler.body)) {
        problems.push(
          `${relativePath}: ${handler.method} never calls e2eTestRouteAuthorized(request)`,
        );
      }
    }
  }
  return { count: routeFiles.length, problems };
}

async function main() {
  const testRoutes = await checkTestRouteGuards();

  const absoluteDir = path.join(ROOT, E2E_DIR);
  let entries = [];
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log("check:e2e-fixtures: no e2e/ directory, no specs to check");
    } else {
      throw error;
    }
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

  if (badImports.length > 0 || unwrappedPages.length > 0 || testRoutes.problems.length > 0) {
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
    if (testRoutes.problems.length > 0) {
      console.error("check:e2e-fixtures: /api/test route handler(s) without the shared guard:");
      for (const problem of testRoutes.problems) console.error(`  - ${problem}`);
      console.error(
        "Open every handler with: if (!e2eTestRouteAuthorized(request)) " +
          'return NextResponse.json({ error: "not_available" }, { status: 404 });',
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `check:e2e-fixtures: ok — ${specFiles.length} spec files import from ./fixtures, ` +
      `${testRoutes.count} /api/test route files guarded`,
  );
}

await main();
