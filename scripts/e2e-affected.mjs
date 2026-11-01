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
//            removed (a locale value, JSX text, a seed or content literal, a seeded name); a
//            spec that reads an en-US locale key whose value the diff changed, by its full
//            dotted key (`staffCopy("today.blockerRow.waiverLapsed")`); a spec that names a
//            seeded record or seed constant on a line the diff changed (a booking added to it
//            moves its counts), when few specs do; a spec that navigates to a route whose own
//            directory the diff edits.
//   reach  — a spec that navigates to a route whose page or layout imports, through any chain,
//            a module the diff edits. Wide by nature (a barrel reaches everything), so
//            `verify-push.mjs` runs it only while the estimated time stays inside a budget.
//
//   smoke  — five tests a push always runs when the diff changes the app ({@link SMOKE}): the
//            booking loop, a waiver, a check-in, roll call offline, sign-in.
//
// The reach tier is ordered by how much of the diff's vocabulary a spec names (an identifier
// the diff touches, a seeded name it changed), then by the narrowest route, so a budget spends
// itself on the specs most likely to break (#2517).
//
//   node scripts/e2e-affected.mjs [--base <ref> | --commit <sha>] [--json]
//
// `--commit` replays one commit against its parent, to score the selector against what CI
// caught. The visual spec is never selected as a file: its captures are picked one by one
// ({@link selectCaptures}, #2517) and run in light mode only. A path-gated spec (`PATH_GATED`) is picked only when what it tests changed. Every git call is
// a constant argument array plus refs git itself printed.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gitReader } from "./stack-map.mjs";
import { changedLinesByFile, moduleIndex, readModules, symbolReach } from "./symbol-reach.mjs";
import { resolveVerificationBase } from "./verification-base.mjs";
import { isVisualSpec, visualSpecs } from "./visual-specs.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Specs this selector never picks: the capture run is `visual-affected.mjs --grep`'s. */

const MOBILE_SPEC = /(?:^|\/)mobile[^/]*\.spec\.ts$/;

/**
 * Specs that test a tool rather than a page, run only when what they test changed (ci.yml's
 * `pixel_probe` gate is the same list).
 */
export const PATH_GATED = new Map([
  ["e2e/pixel-probe.spec.ts", /^(?:scripts\/pixel-probe\/|src\/app\/globals\.css$)/],
]);

/**
 * The critical journeys a push always proves, one test each, whatever the diff: the booking
 * loop, a waiver signed, a check-in, roll call on an offline manifest, staff sign-in. Picked by
 * title and run as `file:line`; about four minutes at two workers.
 */
export const SMOKE = [
  {
    spec: "e2e/booking.spec.ts",
    title: "full loop: staff schedules, visitor books, staff sees the roster",
  },
  {
    spec: "e2e/waivers.spec.ts",
    title: "one waiver button sends a resumable link and a medical yes surfaces follow-up",
  },
  {
    spec: "e2e/check-in.spec.ts",
    title:
      "a ready diver checks in with one tap, sinks into the checked-in group, and a re-tap undoes it",
  },
  {
    spec: "e2e/manifest.spec.ts",
    title:
      "captain saves the full checkpoint manifest, reloads it offline, and reconciles roll call",
  },
  {
    spec: "e2e/auth.spec.ts",
    title: "staff sign-in lands on the shop dashboard and sign-out locks it again",
  },
];

/** Removed text shorter than this matches too much to mean anything. */
const MIN_FRAGMENT = 12;

/** Files whose string literals are copy a spec may assert on, beyond the locale bundles. */
const LITERAL_SOURCES = /^src\/(?:db\/seed[^/]*\.ts|content\/)/;

/** The demo seed's modules: what they name, specs assert on by name and by count. */
const SEED_SOURCE = /^src\/db\/seed[^/]*\.ts$/;

/**
 * A seeded proper name — a person, a boat, a site — is shorter than {@link MIN_FRAGMENT}
 * ("Marcus Webb", quoted by thirteen specs) but two capitalised words are still specific.
 */
const SEED_NAME = /^\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]*)+$/u;
const MIN_SEED_NAME = 7;

/** An upper-case constant a seed module exports and a spec imports (`LOST_MASK`). */
const SEED_CONSTANT = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b[A-Z]{4,}\b/g;

const SOURCE_EXT = /\.(?:ts|tsx|mts|mjs|js|jsx)$/;

/** A test file changes no page, so it selects no spec by route or import. */
const TEST_FILE = /\.test\.(?:ts|tsx|mjs)$/;

/**
 * The branch this one is stacked on: the remote branch HEAD contains that is furthest
 * from `origin/main` (the nearest layer below), excluding this branch's own remote. A layer that
 * merges the one below holds it through a second parent, so "contains", not first-parent.
 * Falls back to `origin/main`; null only when git cannot answer at all.
 */
export function stackBase(git, options) {
  return resolveVerificationBase(git, options).ref;
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

const quotable = (piece) =>
  piece.length >= MIN_FRAGMENT && /[A-Za-z]{3}/.test(piece) && /\s/.test(piece);
const seedQuotable = (piece) =>
  quotable(piece) || (piece.length >= MIN_SEED_NAME && SEED_NAME.test(piece));

/** Pieces of a message or literal a spec could quote: split around ICU and template holes. */
function fragmentsOf(value, keep = quotable) {
  return value
    .replace(/\\(["'\\])/g, "$1")
    .split(/\$\{[^}]*\}|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|<\/?[a-zA-Z][^>]*>|\\n/)
    .map((piece) => piece.trim())
    .filter(keep);
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
    const keep = SEED_SOURCE.test(file) ? seedQuotable : quotable;
    for (const match of line.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`/g)) {
      out.push(...fragmentsOf(match[1] ?? match[2] ?? match[3], keep));
    }
  }
  return out;
}

/**
 * The prefix a locale bundle's keys carry in a translator call: none for `diver.json`, the
 * namespace for `staff/<namespace>.json` (composed by `staff/index.ts` under the file's stem).
 * Null for anything that is not an en-US bundle, the only locale a spec reads.
 */
export function localeKeyPrefix(file) {
  if (file === "src/i18n/locales/en-US/diver.json") return "";
  const staff = file.match(/^src\/i18n\/locales\/en-US\/staff\/([\w-]+)\.json$/);
  return staff ? `${staff[1]}.` : null;
}

function leaves(value, prefix, out) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) leaves(child, `${prefix}${key}.`, out);
  } else {
    out.set(prefix.slice(0, -1), JSON.stringify(value));
  }
  return out;
}

/**
 * The full dotted keys whose value differs between two versions of one bundle, removed keys
 * included; a key only `after` has is new, and no spec written before it can read it. Either
 * side may be null (the file was added or deleted) or unparseable, which reads as empty.
 */
export function changedLocaleKeys(before, after, prefix = "") {
  const parse = (text) => {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  };
  const old = leaves(parse(before), prefix, new Map());
  const now = leaves(parse(after), prefix, new Map());
  return [...old].filter(([key, value]) => now.get(key) !== value).map(([key]) => key);
}

/** A regex that finds `key` quoted whole in a source: `staffCopy("a.b")`, `diver('a.b')`. */
function keyPattern(key) {
  return new RegExp(`["'\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
}

/**
 * The string an upper-case seed constant holds (`SHOP_CERTIFIED_TITLE` → "Rescue Diver —
 * weekend course"), from each seed module's source: the seed refers to its records by these,
 * and a spec by the words.
 */
export function seedConstantValues(sources) {
  const values = new Map();
  for (const [file, source] of sources) {
    if (!SEED_SOURCE.test(file) || TEST_FILE.test(file)) continue;
    const pattern =
      /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)`)/gm;
    for (const match of source.matchAll(pattern)) {
      if (!values.has(match[1])) values.set(match[1], new Set());
      values.get(match[1]).add(match[2] ?? match[3] ?? match[4]);
    }
  }
  return values;
}

/** Every seed module's source, for {@link seedConstantValues}. */
export function readSeedSources(root = ROOT) {
  const sources = new Map();
  for (const entry of readdirSync(path.join(root, "src/db"))) {
    const file = `src/db/${entry}`;
    if (SEED_SOURCE.test(file) && !TEST_FILE.test(file)) {
      sources.set(file, readFileSync(path.join(root, file), "utf8"));
    }
  }
  return sources;
}

/**
 * What the diff's changed seed lines name: the quotable literals on them (a diver, a trip, a
 * boat whose rows or counts moved), the upper-case constants they use outside import lines,
 * and the quotable words those constants hold (`values`, from {@link seedConstantValues}).
 */
export function seedTouches(files, values = new Map()) {
  const names = new Set();
  const constants = new Set();
  for (const [file, { removed, added }] of files) {
    if (!SEED_SOURCE.test(file) || TEST_FILE.test(file)) continue;
    for (const line of [...removed, ...added]) {
      if (/^\s*(?:import|export\s+\{.*\}\s+from)\b/.test(line)) continue;
      for (const piece of textOf(file, line)) names.add(piece);
      for (const match of line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "").matchAll(SEED_CONSTANT)) {
        constants.add(match[0]);
        for (const value of values.get(match[0]) ?? []) {
          for (const piece of fragmentsOf(value, seedQuotable)) names.add(piece);
        }
      }
    }
  }
  return { names, constants };
}

/** The names a source imports from the seed's modules (`../src/db/seed-booth`, `@/db/seed`). */
export function seedImports(source) {
  const names = new Set();
  const pattern =
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](?:(?:\.\.\/)+src|@)\/db\/seed[\w-]*["']/g;
  for (const match of source.matchAll(pattern)) {
    for (const part of match[1].split(",")) {
      const name = part
        .replace(/^\s*type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.add(name);
    }
  }
  return names;
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
 * The smoke tests as Playwright `file:line` arguments, from the specs' current source; a title
 * no longer found is returned in `missing`, never silently dropped.
 */
export function smokeTests(specs) {
  const found = [];
  const missing = [];
  for (const { spec, title } of SMOKE) {
    const source = specs.get(spec) ?? "";
    const at = source.indexOf(`test(${JSON.stringify(title)}`);
    if (at < 0) missing.push(`${spec}: ${title}`);
    else found.push(`${spec}:${source.slice(0, at).split("\n").length}`);
  }
  return { found, missing };
}

/** Identifiers and literal fragments a diff's changed lines hold, four characters or more. */
export function symbolsOf(files) {
  const symbols = new Set();
  for (const [file, { removed, added }] of files) {
    if (!file.startsWith("src/") || TEST_FILE.test(file)) continue;
    for (const line of [...removed, ...added]) {
      for (const match of line.matchAll(/[A-Za-z_$][\w$]{3,}/g)) symbols.add(match[0]);
      for (const match of line.matchAll(/["'`]([^"'`]{4,80})["'`]/g)) symbols.add(match[1]);
    }
  }
  return symbols;
}

/**
 * How much of a diff's vocabulary each spec names: the sum over the diff's symbols a spec holds
 * of one over how many specs hold it, so a word every spec says (`page`, `expect`) counts for
 * nothing and a seeded diver's name or a component's own identifier counts for a lot. A symbol
 * half the specs hold is not counted at all.
 */
export function overlapScores(symbols, specs, candidates) {
  const sources = [...specs.values()];
  const scores = new Map(candidates.map((spec) => [spec, 0]));
  for (const symbol of symbols) {
    const df = sources.filter((source) => source.includes(symbol)).length;
    if (df === 0 || df > sources.length / 2) continue;
    for (const spec of candidates) {
      if (specs.get(spec)?.includes(symbol)) scores.set(spec, scores.get(spec) + 1 / df);
    }
  }
  return scores;
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
        ? `${PARAM}(?:/${PARAM})*`
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
      else if (rel.endsWith(".spec.ts") && !isVisualSpec(rel) && !MOBILE_SPEC.test(rel)) {
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
 * A seeded name or constant on a changed seed line selects strongly only when this few specs
 * say it: a seed edit usually touches a record many specs pass through without counting it.
 */
export const SEED_STRONG_SPECS = 3;

/**
 * The selection. `changed` is every file the diff touches, `diff` its parsed hunks, `specs`
 * every spec's source, and `graph` the import graph. The reach tier is skipped only when both
 * `graph` and `modules` are absent. With `modules` (the `symbol-reach.mjs` index) and `lines`
 * (each file's changed lines), the reach tier follows an edit name by name instead of file by
 * file.
 *
 * `strong` maps a spec to why it was picked. `reach` does too, and `rank` orders the reach
 * specs for {@link withinBudget}: the ones naming most of the diff's vocabulary first
 * ({@link overlapScores}), then the narrowest route.
 */
export function selectSpecs({
  changed,
  diff,
  specs,
  graph,
  modules,
  lines,
  localeKeys = [],
  seedValues,
}) {
  const strong = new Map();
  const reach = new Map();
  const rank = new Map();
  const note = (map, spec, why) => {
    if (isVisualSpec(spec) || MOBILE_SPEC.test(spec) || !specs.has(spec)) return;
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

  // A tool's spec, when the tool changed.
  for (const [spec, gate] of PATH_GATED) {
    const hit = changed.find((file) => gate.test(file));
    if (hit) note(strong, spec, hit);
  }

  // Text the diff removed, still quoted by a spec.
  for (const piece of removedText(diff)) {
    for (const [spec, source] of specs) {
      if (source.includes(piece)) note(strong, spec, `quotes "${piece}"`);
    }
  }

  // A locale value the diff changed, read by its full key: the spec's locator now holds the new
  // words, which can match a second element, or nothing on a page that hard-codes the old ones.
  for (const key of localeKeys) {
    const hits = matching(keyPattern(key));
    for (const [spec] of hits) {
      if (hits.length <= HUB_SPECS) note(strong, spec, `reads ${key}`);
      else noteReach(spec, `reads ${key} (shared)`, hits.length);
    }
  }

  // A seeded record or constant on a changed seed line: its rows, counts or wording moved.
  // A name a handful of specs say is strong; one more of the suite says (an instructor, the
  // reef charter) only ranks, since most seed edits leave what those specs count alone.
  const seed = seedTouches(diff, seedValues);
  for (const name of seed.names) {
    const hits = [...specs].filter(([, source]) => source.includes(name));
    for (const [spec] of hits) {
      if (hits.length <= SEED_STRONG_SPECS) note(strong, spec, `seed names "${name}"`);
      else noteReach(spec, `seed names "${name}" (shared)`, hits.length);
    }
  }
  if (seed.constants.size > 0) {
    const importing = new Map();
    for (const [spec, source] of specs) {
      for (const name of seedImports(source)) {
        if (!seed.constants.has(name)) continue;
        if (!importing.has(name)) importing.set(name, []);
        importing.get(name).push(spec);
      }
    }
    for (const [name, hits] of importing) {
      for (const spec of hits) {
        if (hits.length <= SEED_STRONG_SPECS) note(strong, spec, `seed ${name}`);
        else noteReach(spec, `seed ${name} (shared)`, hits.length);
      }
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
  if (graph || modules) {
    const edited = changed.filter(
      (file) =>
        (modules ? modules.index.has(file) : graph.has(file)) && !file.startsWith("src/app/"),
    );
    if (edited.length > 0) {
      const reached = new Map();
      const importers = modules
        ? symbolReach(
            modules,
            new Map(edited.map((file) => [file, lines?.get(file) ?? "all"])),
          ).keys()
        : importersOf(graph, edited);
      for (const file of importers) {
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

  // Most of the diff's vocabulary first, then the narrowest route: `rank` becomes the order.
  const overlap = overlapScores(symbolsOf(diff), specs, [...reach.keys()]);
  const ordered = [...reach.keys()].sort(
    (a, b) => overlap.get(b) - overlap.get(a) || rank.get(a) - rank.get(b) || a.localeCompare(b),
  );
  for (const [position, spec] of ordered.entries()) rank.set(spec, position);

  return { strong, reach, rank, overlap };
}

/**
 * The reach specs to run inside `budgetMs` of recorded CI time, lowest `rank` first, then
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

/**
 * The tests of a visual spec (`e2e/visual-*.spec.ts`, picked one test at a time rather than as a
 * file) by title, each with its own source (up to the next
 * `test(`). A title written with a template hole matches any text at the hole.
 */
export function visualBlocks(source) {
  const starts = [...source.matchAll(/^[ \t]*test\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*,/gm)];
  return starts.map((match, i) => ({
    title: match[2],
    body: source.slice(match.index, starts[i + 1]?.index ?? source.length),
  }));
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A Playwright `-g` source for one test title: its literal text, `${scheme}` as the light run
 * and any other template hole as anything.
 */
function titlePattern(title) {
  return title
    .replace(/\\(["'`\\])/g, "$1")
    .split(/(\$\{[^}]*\})/)
    .map((piece) =>
      /^\$\{scheme\}$/.test(piece) ? "light" : /^\$\{/.test(piece) ? ".*" : escapeRegex(piece),
    )
    .join("");
}

/**
 * The captures a diff can move, by test title: a capture whose source quotes text the diff
 * removed, visits a route whose own directory the diff edits (a hub route, visited by more than
 * {@link HUB_SPECS} captures, selects none), or sits on a line the diff changed in the capture
 * spec itself. Each value says why. A capture is a screenshot; running it here is what finds the
 * heading it waits for gone (five visual shards, 2026-10-09 to 2026-10-12).
 */
export function selectCaptures({ changed, diff, source, file, localeKeys = [], seedValues }) {
  const picked = new Map();
  if (!source) return picked;
  const blocks = visualBlocks(source);
  const note = (block, why) => {
    if (!picked.has(block.title)) picked.set(block.title, new Set());
    picked.get(block.title).add(why);
  };
  for (const piece of removedText(diff)) {
    for (const block of blocks) if (block.body.includes(piece)) note(block, `quotes "${piece}"`);
  }
  // The same few-readers rules as the specs: a key, seeded name or seed constant more captures
  // say than the specs' strong limit selects none of them.
  const fewReaders = (why, has, limit) => {
    const hits = blocks.filter((block) => has(block.body));
    if (hits.length <= limit) for (const block of hits) note(block, why);
  };
  for (const key of localeKeys) {
    const pattern = keyPattern(key);
    fewReaders(`reads ${key}`, (body) => pattern.test(body), HUB_SPECS);
  }
  const seed = seedTouches(diff, seedValues);
  for (const name of seed.names) {
    fewReaders(`seed names "${name}"`, (body) => body.includes(name), SEED_STRONG_SPECS);
  }
  for (const name of seedImports(source)) {
    if (!seed.constants.has(name)) continue;
    const pattern = new RegExp(`\\b${name}\\b`);
    fewReaders(`seed ${name}`, (body) => pattern.test(body), SEED_STRONG_SPECS);
  }
  const routes = new Map();
  for (const file of changed) {
    const route = routeOf(file);
    if (route) routes.set(`${route.route}|${route.broad}`, route);
  }
  for (const route of routes.values()) {
    const pattern = routePattern(route);
    const hits = blocks.filter((block) => pattern.test(block.body));
    if (hits.length > HUB_SPECS) continue;
    for (const block of hits) note(block, route.route);
  }
  const added =
    diff
      .get(file)
      ?.added.map((line) => line.trim())
      .filter((line) => line.length >= 20) ?? [];
  for (const block of blocks) {
    if (added.some((line) => block.body.includes(line))) note(block, "edited");
  }
  return picked;
}

/**
 * The `-g` argument that runs `titles` in light mode only (a dark capture is the same test
 * under another `describe`, and CI's reg-suit run has both): any of the titles, none under a
 * `dark mode` describe. Null for no titles.
 */
export function captureGrep(titles) {
  if (titles.length === 0) return null;
  return `^(?!.*dark mode).*(?:${titles.map(titlePattern).join("|")})`;
}

/** Recorded CI milliseconds for the light-mode run of each title, from the `visual` record. */
export function captureMs(titles, root = ROOT) {
  let record = {};
  try {
    record =
      JSON.parse(readFileSync(path.join(root, "scripts/e2e-durations.json"), "utf8")).visual ?? {};
  } catch {}
  let total = 0;
  for (const title of titles) {
    const own = new RegExp(`(?:^| › )${titlePattern(title)}$`);
    for (const [key, ms] of Object.entries(record)) {
      if (!key.includes("dark mode") && own.test(key)) total += ms;
    }
  }
  return total;
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

/** A diff that can change what a page does: any non-test `src/` file, or the e2e harness. */
const APP_CHANGE = /^src\/(?!.*\.test\.[^/]+$)|^e2e\/(?:fixtures|helpers|servers|browser)\.ts$/;

/**
 * Everything the CLI and `verify-push.mjs` need, from git and the working tree: the diff from
 * `base`'s fork point to HEAD, or, with `commit`, that one commit against its parent (to score
 * the selector against what CI later caught; the specs and graph are still the working tree's).
 *
 * A diff that changes the app also runs the {@link SMOKE} tests, as strong `file:line` picks.
 */
export function changedDiff({
  root = ROOT,
  base,
  commit,
  workingTree = false,
  git = gitReader(root),
} = {}) {
  let from;
  let to = "HEAD";
  let label;
  if (commit) {
    from = git(["rev-parse", "--verify", "--quiet", `${commit}~1`]);
    to = commit;
    label = `${commit}~1..${commit}`;
  } else {
    const ref = base ?? stackBase(git);
    if (!ref) return null;
    from = git(["merge-base", ref, "HEAD"]);
    label = ref;
  }
  if (!from) return null;
  const listed = git(["diff", "--name-only", from, ...(workingTree ? [] : [to])]);
  if (listed === null) return null;
  const untracked = workingTree ? git(["ls-files", "--others", "--exclude-standard"]) : "";
  if (untracked === null) return null;
  const names = [...new Set(`${listed}\n${untracked}`.split("\n").filter(Boolean))];
  return { base: label, changed: names, from, to };
}

/** Every en-US key whose value changed between `from` and `to`, read from both blobs. */
export function changedLocaleKeysIn(git, names, from, to) {
  const keys = [];
  for (const file of names) {
    const prefix = localeKeyPrefix(file);
    if (prefix === null) continue;
    keys.push(
      ...changedLocaleKeys(
        git(["show", `${from}:${file}`]),
        git(["show", `${to}:${file}`]),
        prefix,
      ),
    );
  }
  return keys;
}

export function affectedSpecs({ root = ROOT, base, commit, git = gitReader(root) } = {}) {
  const diff = changedDiff({ root, base, commit, git });
  if (!diff) return null;
  const { from, to, base: label, changed: names } = diff;
  const diffText = git(["diff", "-U0", "--no-color", from, to, "--", "src", "e2e"]) ?? "";
  const specs = readSpecs(root);
  const localeKeys = changedLocaleKeysIn(git, names, from, to);
  const seedValues = seedConstantValues(readSeedSources(root));
  const selection = selectSpecs({
    changed: names,
    diff: parseDiff(diffText),
    specs,
    modules: moduleIndex(readModules(root)),
    lines: changedLinesByFile(diffText),
    localeKeys,
    seedValues,
  });
  if (names.some((file) => APP_CHANGE.test(file))) {
    for (const test of smokeTests(specs).found) {
      const spec = test.replace(/:\d+$/, "");
      if (selection.strong.has(spec)) continue;
      selection.strong.set(test, new Set(["smoke"]));
      selection.reach.delete(spec);
      selection.rank.delete(spec);
    }
  }
  const captures = new Map();
  if (names.some((file) => APP_CHANGE.test(file) || isVisualSpec(file))) {
    for (const file of visualSpecs(root)) {
      const selected = selectCaptures({
        changed: names,
        diff: parseDiff(diffText),
        source: readFileSync(path.join(root, file), "utf8"),
        file,
        localeKeys,
        seedValues,
      });
      for (const [title, why] of selected)
        captures.set(title, new Set([...(captures.get(title) ?? []), ...why]));
    }
  }
  return { base: label, changed: names, ...selection, captures };
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
  if (result.captures?.size > 0) {
    lines.push(`Captures (${result.captures.size}, light mode only):`);
    for (const [title, why] of [...result.captures].sort()) {
      lines.push(`  ${title}  — ${[...why].slice(0, 2).join("; ")}`);
    }
  }
  if (result.strong.size + result.reach.size + (result.captures?.size ?? 0) === 0)
    lines.push("No spec reads what this diff changed.");
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const baseAt = args.indexOf("--base");
  const commitAt = args.indexOf("--commit");
  const result = affectedSpecs({
    base: baseAt >= 0 ? args[baseAt + 1] : undefined,
    commit: commitAt >= 0 ? args[commitAt + 1] : undefined,
  });
  if (args.includes("--json")) {
    const plain = result && {
      base: result.base,
      changed: result.changed.length,
      strong: Object.fromEntries([...result.strong].map(([k, v]) => [k, [...v]])),
      reach: Object.fromEntries([...result.reach].map(([k, v]) => [k, [...v]])),
      captures: Object.fromEntries([...result.captures].map(([k, v]) => [k, [...v]])),
    };
    process.stdout.write(`${JSON.stringify(plain, null, 2)}\n`);
  } else {
    process.stdout.write(`${render(result, durations())}\n`);
  }
}
