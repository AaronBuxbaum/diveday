import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **One shop read per pass on the public storefront** (issue #1737).
 *
 * `/s/**` is the surface a stranger loads most often, and it used to resolve
 * its slug five times per render of `/s/<slug>`: the brand, the header chrome
 * and the footer each read it inside their own `<Suspense>` boundary in
 * `[shopSlug]/_components/PublicShopShell.tsx`, and the page under them read it
 * again in `generateMetadata` and once more in its body. The pool is capped at
 * five connections per instance (`DEFAULT_POOL_MAX`), so one storefront render
 * could hold the lot for a row that cannot have changed between the first read
 * and the last.
 *
 * They share one memoized read now — `shopBySlugCached` (`src/db/shops.ts`),
 * whose scope is measured in `src/db/shop-by-slug-cache.test.ts`. What this
 * file stops is the sixth reader: none of these components can hand the row to
 * the next (separate boundaries, and a prop would need a read above
 * `{children}`, which is the one position that costs every route beneath this
 * layout its static shell), so the only thing keeping the count down is that
 * every render-path caller asks the same reader. That is a convention, and a
 * convention on a hot path is worth a test.
 *
 * A text scan, for the reason `src/app/instant-coverage.test.ts` gives at
 * length: there is no way to ask React how many times a render read a row, and
 * booting the route tree per route is not something a unit suite can afford.
 */

const NAMESPACE = path.join(process.cwd(), "src/app/s");

/**
 * Paths where the *unmemoized* `getShopBySlug` is the correct reader, each
 * because the memo would be wrong rather than merely useless:
 *
 * - `actions.ts` — a mutation, which reads the shop inside its own
 *   transaction (`trips/[id]/actions.ts`'s `shopNow`). `cache()` keys on
 *   arguments, not on the executor, so a memoized read would hand a
 *   transaction the pool's snapshot, and a re-read after a write would hand
 *   back the row from before it.
 * - `route.ts` / `route.tsx` / `opengraph-image.tsx` — each is its own
 *   request, fetched separately from the document. There is no second reader
 *   in the pass to share with, so a memo would add an indirection and save
 *   nothing.
 */
const EXEMPT = /(?:actions\.ts|route\.tsx?|opengraph-image\.tsx)$/;

async function namespaceFiles(): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
    }
  }
  await walk(NAMESPACE);
  return found.sort();
}

const relative = (file: string) => path.relative(process.cwd(), file).replaceAll(path.sep, "/");

describe("the public storefront's shop read", () => {
  it("goes through the memoized reader everywhere a render can share it", async () => {
    const offenders: string[] = [];
    for (const file of await namespaceFiles()) {
      if (EXEMPT.test(file)) continue;
      const source = await readFile(file, "utf8");
      if (/\bgetShopBySlug\b/.test(source)) offenders.push(relative(file));
    }
    expect(
      offenders,
      "these read the shop with the unmemoized getShopBySlug, so this render pays for the row again — " +
        "use shopBySlugCached from @/db/shops",
    ).toEqual([]);
  });

  it("keeps the memo out of the mutation paths, where a stale row is a wrong answer", async () => {
    const offenders: string[] = [];
    for (const file of await namespaceFiles()) {
      if (!/actions\.ts$/.test(file)) continue;
      const source = await readFile(file, "utf8");
      if (/\bshopBySlugCached\b/.test(source)) offenders.push(relative(file));
    }
    expect(
      offenders,
      "an action reads the shop inside its own transaction and may re-read it after a write — " +
        "both need getShopBySlug(dbi, slug), not the render's memo",
    ).toEqual([]);
  });

  it("covers the three readers in the shell that this is really about", async () => {
    const shell = await readFile(
      path.join(NAMESPACE, "[shopSlug]/_components/PublicShopShell.tsx"),
      "utf8",
    );
    // Chrome, footer and brand. If a fourth band arrives it reads through the
    // same door or the first assertion above fails.
    expect(shell.match(/\bshopBySlugCached\(/g)).toHaveLength(3);
  });
});
