import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
 *    wipes and reseeds, and `seed-private-shop` mints a whole tenant whose
 *    staff sign in with a published password. All six call the guard today;
 *    nothing made the next
 *    one do so, and a missed guard plus one misconfigured deployment is
 *    account takeover (the finding behind the guard —
 *    docs/product/archive/specialist-optimization-audit-20260731.md §5).
 * 4. Every one of those **handlers** — not routes: `(path, method)` pairs —
 *    must also be registered in `src/app/api/test/seed-routes.test.ts`'s shared
 *    table, which is the only thing that proves the guard refuses *before* the
 *    route reads a body or opens the database. Check 3 is satisfied by a route
 *    that parses a body, resolves a shop and only then asks about the bearer —
 *    and such a route answers differently for a real slug than for a nonsense
 *    one, which is an oracle on a door that is supposed to be shut. The table
 *    was hand-maintained and had drifted five routes short while check 3's
 *    count read as complete (issue #1791). The registration is checked here;
 *    the refusal itself stays in the test, because what it proves is that
 *    `getDb` was never reached, and that has to be exercised rather than
 *    grepped.
 *
 *    **Per handler, because a directory is not a door.** A first cut of this
 *    keyed on the directory alone, and one row then vouched for every verb in
 *    it — `seed-year-band-shop`'s `DELETE`, which drops a whole seeded shop,
 *    was unproven while its `POST` was registered (`security-reviewer`,
 *    2026-09-13). And the path is every segment under `api/test`, not the last
 *    one, so a nested `reset` cannot inherit the exemption below.
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
const SEED_ROUTE_TABLE = "src/app/api/test/seed-routes.test.ts";
/**
 * The two routes the shared table deliberately leaves out, with the reason its
 * own docblock gives: `reset` has its own colocated `route.test.ts` covering
 * the same refusal *and* its success path, and `clock` is the fleet's frozen
 * clock, which the docblock records the fleet never calls. Anything else
 * missing is drift.
 */
const UNREGISTERED_BY_DESIGN = new Set(["reset", "clock"]);
/** `POST /api/test/seed-thing` as the table and this guard both spell it. */
const handlerKey = (routePath, method) => `${method} ${routePath}`;
/**
 * `slug: "seed-thing",` in the table above, and the optional `method: "DELETE",`
 * beside it — an entry with no `method` is a `POST`, which is what the table's
 * own default says.
 *
 * Line-anchored, so a slug quoted inside one of the table's docblocks — several
 * of which name sibling routes while explaining an expectation — cannot read as
 * a registration and hide the drift this exists to catch. The optional `{` and
 * the optional trailing comma are for an entry written on one line: Biome would
 * split it on the next format pass, but the guard should not answer differently
 * in the window before that.
 */
const tableSlugPattern = /^\s*(?:\{\s*)?slug:\s*"([^"]+)",?/gm;
const tableMethodPattern = /^\s*method:\s*"([A-Z]+)",?/m;
/** `const routes: SeedRoute[] = [` down to the line that closes it. */
const tableOpenPattern = /^const routes:\s*SeedRoute\[\]\s*=\s*\[$/m;

function tableLiteral(source) {
  const open = tableOpenPattern.exec(source);
  if (!open) return "";
  const rest = source.slice(open.index + open[0].length);
  const close = /^\];$/m.exec(rest);
  return close ? rest.slice(0, close.index) : rest;
}
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
  const routeHandlers = [];
  for (const relativePath of routeFiles) {
    // Every segment under `api/test`, not the last one: a nested `reset/` would
    // otherwise inherit the exemption above, and a nested `seed-gift/` would
    // read as registered though its URL is one no test ever calls.
    const routePath = path.dirname(path.relative(TEST_ROUTE_DIR, relativePath));
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
      routeHandlers.push({ routePath, method: handler.method });
      if (!guardCallPattern.test(handler.body)) {
        problems.push(
          `${relativePath}: ${handler.method} never calls e2eTestRouteAuthorized(request)`,
        );
      }
    }
  }
  for (const problem of await unregisteredRoutes(routeHandlers)) problems.push(problem);
  return { count: routeFiles.length, handlers: routeHandlers.length, problems };
}

/**
 * Route directories with no entry in the shared refusal table.
 *
 * Keyed on the directory name, which is what the table's `slug` holds and what
 * the URL carries — a route file's path is the only spelling both sides agree
 * on without importing anything.
 */
export function registeredHandlers(tableSource) {
  // **The array literal only.** Below it the file has `describe` blocks that
  // build requests of their own — `method: "DELETE"` among them — and the last
  // entry's slice would otherwise run to the end of the file and read one of
  // those as its own verb. That is not theoretical: it is what this guard did
  // on its first run against the real table.
  const table = tableLiteral(tableSource);
  // Split on the slug line rather than matching an entry whole: the table
  // interleaves long docblocks between its fields, and an entry's `method:`
  // is simply whatever follows its own slug and precedes the next one.
  const starts = [...table.matchAll(tableSlugPattern)];
  return new Set(
    starts.map((match, index) => {
      const body = table.slice(match.index, starts[index + 1]?.index ?? table.length);
      return handlerKey(match[1], tableMethodPattern.exec(body)?.[1] ?? "POST");
    }),
  );
}

/**
 * Handlers with no entry in the shared refusal table.
 *
 * Keyed on the route's path under `api/test` and the verb it answers on — the
 * two things the table's `slug` and `method` hold, and the two things the URL
 * carries. A route file's path is the only spelling both sides agree on
 * without importing anything.
 */
export function unregisteredHandlers(routeHandlers, tableSource) {
  const registered = registeredHandlers(tableSource);
  return routeHandlers
    .filter(
      ({ routePath, method }) =>
        !registered.has(handlerKey(routePath, method)) && !UNREGISTERED_BY_DESIGN.has(routePath),
    )
    .map(({ routePath, method }) => handlerKey(routePath, method))
    .sort();
}

async function unregisteredRoutes(routeHandlers) {
  let table;
  try {
    table = await readFile(path.join(ROOT, SEED_ROUTE_TABLE), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [`${SEED_ROUTE_TABLE}: missing — nothing proves these routes refuse before they read`];
    }
    throw error;
  }
  return unregisteredHandlers(routeHandlers, table).map(
    (key) =>
      `${key}: not registered in ${SEED_ROUTE_TABLE}, so nothing proves ` +
      `it refuses before it reads a body or opens the database`,
  );
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
      console.error("check:e2e-fixtures: /api/test route problem(s):");
      for (const problem of testRoutes.problems) console.error(`  - ${problem}`);
      console.error(
        "Open every handler with: if (!e2eTestRouteAuthorized(request)) " +
          'return NextResponse.json({ error: "not_available" }, { status: 404 });',
      );
      console.error(
        `…and add a row for it to ${SEED_ROUTE_TABLE} — one per verb, with the expectation its ` +
          "own code earns past the guard (an invalid body, a 200, or getDb having been reached).",
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `check:e2e-fixtures: ok — ${specFiles.length} spec files import from ./fixtures, ` +
      `${testRoutes.count} /api/test route files guarded, ${testRoutes.handlers} handlers registered`,
  );
}

// Importable for its own test without running the whole sweep.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
