import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **A guide's URL data is read behind a `<Suspense>` boundary, never in the
 * page itself** (issue #2546, ADR 20260804-instant-navigation).
 *
 * With Partial Prefetching the App Shell is one artifact shared by every
 * guide. A page that awaited `params` at its top answered 200 until its cached
 * shell revalidated and then 500 (`NEXT_STATIC_GEN_BAILOUT`): the background
 * re-prerender had no boundary to postpone at. The failure shows only after
 * the default fifteen-minute revalidate, so no focused e2e spec reaches it;
 * this reads the page source, which is where the mistake is made.
 */

const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

/** The text of one top-level function, from its signature to the next top-level declaration. */
function functionBody(signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} is in page.tsx`).toBeGreaterThan(-1);
  const rest = source.slice(start + signature.length);
  const next = rest.search(/\n(?:export )?(?:async )?(?:function|const) /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("/switching/[competitor] page shell", () => {
  it("does not await params in the page function", () => {
    expect(source).toContain("export default function MigrationGuidePage(");
    expect(functionBody("export default function MigrationGuidePage(")).not.toMatch(/await\s/);
  });

  it("hands the params promise to a child inside a Suspense boundary", () => {
    const page = functionBody("export default function MigrationGuidePage(");
    expect(page).toMatch(
      /<Suspense fallback=\{<GuideShell \/>\}>\s*<GuideRoute params=\{params\} \/>\s*<\/Suspense>/,
    );
  });

  it("reads params only in the child", () => {
    const awaits = source.match(/await params/g) ?? [];
    // generateMetadata reads it too; the page's own read is GuideRoute's.
    expect(awaits).toHaveLength(2);
    expect(functionBody("async function GuideRoute(")).toContain("await params");
  });
});
