import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The two invariants that keep navigation instant, as a test (ADR
 * 20260804-instant-navigation).
 *
 * `next build` already enforces the important half of this — a route with no
 * `instant = false` above it must produce a non-empty static shell, or the
 * build fails with `blocking-prerender-dynamic` naming the offending
 * component. That is the real gate and this does not replace it. What this
 * adds is speed and a *reason*: the build says "this route blocks", it does not
 * say "because someone put an `await` in a layout", and it takes minutes rather
 * than the second `pnpm check` can spare. A page that loses its boundary should
 * fail before anyone waits for a build to tell them.
 *
 * It is deliberately a text scan over the route tree, the same trade
 * `src/i18n/provider-coverage.test.ts` makes: there is no way to ask React
 * "did this render behind a boundary", and booting the app per route is not
 * something a unit suite can afford. It under-reports rather than over-reports
 * — a page whose own `<Suspense>` sits around only half its reads passes here
 * and fails the build, which is the right way round.
 */

const APP = path.join(process.cwd(), "src/app");

/**
 * Layouts allowed to be async, each because something in them must resolve
 * before `{children}` renders and no `<Suspense>` boundary can sit between the
 * two. Every entry declares `instant = false` (asserted below) and carries its
 * own comment saying why. Adding to this list is a decision, not a fix.
 */
const BLOCKING_LAYOUTS = new Set([
  "shop/[shopSlug]/layout.tsx",
  "shop/[shopSlug]/waivers/layout.tsx",
  "shop/[shopSlug]/trips/[id]/layout.tsx",
]);

/**
 * Line comments go first, then block comments — the opposite of the order that
 * reads naturally, and deliberate. A `//` comment mentioning a route glob
 * (`/shop` followed by a double star) contains the characters that open a block
 * comment, so stripping blocks first swallows everything from that word to the
 * next block terminator — in a page file, most of the module. Comments describe
 * this rule as often as they break it; neither should hide a missing declaration.
 */
function stripComments(source: string): string {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function routeFiles(name: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === name) found.push(full);
    }
  }
  await walk(APP);
  return found.sort();
}

const relative = (file: string) => path.relative(APP, file).replaceAll(path.sep, "/");

/** Does this segment, or any segment above it, provide a `loading.tsx`? */
async function hasBoundaryAbove(pageFile: string): Promise<boolean> {
  for (let directory = path.dirname(pageFile); ; directory = path.dirname(directory)) {
    const siblings = await readdir(directory);
    if (siblings.includes("loading.tsx")) return true;
    if (directory === APP) return false;
  }
}

describe("instant navigation", () => {
  it("gives every page a Suspense boundary and an explicit instant claim", async () => {
    const pages = await routeFiles("page.tsx");
    // Guards the guard: an empty walk would make every assertion below vacuous.
    expect(pages.length).toBeGreaterThan(40);

    const failures: string[] = [];
    for (const file of pages) {
      const source = stripComments(await readFile(file, "utf8"));
      const where = relative(file);

      // A page that only redirects never paints, so it has nothing to be
      // instant about — `blockers/page.tsx` is the whole of this category.
      if (/\b(permanentRedirect|redirect)\(/.test(source) && !source.includes("return (")) continue;

      if (!/export const instant\s*=\s*true/.test(source)) {
        failures.push(`${where}: no \`export const instant = true\` — see ADR 20260804`);
      }
      // Either the segment tree provides a `loading.tsx`, or the page places
      // its own boundaries (which is finer-grained and strictly better).
      if (!source.includes("<Suspense") && !(await hasBoundaryAbove(file))) {
        failures.push(
          `${where}: no loading.tsx in this segment or above, and no <Suspense> inside`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps layouts synchronous, so no route loses its static shell to one", async () => {
    const layouts = await routeFiles("layout.tsx");
    expect(layouts.length).toBeGreaterThan(5);

    const failures: string[] = [];
    for (const file of layouts) {
      const source = stripComments(await readFile(file, "utf8"));
      const where = relative(file);
      const isAsync = /export default async function/.test(source);
      const optsOut = /export const instant\s*=\s*false/.test(source);

      if (isAsync && !BLOCKING_LAYOUTS.has(where)) {
        failures.push(
          `${where}: async layout. A layout wraps {children}, so nothing can Suspend between ` +
            `them and this costs every route below it its static shell. Move the read into an ` +
            `async child inside its own <Suspense>, or add it to BLOCKING_LAYOUTS with a reason.`,
        );
      }
      if (optsOut && !BLOCKING_LAYOUTS.has(where)) {
        failures.push(`${where}: declares instant = false but is not a known blocking shell`);
      }
      if (BLOCKING_LAYOUTS.has(where) && !optsOut) {
        failures.push(`${where}: listed as a blocking shell but does not declare instant = false`);
      }
    }
    expect(failures).toEqual([]);
  });
});
