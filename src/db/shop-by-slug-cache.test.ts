import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

/**
 * **What `shopBySlugCached` actually saves, measured** (issue #1737).
 *
 * The reader exists so a diver-facing `/s/**` render resolves its shop slug
 * once instead of five times. The part worth measuring rather than assuming is
 * the scope: the three readers in
 * `src/app/s/[shopSlug]/_components/PublicShopShell.tsx` sit behind three
 * *separate* `<Suspense>` boundaries, and this repository has already measured
 * one place where React's `cache()` does **not** bridge a gap that looks just
 * like it — `inHorizonReadiness` (`src/db/blockers.ts`, issue #1121), where the
 * staff shell and the page under it turned out to be two scopes and a memo
 * bought nothing. Shipping a second memo on that evidence without checking
 * which kind of gap this one is would be guessing.
 *
 * So it is checked, in a child process, because React ships two builds of
 * itself and only the `react-server` one memoizes: the client build's
 * `cache()` — the build Vitest resolves — calls straight through, so a test
 * that imported the reader here would count three reads no matter what the
 * framework does. `./request-cache-scope.probe.mjs` runs React's own Flight
 * server under `--conditions react-server` and counts.
 *
 * It measures the *mechanism*, with a one-argument memoized reader standing in
 * for this one; the assertions below pin the shipped reader to that same shape,
 * which is the half a stand-in cannot cover.
 */

const REPO = path.join(__dirname, "..", "..");
const PROBE = path.join(__dirname, "request-cache-scope.probe.mjs");
const SHOPS = readFileSync(path.join(__dirname, "shops.ts"), "utf8");

/**
 * The lines of `shops.ts` that mention either reader or React, and nothing
 * else. Asserting over the whole 700-line module means a failure prints the
 * whole 700-line module, which buries the one line that moved.
 */
const READER_LINES = SHOPS.split("\n")
  .filter((line) => /getShopBySlug|shopBySlugCached|"react"/.test(line) && !line.startsWith(" *"))
  .join("\n");

function cacheScope(): Record<string, number> {
  const stdout = execFileSync(process.execPath, ["--conditions", "react-server", PROBE], {
    cwd: REPO,
    encoding: "utf8",
  });
  return JSON.parse(stdout);
}

describe("React's cache() across the public shell's boundaries", () => {
  const counts = cacheScope();

  it("reads one row for the layout's three boundaries", () => {
    // The brand, the chrome and the footer, each inside its own <Suspense>,
    // with the page's position between the second and the third. A boundary is
    // not a new cache scope — a render is.
    expect(counts.shell).toBe(1);
    expect(counts.nested).toBe(1);
  });

  it("reads one row for generateMetadata and the page body together", () => {
    expect(counts.page).toBe(1);
  });

  it("reads again in a second pass, which is why five became two and not one", () => {
    // The honest ceiling. Under Cache Components the App Shell and the page it
    // wraps render in separate passes (`src/db/blockers.ts`), so the layout's
    // one read and the page's one read stay two. Anything that claimed one
    // query per public render would be claiming this number is 1.
    expect(counts.twoPasses).toBe(2);
  });

  it("never serves one shop's row to another shop's slug", () => {
    expect(counts.twoSlugs).toBe(2);
  });
});

describe("the shipped reader has the shape the measurement covers", () => {
  it("is memoized with React's cache and takes only the slug", () => {
    expect(READER_LINES).toContain('import { cache } from "react";');
    expect(READER_LINES).toMatch(
      /export const shopBySlugCached = cache\(async \(slug: string\) =>\s*getShopBySlug\(await getDb\(\), slug\),?\s*\);/,
    );
  });

  it("leaves getShopBySlug taking an executor, unmemoized", () => {
    // The trap this reader exists to avoid: `cache()` keys on argument
    // identity, and several `/s/**` callers hand `getShopBySlug` a
    // transaction. Memoizing that signature would either miss on every
    // transaction handle or serve a pool-read row to a caller that must see
    // its own transaction's snapshot.
    expect(READER_LINES).toContain(
      "export async function getShopBySlug(db: AppDb, slug: string) {",
    );
    expect(READER_LINES).not.toMatch(/cache\(\s*getShopBySlug/);
    expect(READER_LINES).not.toMatch(/cache\(async \([^)]*\bdb\b[^)]*\)/);
  });
});
