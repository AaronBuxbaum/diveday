import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **One shop read per pass on the public storefront** (issue #1737).
 *
 * `/s/**` is the surface a stranger loads most often, and it used to resolve
 * its slug five times per render of `/s/<slug>`: the brand, the header chrome
 * and the footer each read it inside their own `<Suspense>` boundary in
 * `[shopSlug]/_components/PublicShopShell.tsx`, and the page under them read it
 * again in `generateMetadata` and once more in its body. The pool is capped at
 * five connections per instance, so one storefront render could hold the lot
 * for a row that cannot have changed between the first read and the last.
 *
 * They share one memoized read now, `shopBySlugCached`
 * (`src/db/shops-cached.ts`). None of these components can hand the row to the
 * next, so the only thing keeping the count down is that every render-path
 * caller asks the same reader: a convention on a hot path, held here. Moved
 * from `src/app/s/shop-read-coverage.test.ts` (test review 2026-10-14, L2c).
 */

export const NAMESPACE = "src/app/s";
export const SHELL = "src/app/s/[shopSlug]/_components/PublicShopShell.tsx";

/**
 * Paths where the *unmemoized* `getShopBySlug` is the correct reader:
 *
 * - `actions.ts` — a mutation reads the shop inside its own transaction, and
 *   `cache()` keys on arguments, not on the executor, so a memoized read would
 *   hand a transaction the pool's snapshot.
 * - `route.ts` / `route.tsx` / `opengraph-image.tsx` — each is its own
 *   request, with no second reader in the pass to share with.
 */
export const EXEMPT = /(?:actions\.ts|route\.tsx?|opengraph-image\.tsx)$/;

/** What is wrong with one file under the namespace, by path and source. */
export function shopReadProblems(file, source) {
  if (/actions\.ts$/.test(file) && /\bshopBySlugCached\b/.test(source)) {
    return [
      `${file}: an action reads the shop inside its own transaction and may re-read it after a write; use getShopBySlug(dbi, slug), not the render's memo`,
    ];
  }
  if (!EXEMPT.test(file) && /\bgetShopBySlug\b/.test(source)) {
    return [
      `${file}: reads the shop with the unmemoized getShopBySlug, so this render pays for the row again; use shopBySlugCached from @/db/shops-cached`,
    ];
  }
  return [];
}

/** The shell's own readers: chrome, footer and brand, each through the memo. */
export function shellProblems(source) {
  const readers = source.match(/\bshopBySlugCached\(/g)?.length ?? 0;
  return readers === 3
    ? []
    : [
        `${SHELL}: expected the chrome, footer and brand to read through shopBySlugCached (3), found ${readers}`,
      ];
}

async function walk(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Every problem under `root`, and how many files were read. */
export async function storefrontShopReads(root = process.cwd()) {
  const files = (await walk(path.join(root, NAMESPACE))).sort();
  const problems = [];
  if (files.length < 20)
    problems.push(`found only ${files.length} files under ${NAMESPACE}; the walk is broken`);
  for (const file of files) {
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    problems.push(...shopReadProblems(rel, await readFile(file, "utf8")));
  }
  problems.push(...shellProblems(await readFile(path.join(root, SHELL), "utf8")));
  return { problems, files: files.length };
}

async function main() {
  const { problems, files } = await storefrontShopReads();
  if (problems.length > 0) {
    console.error(
      `Storefront shop reads off the memo:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(`shop-reads: ${files} storefront files read the shop through one memo`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
