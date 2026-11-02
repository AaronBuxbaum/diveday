/**
 * **The repository's own source, read as text**, for the tests that hold a
 * rule over every file in a tree (`src/test/projects.ts` keeps a file that
 * imports only this, Node and Vitest in the `guards` project).
 *
 * The walk and the comment rule live in `scripts/source-tree.mjs`, which the
 * `.mjs` guards share (issue #2775); this file is their name on the test side.
 */
import { sourceFiles as walkSourceFiles, withoutComments } from "../../scripts/source-tree.mjs";

/** Every `.ts`/`.tsx` file under `dir`, recursively, test files left out. Absolute paths. */
export function sourceFiles(dir: string): string[] {
  return walkSourceFiles(dir);
}

/**
 * `source` with its `//` line comments and block comments taken out, so a
 * sentence about a rule is never read as the rule. A `//` straight after a
 * colon is kept, because that is a URL (`https://`), not a comment.
 */
export const stripComments: (source: string) => string = withoutComments;
