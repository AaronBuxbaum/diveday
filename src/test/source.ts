import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * **The repository's own source, read as text**, for the tests that hold a
 * rule over every file in a tree (`src/test/projects.ts` keeps a file that
 * imports only this, Node and Vitest in the `guards` project).
 *
 * One home for the two helpers fifteen test files used to spell for
 * themselves (test review 2026-10-14, A§3a).
 */

/** Every `.ts`/`.tsx` file under `dir`, recursively, test files left out. Absolute paths. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * `source` with its `//` line comments and block comments taken out, so a
 * sentence about a rule is never read as the rule. A `//` straight after a
 * colon is kept, because that is a URL (`https://`), not a comment.
 */
export function stripComments(source: string): string {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}
