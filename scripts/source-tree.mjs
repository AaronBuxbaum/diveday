import { readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { filesUnder } from "./files-under.mjs";

/**
 * **The repository's source tree, read once** (issue #2775): the walks, the
 * route rules and the comment rules that guards and `*.test.ts` rule tests used
 * to write for themselves. Importable from a `.mjs` guard and from a Vitest
 * file alike (`src/test/source.ts` re-exports the test-side names).
 */

/**
 * Every source file under `dir`, recursively, as absolute paths. `.ts`/`.tsx`
 * and no test files unless told otherwise. A missing directory is empty.
 */
export function sourceFiles(dir, { ext = [".ts", ".tsx"], skipTests = true } = {}) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, { ext, skipTests });
    if (!ext.includes(path.extname(entry.name))) return [];
    if (skipTests && /\.test\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return [full];
  });
}

/**
 * `source` with its `//` line comments and block comments taken out, so a
 * sentence about a rule is never read as the rule. A `//` straight after a
 * colon is kept, because that is a URL (`https://`), not a comment.
 */
export function withoutComments(source) {
  return source.replace(/(^|[^:])\/\/[^\n]*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** A route group, `(token)`: a folder that organises routes and adds nothing to the URL. */
export const isRouteGroup = (segment) => /^\(.+\)$/.test(segment);

/** A private folder, `_components`: never a route, however many pages it holds. */
export const isPrivateFolder = (segment) => segment.startsWith("_");

/**
 * **Every route a `page.tsx` makes under `src/app`**, sorted by path, with the
 * rules written once: a page under a `_private` folder is not a route, and a
 * `(group)` folder is in the directory but not in the URL.
 *
 * - `page`: repo-relative path of the `page.tsx`.
 * - `directory`: the folder holding it, repo-relative.
 * - `route`: that folder relative to `appRoot` (`"."` for the home page).
 * - `segments`: the route's folders, groups included, as they sit on disk.
 * - `url`: the path a visitor types, groups folded away (`"/"` for the home page).
 * - `has(name)`: whether a sibling file of that name exists.
 */
export async function pageRoutes(root = process.cwd(), appRoot = "src/app") {
  const files = await filesUnder(appRoot, (relative) =>
    readdir(path.join(root, relative), { withFileTypes: true }),
  );
  const fileSet = new Set(files);
  return files
    .filter((file) => path.basename(file) === "page.tsx")
    .sort()
    .flatMap((page) => {
      const directory = path.dirname(page);
      const route = path.relative(appRoot, directory) || ".";
      const segments = route === "." ? [] : route.split(path.sep);
      if (segments.some(isPrivateFolder)) return [];
      const url = `/${segments.filter((segment) => !isRouteGroup(segment)).join("/")}`;
      return [
        {
          page,
          directory,
          route,
          segments,
          url,
          has: (name) => fileSet.has(path.join(directory, name)),
        },
      ];
    });
}

/**
 * **An inline exemption, `diveday:allow-<rule>: <why>`**, read from `text`
 * (ADR 20260806-destructive-migration-guard's grammar). A marker with no reason
 * is not an exemption: it comes back `empty`, and the guard says so.
 *
 * @returns {{ status: "none" } | { status: "empty" } | { status: "allowed", reason: string }}
 */
export function allowMarker(ruleId, text) {
  const escaped = ruleId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`diveday:allow-${escaped}(?![\\w-])([^\\n]*)`));
  if (!match) return { status: "none" };
  const reason = match[1]
    .replace(/^\s*:/, "")
    .replace(/\*\/\s*$|-->\s*$/, "")
    .trim();
  return match[1].trimStart().startsWith(":") && reason
    ? { status: "allowed", reason }
    : { status: "empty" };
}
