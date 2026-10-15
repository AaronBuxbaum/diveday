import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **No staff redirect builds its `Location` out of a raw slug** (issue 1569).
 *
 * `shopSlug` reaches a route handler as a path segment Next has already
 * decoded, so a `?` or a `#` in it turns the rest of a hand-built `Location`
 * into that segment's own query or fragment, and `../` normalises the `/shop/`
 * prefix away entirely. `shopPath` (`src/lib/staff-notices.ts`) exists for
 * exactly this and escapes every segment. Five handlers hand-built the string;
 * one of them encoded the slug and four did not, which is the shape of a rule
 * that lives in one file's memory rather than in a check. A text scan: it
 * under-reports rather than over-reports. Moved from
 * `src/app/shop/redirect-slug-coverage.test.ts` (test review 2026-10-14, L2c).
 */

export const STAFF_APP = "src/app/shop";

/** `Location: ` followed by a template literal that interpolates a bare slug. */
export const RAW_SLUG_LOCATION = /Location:\s*[^,\n]*`[^`]*\$\{\s*shopSlug\s*\}/;

/** `source` with its comments out, keeping a `//` straight after a colon (a URL). */
export function stripComments(source) {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** True when a route handler's source builds a `Location` from a raw slug. */
export function buildsRawSlugLocation(source) {
  return RAW_SLUG_LOCATION.test(stripComments(source));
}

async function routeHandlers(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await routeHandlers(full, found);
    else if (entry.name === "route.ts") found.push(full);
  }
  return found;
}

/** Every problem under `root`, and how many handlers were read. */
export async function redirectSlugProblems(root = process.cwd()) {
  const app = path.join(root, STAFF_APP);
  const handlers = (await routeHandlers(app)).sort();
  const problems = [];
  if (handlers.length < 5)
    problems.push(`found only ${handlers.length} route handlers; the walk is broken`);
  for (const file of handlers) {
    if (!buildsRawSlugLocation(await readFile(file, "utf8"))) continue;
    problems.push(
      `${path.relative(root, file).replaceAll(path.sep, "/")}: builds a Location from a raw \`\${shopSlug}\`. Use shopPath(shopSlug, …) from @/lib/staff-notices, which escapes each segment — a slug carrying ? or # rewrites the rest of the URL (issue 1569).`,
    );
  }
  return { problems, handlers: handlers.length };
}

async function main() {
  const { problems, handlers } = await redirectSlugProblems();
  if (problems.length > 0) {
    console.error(
      `Staff redirects built from a raw slug:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `redirect-slugs: ${handlers} staff route handlers build every Location through shopPath`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
