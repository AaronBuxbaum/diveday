import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `src/db/client.ts` is the module every route that touches the database
 * imports, and it is the one that opens, migrates and seeds that database. It
 * once sat inside a strongly connected component of 32 `src/db` files: it
 * imported the demo bootstrap (`./demo-refresh`, and `./seed` dynamically),
 * whose graph reached back into it for `queryAll` and the constraint-violation
 * readers. A cycle through the module that owns boot order makes evaluation
 * order an accident of which file a route happened to import first, and makes
 * every db module look like a dependency of every other one.
 *
 * The bootstrap now lives in `./dev-bootstrap` and the helpers in
 * `./query-helpers`. This walks the runtime import edges between `src/db`
 * modules (static, re-export and dynamic `import()`; type-only imports are
 * erased by the compiler and cannot affect evaluation order, so they are not
 * edges) and fails if any path from `client.ts` leads back to it.
 */

const DB_DIR = path.resolve(__dirname);

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function resolveSpecifier(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier === "@/db" || specifier.startsWith("@/db/")) {
    base = path.join(DB_DIR, specifier.slice("@/db".length));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(from), specifier);
  } else {
    return undefined;
  }
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (candidate.startsWith(DB_DIR) && existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Runtime import edges of one file: the specifiers whose import survives compilation. */
function runtimeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const staticForm = /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(staticForm)) {
    const clause = match[1].trim();
    if (clause.startsWith("type ")) continue;
    const braces = clause.match(/^\{([\s\S]*)\}$/);
    if (braces) {
      const names = braces[1]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      if (names.length > 0 && names.every((name) => name.startsWith("type "))) continue;
    }
    specifiers.push(match[2]);
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function buildGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of listSources(DB_DIR)) {
    const source = readFileSync(file, "utf8");
    const edges = runtimeSpecifiers(source)
      .map((specifier) => resolveSpecifier(file, specifier))
      .filter((target): target is string => Boolean(target));
    graph.set(file, [...new Set(edges)]);
  }
  return graph;
}

/** One path from `start` back to `start`, or undefined when there is none. */
function findCycleThrough(graph: Map<string, string[]>, start: string): string[] | undefined {
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): string[] | undefined => {
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (next === start) return [...stack, start];
      if (visited.has(next)) continue;
      visited.add(next);
      const found = visit(next);
      if (found) return found;
    }
    stack.pop();
    return undefined;
  };
  return visit(start);
}

describe("src/db import graph", () => {
  it("parses the import forms that create a runtime edge, and skips type-only ones", () => {
    const source = [
      `import { a } from "./a";`,
      `import type { B } from "./b";`,
      `import { type C, type D } from "./c";`,
      `import { type E, f } from "./e";`,
      `export { g } from "./g";`,
      `export type { H } from "./h";`,
      `import "./side-effect";`,
      `const seed = await import("./seed");`,
      `import {\n  multi,\n  line,\n} from "@/db/multi";`,
    ].join("\n");
    expect(runtimeSpecifiers(source).sort()).toEqual(
      ["./a", "./e", "./g", "./side-effect", "./seed", "@/db/multi"].sort(),
    );
  });

  it("finds a planted cycle, and none where there is none", () => {
    const cyclic = new Map([
      ["client", ["bootstrap"]],
      ["bootstrap", ["seed"]],
      ["seed", ["helpers", "client"]],
    ]);
    expect(findCycleThrough(cyclic, "client")).toEqual(["client", "bootstrap", "seed", "client"]);
    const acyclic = new Map([
      ["client", ["bootstrap"]],
      ["bootstrap", ["seed"]],
      ["seed", ["helpers"]],
    ]);
    expect(findCycleThrough(acyclic, "client")).toBeUndefined();
  });

  it("keeps src/db/client.ts out of every import cycle", () => {
    const graph = buildGraph();
    const client = path.join(DB_DIR, "client.ts");
    expect(graph.has(client)).toBe(true);
    const cycle = findCycleThrough(graph, client)?.map((file) => path.relative(DB_DIR, file));
    expect(cycle, `client.ts is in an import cycle: ${cycle?.join(" -> ")}`).toBeUndefined();
  });
});
