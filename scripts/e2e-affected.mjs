#!/usr/bin/env node
// Which Playwright specs a diff can break, so they run before the push instead of after it.
//
// Between 2026-10-09 and 2026-10-12, 47 of the 90 failed CI jobs on the open stack were
// Playwright shards, and nearly every one was deterministic: a change to copy, a route or the
// seed that broke a spec its author never ran — "drop the sightings disclaimer" left
// `sightings.spec.ts` asserting on the sentence; a seeded shift moved and `staffing.spec.ts`
// still expected the old hours; a second "Crew schedule" destination made `search.spec.ts`'s
// locator ambiguous. The verify checklist said "a flow changed: run one spec", and the author
// has no way to know which spec reads the sentence they deleted. Each break then rode up the
// stack, one red Playwright shard per layer above it, until a follow-up "E2E: …" commit.
//
// This reads the diff and names the specs, in two tiers:
//
//   strong — a spec file or e2e helper the diff edits; a spec that contains text the diff
//            removed (a locale value, JSX text, a seed or content literal); a spec that
//            navigates to a route whose own directory the diff edits.
//   reach  — a spec that navigates to a route whose page or layout imports, through any chain,
//            a module the diff edits. Wide by nature (a barrel reaches everything), so
//            `verify-push.mjs` runs it only while the estimated time stays inside a budget.
//
//   node scripts/e2e-affected.mjs [--base <ref>] [--json]
//
// The visual spec is never selected: it asserts nothing, and the capture run is the verify
// skill's section 3. Every git call is a constant argument array plus refs git itself printed.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { gitReader } from "./stack-map.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Specs this selector never picks: the capture run is not a test (verify skill, section 3). */
const NEVER = new Set(["e2e/visual.spec.ts"]);

/** Removed text shorter than this matches too much to mean anything. */
const MIN_FRAGMENT = 12;

/** Files whose string literals are copy a spec may assert on, beyond the locale bundles. */
const LITERAL_SOURCES = /^src\/(?:db\/seed[^/]*\.ts|content\/)/;

const SOURCE_EXT = /\.(?:ts|tsx|mts|mjs|js|jsx)$/;

/** A test file changes no page, so it selects no spec by route or import. */
const TEST_FILE = /\.test\.(?:ts|tsx|mjs)$/;

/**
 * The branch this one is stacked on: the remote `claude/*` ref HEAD contains that is furthest
 * from `origin/main` (the nearest layer below), excluding this branch's own remote. A layer that
 * merges the one below holds it through a second parent, so "contains", not first-parent.
 * Falls back to `origin/main`; null only when git cannot answer at all.
 */
export function stackBase(git) {
  const head = git(["rev-parse", "HEAD"]);
  if (!head) return null;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const own = branch && branch !== "HEAD" ? `origin/${branch}` : null;
  const listed =
    git([
      "for-each-ref",
      "--format=%(refname:short)",
      "--merged",
      "HEAD",
      "refs/remotes/origin/claude",
    ]) ?? "";
  let best = null;
  for (const ref of listed.split("\n").filter(Boolean)) {
    if (ref === own) continue;
    const ahead = Number(git(["rev-list", "--count", `origin/main..${ref}`]));
    if (!Number.isFinite(ahead) || ahead === 0) continue;
    if (!best || ahead > best.ahead) best = { ref, ahead };
  }
  if (best) return best.ref;
  return git(["rev-parse", "--verify", "--quiet", "origin/main"]) ? "origin/main" : null;
}

/** `git diff -U0` text split per file into removed and added lines. */
export function parseDiff(text) {
  const files = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).replace(/^b\//, "");
      current = target === "/dev/null" ? null : target;
      if (current && !files.has(current)) files.set(current, { removed: [], added: [] });
      continue;
    }
    if (line.startsWith("--- ")) {
      const source = line.slice(4).replace(/^a\//, "");
      if (source !== "/dev/null") {
        current = source;
        if (!files.has(current)) files.set(current, { removed: [], added: [] });
      }
      continue;
    }
    if (!current) continue;
    if (line.startsWith("-")) files.get(current).removed.push(line.slice(1));
    else if (line.startsWith("+")) files.get(current).added.push(line.slice(1));
  }
  return files;
}

/** Pieces of a message or literal a spec could quote: split around ICU and template holes. */
function fragmentsOf(value) {
  return value
    .replace(/\\(["'\\])/g, "$1")
    .split(/\$\{[^}]*\}|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|<\/?[a-zA-Z][^>]*>|\\n/)
    .map((piece) => piece.trim())
    .filter(
      (piece) => piece.length >= MIN_FRAGMENT && /[A-Za-z]{3}/.test(piece) && /\s/.test(piece),
    );
}

/**
 * Text a removed line held that a spec might assert on. Locale bundles give their values; a
 * component gives its JSX text; a seed or content module gives its string literals.
 */
export function textOf(file, line) {
  const out = [];
  if (/^src\/i18n\/locales\/en-US\/.*\.json$/.test(file)) {
    const match = line.match(/^\s*"(?:[^"\\]|\\.)*"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (match) out.push(...fragmentsOf(match[1]));
    return out;
  }
  if (!SOURCE_EXT.test(file) || !file.startsWith("src/")) return out;
  if (/\.tsx$/.test(file)) {
    for (const match of line.matchAll(/>([^<>{}]+)</g)) out.push(...fragmentsOf(match[1]));
  }
  if (LITERAL_SOURCES.test(file)) {
    for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`/g)) {
      out.push(...fragmentsOf(match[1] ?? match[2] ?? match[3]));
    }
  }
  return out;
}

/** Removed text fragments the same diff did not add back somewhere. */
export function removedText(files) {
  const removed = new Set();
  const added = [];
  for (const [file, { removed: lines, added: plus }] of files) {
    for (const line of lines) for (const piece of textOf(file, line)) removed.add(piece);
    added.push(...plus);
  }
  const addedText = added.join("\n");
  return [...removed].filter((piece) => !addedText.includes(piece));
}

/**
 * The URL route a file under `src/app/` belongs to, and whether a change to it touches only that
 * page (`exact`) or everything beneath it (a layout, loading state, template).
 */
export function routeOf(file) {
  if (!file.startsWith("src/app/") || TEST_FILE.test(file)) return null;
  const parts = file.slice("src/app/".length).split("/");
  const name = parts.pop();
  const kept = [];
  for (const part of parts) {
    if (part.startsWith("_")) break;
    if (/^\(.*\)$/.test(part) || part.startsWith("@")) continue;
    kept.push(part);
  }
  const route = `/${kept.join("/")}`;
  const broad = /^(?:layout|template|loading|error|not-found)\.tsx?$/.test(name);
  return { route, broad };
}

/** A regex that finds `route` in a spec's source, whether a param is written out or templated. */
export function routePattern({ route, broad }) {
  const PARAM = String.raw`(?:[\w.~%-]+|\$\{[^}]+\})`;
  const segments = route
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      /^\[\[?\.\.\./.test(segment)
        ? String.raw`${PARAM}(?:/${PARAM})*`
        : /^\[.*\]$/.test(segment)
          ? PARAM
          : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
  if (segments.length === 0) return /["'`]\/["'`?#]/;
  // A shallow route ("/s/blue-mantis", "/shop/blue-mantis") is the prefix of every page under it,
  // so only a broad change (its layout) selects deeper URLs, and only from the route itself down.
  const tail = broad ? String.raw`(?=["'\`?#/])` : String.raw`(?=["'\`?#]|/?$)`;
  return new RegExp(String.raw`["'\`]/${segments.join("/")}${tail}`);
}

/** Every spec file, by repository path, with its source. */
export function readSpecs(root = ROOT) {
  const specs = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (rel.endsWith(".spec.ts") && !NEVER.has(rel)) {
        specs.set(rel, readFileSync(path.join(root, rel), "utf8"));
      }
    }
  };
  walk("e2e");
  return specs;
}

/** `src/` modules by path, each with the modules it imports, resolved to repository paths. */
export function importGraph(root = ROOT) {
  const modules = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (SOURCE_EXT.test(rel) && !TEST_FILE.test(rel)) {
        modules.set(rel, readFileSync(path.join(root, rel), "utf8"));
      }
    }
  };
  walk("src");
  const resolve = (from, spec) => {
    let base;
    if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
    else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
    else return null;
    for (const candidate of [
      base,
      ...[".ts", ".tsx", ".js", ".mjs"].map((ext) => base + ext),
      ...["/index.ts", "/index.tsx"].map((ext) => base + ext),
    ]) {
      if (modules.has(candidate)) return candidate;
    }
    return null;
  };
  const graph = new Map();
  for (const [file, source] of modules) {
    const deps = new Set();
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const target = resolve(file, match[1]);
      if (target) deps.add(target);
    }
    graph.set(file, deps);
  }
  return graph;
}

/** Every module that reaches one of `changed` through imports, `changed` included. */
export function importersOf(graph, changed) {
  const reverse = new Map();
  for (const [file, deps] of graph) {
    for (const dep of deps) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(file);
    }
  }
  const seen = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    const next = queue.pop();
    for (const importer of reverse.get(next) ?? []) {
      if (!seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
    }
  }
  return seen;
}

const ENTRY = /\/(?:page|layout|route|template|loading|default)\.tsx?$/;

/**
 * A route more specs than this navigate to is a hub (the shop's home, the staff dashboard, the
 * schedule board): a spec visiting it is usually passing through on its way somewhere else, so
 * it ranks in the reach tier instead of being run unconditionally.
 */
export const HUB_SPECS = 10;

/**
 * The selection. `changed` is every file the diff touches, `diff` its parsed hunks, `specs`
 * every spec's source, `graph` the import graph (or null to skip the reach tier).
 *
 * `strong` maps a spec to why it was picked. `reach` does too, and `rank` gives each reach spec
 * its narrowest route's spec count, so the most specific ones run first inside a budget.
 */
export function selectSpecs({ changed, diff, specs, graph }) {
  const strong = new Map();
  const reach = new Map();
  const rank = new Map();
  const note = (map, spec, why) => {
    if (NEVER.has(spec) || !specs.has(spec)) return;
    if (!map.has(spec)) map.set(spec, new Set());
    map.get(spec).add(why);
  };
  const matching = (pattern) => [...specs].filter(([, source]) => pattern.test(source));
  const noteReach = (spec, why, width) => {
    note(reach, spec, why);
    rank.set(spec, Math.min(rank.get(spec) ?? Number.POSITIVE_INFINITY, width));
  };

  // A spec the diff edits, or one importing an e2e helper the diff edits.
  const helpers = changed.filter((file) => file.startsWith("e2e/") && !file.endsWith(".spec.ts"));
  for (const file of changed) if (file.endsWith(".spec.ts")) note(strong, file, "edited");
  for (const helper of helpers) {
    const stem = path.posix.basename(helper).replace(/\.tsx?$/, "");
    const pattern = new RegExp(String.raw`from\s+["']\./(?:[\w/-]*/)?${stem}["']`);
    for (const [spec] of matching(pattern)) note(strong, spec, helper);
  }

  // Text the diff removed, still quoted by a spec.
  for (const piece of removedText(diff)) {
    for (const [spec, source] of specs) {
      if (source.includes(piece)) note(strong, spec, `quotes "${piece}"`);
    }
  }

  // Routes whose own directory the diff edits; a hub's visitors only rank.
  const routes = new Map();
  for (const file of changed) {
    const route = routeOf(file);
    if (route) routes.set(`${route.route}|${route.broad}`, route);
  }
  for (const route of routes.values()) {
    const hits = matching(routePattern(route));
    for (const [spec] of hits) {
      if (hits.length <= HUB_SPECS) note(strong, spec, route.route);
      else noteReach(spec, `${route.route} (hub)`, hits.length);
    }
  }

  // Routes whose entry files reach an edited module through imports.
  if (graph) {
    const edited = changed.filter((file) => graph.has(file) && !file.startsWith("src/app/"));
    if (edited.length > 0) {
      const reached = new Map();
      for (const file of importersOf(graph, edited)) {
        if (!ENTRY.test(file)) continue;
        const route = routeOf(file);
        if (route) reached.set(route.route, { ...route, broad: false });
      }
      for (const route of reached.values()) {
        const hits = matching(routePattern(route));
        for (const [spec] of hits) noteReach(spec, route.route, hits.length);
      }
    }
  }
  for (const spec of strong.keys()) {
    reach.delete(spec);
    rank.delete(spec);
  }

  return { strong, reach, rank };
}

/**
 * The reach specs to run inside `budgetMs` of recorded CI time, narrowest route first, then
 * shortest; the rest are named for CI.
 */
export function withinBudget(reach, rank, record, budgetMs) {
  const ordered = [...reach.keys()].sort(
    (a, b) =>
      (rank.get(a) ?? 0) - (rank.get(b) ?? 0) ||
      (record[a] ?? UNRECORDED_MS) - (record[b] ?? UNRECORDED_MS) ||
      a.localeCompare(b),
  );
  const run = [];
  let spent = 0;
  for (const spec of ordered) {
    const cost = record[spec] ?? UNRECORDED_MS;
    if (spent + cost > budgetMs) continue;
    run.push(spec);
    spent += cost;
  }
  return { run, left: ordered.filter((spec) => !run.includes(spec)) };
}

/** Recorded CI milliseconds per spec, and a default for a spec the record has not met. */
export function durations(root = ROOT) {
  try {
    const record = JSON.parse(readFileSync(path.join(root, "scripts/e2e-durations.json"), "utf8"));
    return record.functional ?? {};
  } catch {
    return {};
  }
}
export const UNRECORDED_MS = 60_000;

export function estimateMs(specs, record) {
  return specs.reduce((sum, spec) => sum + (record[spec] ?? UNRECORDED_MS), 0);
}

/** Everything the CLI and `verify-push.mjs` need, from git and the working tree. */
export function affectedSpecs({ root = ROOT, base, git = gitReader(root) } = {}) {
  const from = base ?? stackBase(git);
  if (!from) return null;
  const mergeBase = git(["merge-base", from, "HEAD"]);
  if (!mergeBase) return null;
  const names = (git(["diff", "--name-only", mergeBase, "HEAD"]) ?? "").split("\n").filter(Boolean);
  const diffText = git(["diff", "-U0", "--no-color", mergeBase, "HEAD", "--", "src", "e2e"]) ?? "";
  const selection = selectSpecs({
    changed: names,
    diff: parseDiff(diffText),
    specs: readSpecs(root),
    graph: importGraph(root),
  });
  return { base: from, changed: names, ...selection };
}

function render(result, record) {
  if (!result) return "e2e-affected: git could not name a base to diff against.";
  const lines = [`Diff against ${result.base}: ${result.changed.length} file(s).`];
  const block = (title, map) => {
    if (map.size === 0) return;
    const ms = estimateMs([...map.keys()], record);
    lines.push(`${title} (${map.size} spec(s), about ${Math.round(ms / 60000)} CI-minutes):`);
    for (const [spec, why] of [...map].sort()) {
      lines.push(`  ${spec}  — ${[...why].slice(0, 3).join("; ")}`);
    }
  };
  block("Strong", result.strong);
  block("Reach", result.reach);
  if (result.strong.size + result.reach.size === 0)
    lines.push("No spec reads what this diff changed.");
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const baseAt = args.indexOf("--base");
  const result = affectedSpecs({ base: baseAt >= 0 ? args[baseAt + 1] : undefined });
  if (args.includes("--json")) {
    const plain = result && {
      base: result.base,
      changed: result.changed.length,
      strong: Object.fromEntries([...result.strong].map(([k, v]) => [k, [...v]])),
      reach: Object.fromEntries([...result.reach].map(([k, v]) => [k, [...v]])),
    };
    process.stdout.write(`${JSON.stringify(plain, null, 2)}\n`);
  } else {
    process.stdout.write(`${render(result, durations())}\n`);
  }
}
