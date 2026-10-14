import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `src/components`, found from this file rather than counted up from a route. */
const SHARED_COMPONENTS = path.join(import.meta.dirname, "..", "components");

/**
 * **A route's source file, wherever a split put it**, for the composition tests that pin what a
 * page renders by reading its source (`page.composition.test.ts`).
 *
 * A split moves a section out of `page.tsx` into the route's `_components/`, or a component up
 * into `src/components`; the pin should follow it without the test counting `..` segments to
 * get there. Four tests each carried their own copy of this, counting three, five and six
 * levels (2026-10-13 review). The file is looked for beside the test, then in its
 * `_components/`, then in `src/components`, and a miss names every place it looked.
 *
 * @param from the test's `import.meta.url` or `import.meta.dirname`
 * @param file a name such as `"page.tsx"`, `"TripHero.tsx"` or `"_lib/page-reads.ts"`
 */
export function routeSource(from: string, file: string): string {
  const directory = from.startsWith("file:") ? path.dirname(fileURLToPath(from)) : from;
  const candidates = [
    path.join(directory, file),
    path.join(directory, "_components", file),
    path.join(SHARED_COMPONENTS, file),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`${file} is in none of: ${candidates.join(", ")}`);
  }
  return readFileSync(found, "utf8");
}
