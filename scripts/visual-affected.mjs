#!/usr/bin/env node
// Which visual captures a pull request can move, so a layer that moves nothing visual stops
// re-photographing all 1,158 surfaces (code re-review 2026-10-13, item 22).
//
// A green PR run was 47 percent visual capture by job-minutes (8 shards × 476 s), and a stack
// re-captured every surface on every layer. This narrows the capture on `pull_request` only:
//
//   all       — a push to main, the nightly, a dispatch: every capture, published as the
//               baseline the next commit compares against. Never narrowed.
//   affected  — a pull request: the captures whose test visits a route the diff can reach,
//               plus a fixed smoke set (the staff day, the landing page, the public schedule,
//               a trip's manifest, sign-in). The diff is taken against the fork point from the
//               default branch, which is the commit reg-suit's expected key names, so a stacked
//               layer's captures include every layer beneath it.
//
// A pull request whose diff this cannot bound captures everything, so the narrowing only ever
// removes captures nothing could have moved: the e2e harness and helpers, the visual plumbing in
// `scripts/` and the CI workflow, the seed's orchestrator (`src/db/seed.ts`), the catalog seed
// and the dev credentials, a stylesheet, a root config that shapes the build, a renderer
// dependency, and a module that runs for every page (the proxy, the service worker, what
// `next.config.ts` imports).
//
// Light mode only, on a pull request (`--light-only`, 2026-10-24): the dark captures are the
// baseline's own unless the diff touches a colour token or theme module ({@link THEME}).
//
// Everything else is bounded (test review 2026-10-14: 26 of 28 product PRs captured all):
//
//   - inert: docs, playbooks, infra, unit tests, functional specs, snapshots, migrations
//     (`drizzle/`: the seed is what pixels show, and it has its own rule), the lockfile, and
//     root files the build never reads (`.gitignore`, `.env.example`, `vercel.json`, …);
//   - `package.json`: inert unless a dependency, a renderer dev dependency, or a build script
//     changed;
//   - a locale bundle: the keys whose value changed, mapped to the modules that name them;
//   - a `public/` asset: the modules that name its path (or its folder, for a path built from
//     a slug);
//   - a visual spec (`e2e/visual-*.spec.ts`, one per feature): the captures whose lines changed,
//     and the captures that call a helper whose lines changed;
//   - a schema module: its changed tables, followed name by name to the modules that read them
//     and on to the pages (`dataReach`); a seed scenario (`src/db/seed-<scenario>.ts`): the
//     tables its changed code writes, followed the same way. Neither walk passes through a seed
//     module, since the demo action that runs the seed is imported by every public page
//     (8 of the 9 merges before 2026-10-24 captured everything over a schema or seed edit);
//   - a module: its changed lines, followed name by name to the pages that read them
//     (`symbol-reach.mjs`; a layout's reach is every page beneath it); a module no page reads
//     (a test fixture, a script's helper, a deleted file whose importers are in the same diff)
//     moves nothing, and a not-found or error page moves only the captures that show one.
//
// Which routes a capture visits is read from its own source: the test's lines in
// its `e2e/visual-*.spec.ts` and the bodies of the helpers it calls (the spec's own and
// `e2e/helpers.ts`'s), transitively. A capture is picked when a route it names is the changed
// route or an ancestor of it — a test that opens the staff day and clicks into a trip is picked
// for a change to the trip page — or, for a layout change, a descendant. A capture that names no
// route at all is always picked.
//
// The narrowed set is finished in `visual-report` (`scripts/visual-compare.mjs
// --fill-from-expected`): every surface not captured is copied from the expected snapshot before
// reg-suit compares, so it reads as unchanged rather than deleted, and the published report is a
// whole set. A pull request's snapshot is never a baseline (baselines are main's first-parent
// commits), so the copies never stand in for pixels anyone compares against.
//
//   node scripts/visual-affected.mjs --list <playwright --list json> --out <filtered json>
//        [--base <ref>] [--all] [--light-only] [--github-output] [--grep <file>]
//
// `--light-only` (a pull request) drops every dark-mode capture unless the diff touches a colour
// token or theme module ({@link THEME}); `mode` is then `light` when the diff was unbounded (every
// light capture), and `visual-report` fills the dark ones from the baseline as it fills an
// `affected` run's uncaptured surfaces. When CI has no versioned baseline to fill from, it selects
// every capture instead so the first published snapshot includes both colour schemes.
//
// `--grep` writes a Playwright `--grep` for the chosen captures in light mode only: the local
// pass a push can afford (#2517).

import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { collectVisualSources } from "./check-route-coverage.mjs";
import { importersOf, importGraph, routeOf } from "./e2e-affected.mjs";
import { listedTests, testListLine } from "./e2e-shard.mjs";
import { gitReader } from "./stack-map.mjs";
import { changedLinesByFile, moduleIndex, readModules, symbolReach } from "./symbol-reach.mjs";
import { isVisualSpec, visualSpecs } from "./visual-specs.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The visual run's shard count when it captures everything. */
export const FULL_SHARDS = 12;

/**
 * Captures every pull request runs whatever it changed: the shells a reviewer sees first, so a
 * narrowed run still proves the harness, the fonts and both colour schemes render.
 */
export const SMOKE = [
  /› the day spine renders true to the design \(/,
  /› the landing page renders true to the design \(/,
  /› the public schedule renders true to the design \(/,
  /› a trip's manifest renders true to the design \(/,
  /› the sign-in page renders true to the design \(/,
];

/**
 * Paths no capture can move: docs, playbooks, infrastructure, unit tests, functional specs,
 * snapshots, migrations, the lockfile, and root files neither the build nor the browser reads. Not
 * `config/env-registry.mjs`: `next.config.ts` and `src/` import it.
 */
const INERT =
  /^(?:docs\/|\.claude\/|\.agents\/|infra\/|drizzle\/|extension\/|LICENSE$)|\.md$|\.snap$|(?:^|\/)[^/]+\.test\.(?:ts|tsx|mts|mjs|js)$|^e2e\/(?!visual(?:-[\w-]+)?\.spec\.ts$).+\.spec\.ts$|^(?:\.gitignore|\.gitattributes|\.env\.example|\.coderabbit\.yaml|\.mcp\.json|\.vercelignore|vercel\.json|biome\.json|cdk\.json|skills-lock\.json|pnpm-lock\.yaml|vitest\.config\.ts|drizzle\.config(?:\.prod)?\.ts|next-env\.d\.ts|tsconfig\.tsbuildinfo)$|\.d\.ts$/;

/** `scripts/` and `.github/` are inert except the files the capture or the build runs. */
const VISUAL_PLUMBING =
  /^scripts\/(?:visual-|symbol-reach|e2e-affected|e2e-shard|reg-suit-keys|wait-for-baseline|build-service-worker|check-e2e-build)|^\.github\/(?:workflows\/ci\.yml|actions\/)/;

/**
 * `src/` paths whose blast radius is every page: the data every capture shows. The orchestrator
 * `seed.ts` writes the demo shop's own row and its cast, which every page reads; the catalog
 * every agency and course card; the dev credentials every signed-in capture.
 */
const EVERYWHERE = /^src\/db\/(?:seed\.ts|seed-catalog\.ts|dev-credentials)/;

/**
 * A seed scenario (`src/db/seed-<scenario>.ts`) or the orchestrator: what they change is data,
 * not a page. A scenario's edit reaches the pages that read the tables it writes; nothing reaches
 * a page *through* one (the demo actions and test routes that import the seed would otherwise
 * carry every scenario to every public page).
 */
const SEED = /^src\/db\/seed(?:-[\w-]+)?\.ts$/;

/** The schema: a table's edit reaches the modules that read that table, name by name. */
const SCHEMA = /^src\/db\/schema(?:\/|\.ts$)/;

/**
 * Colour tokens and theme modules: a pull request that touches one captures dark mode too
 * (every other pull request captures light only; main captures both). `globals.css` holds the
 * tokens and the `prefers-color-scheme: dark` block, `brand.ts` derives a shop's dark brand
 * theme, `BrandStyle.tsx` writes it, `_brand/colors.ts` mirrors the tokens for the places CSS
 * cannot reach, and the PostCSS config decides how the tokens compile.
 */
export const THEME =
  /^(?:src\/app\/globals\.css|src\/lib\/brand\.ts|src\/components\/BrandStyle\.tsx|src\/app\/_brand\/colors\.ts|postcss\.config\.mjs)$/;

/** A dark-mode capture, by the describe its title carries (`dark mode`, `dark mode — …`). */
const DARK = / › dark mode(?: [^›]*)? › /;

/**
 * Modules Next runs for every page without a page importing them. `instrumentation.ts` is not
 * one: it runs once at boot, and reads the providers it registers by reference, which a name
 * walk cannot tell from a call.
 */
const RUNTIME_ROOT = /^src\/proxy\.ts$|^src\/worker\//;

/** A message bundle: `en-US/diver.json`, `es-ES/staff/<namespace>.json`. */
const LOCALE = /^src\/i18n\/locales\/[^/]+\/(?:diver|staff\/[^/]+)\.json$/;

/** Dev dependencies that change what a page looks like when they move. */
const RENDERER =
  /^(?:next|react|react-dom|@next\/.+|@playwright\/test|playwright(?:-core)?|tailwindcss|@tailwindcss\/.+|postcss|lightningcss|babel-plugin-react-compiler|typescript)$/;

/** `package.json` scripts the e2e build or the capture runs. */
const BUILD_SCRIPT = /^(?:build|start|e2e|visual)/;

const CODE = /\.(?:ts|tsx|mts|mjs|js|jsx)$/;
const ENTRY = /\/(?:page|layout|route|template|loading|default|not-found|error)\.tsx?$/;

/**
 * Why a `package.json` change can move pixels, or null when it cannot: a runtime dependency, a
 * renderer dev dependency, a build script, or any other top-level field (engines, overrides).
 */
export function packageJsonReach(before, after) {
  let a;
  let b;
  try {
    a = JSON.parse(before);
    b = JSON.parse(after);
  } catch {
    return "package.json could not be read on both sides";
  }
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === "scripts" || key === "devDependencies") continue;
    if (!same(a[key], b[key])) return `package.json changes ${key}`;
  }
  for (const [field, matches] of [
    ["devDependencies", RENDERER],
    ["scripts", BUILD_SCRIPT],
  ]) {
    const x = a[field] ?? {};
    const y = b[field] ?? {};
    for (const name of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (matches.test(name) && x[name] !== y[name]) return `package.json changes ${field}.${name}`;
    }
  }
  return null;
}

/** Every leaf of a JSON object, by dotted path. */
function leaves(value, prefix = "", out = new Map()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.set(prefix, JSON.stringify(value));
  }
  return out;
}

/**
 * The message keys a bundle change adds, removes or rewords, as code names them, each with
 * whether HEAD still has it: a removed key's readers were edited in the same diff.
 */
export function changedMessageKeys(file, before, after) {
  const namespace = file.match(/\/staff\/([^/]+)\.json$/)?.[1];
  const parse = (text) => (text === null ? {} : JSON.parse(text));
  const a = leaves(parse(before));
  const b = leaves(parse(after));
  const keys = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) === b.get(key)) continue;
    keys.push({ key: namespace ? `${namespace}.${key}` : key, removed: !b.has(key) });
  }
  return keys;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const QUOTE = "[\"'`]";

/**
 * The source modules that may read message `key`: one that writes the key out (whole, or without
 * its leading segments, the way a scoped `t` names it), builds it from a template on part of its
 * path (`` t(`status.${kind}`) ``), or names a scope and the rest of the key. Over-reading only
 * costs a capture; empty means no module names it.
 */
export function messageConsumers(key, sources) {
  const segments = key.split(".");
  const leaf = segments.at(-1);
  const joined = (from, to) => escapeRegExp(segments.slice(from, to).join("."));
  const patterns = [];
  for (let i = 0; i <= segments.length - Math.min(2, segments.length); i += 1) {
    patterns.push(new RegExp(`${QUOTE}${joined(i)}${QUOTE}`));
  }
  for (let end = segments.length - 1; end >= 1; end -= 1) {
    for (let start = 0; start < end; start += 1) {
      patterns.push(new RegExp(`${QUOTE}${joined(start, end)}\\.\\$\\{`));
    }
  }
  const scopes = [];
  for (let i = 1; i < segments.length; i += 1) {
    scopes.push([
      new RegExp(`${QUOTE}${joined(0, i)}${QUOTE}`),
      new RegExp(`${QUOTE}${joined(i)}${QUOTE}`),
    ]);
  }
  const hits = new Map();
  for (const [file, text] of sources) {
    if (
      !text.includes(leaf) &&
      !segments.slice(0, -1).some((segment) => text.includes(`${segment}.\${`))
    ) {
      continue;
    }
    const tests = [...patterns];
    // A scope (`useTranslations("shopHome.spine")`) and the rest of the key in one module.
    for (const [scope, rest] of scopes) {
      if (scope.test(text) && rest.test(text)) tests.push(scope, rest);
    }
    const lines = linesWhere(text, (line) => tests.some((pattern) => pattern.test(line)));
    if (lines.size > 0) hits.set(file, lines);
  }
  return hits;
}

/**
 * The source files that name a `public/` asset: by its path, or, when nothing does, by its
 * folder (a path built from a slug, `` `/marine-life/${slug}.jpg` ``). A JSON file that names
 * it stands in for the modules that import that JSON.
 */
export function assetConsumers(file, sources) {
  const served = file.slice("public".length);
  const encoded = encodeURI(served);
  const folder = served.slice(0, served.lastIndexOf("/") + 1);
  let found = namedBy([served, encoded], sources, { code: false });
  if (found.size === 0 && folder.length > 1) found = namedBy([folder], sources, { code: false });
  const out = new Map();
  for (const [consumer, lines] of found) {
    if (!consumer.endsWith(".json")) {
      out.set(consumer, lines);
      continue;
    }
    const name = consumer.split("/").pop();
    for (const [importer, at] of namedBy([`/${name}"`, `/${name}'`], sources)) {
      out.set(importer, at);
    }
  }
  return out;
}

/** The line numbers (1-based) of `text` that `test` accepts. */
function linesWhere(text, test) {
  const lines = new Set();
  text.split("\n").forEach((line, i) => {
    if (test(line)) lines.add(i + 1);
  });
  return lines;
}

/**
 * The files in `sources` (code only, unless `code` is false) that name one of `needles`, each
 * with the lines that do.
 */
function namedBy(needles, sources, { code = true } = {}) {
  const found = new Map();
  for (const [file, text] of sources) {
    if (code && !CODE.test(file)) continue;
    if (!needles.some((needle) => text.includes(needle))) continue;
    found.set(
      file,
      linesWhere(text, (line) => needles.some((needle) => line.includes(needle))),
    );
  }
  return found;
}

const ALL_LINES = "all";

/** Where `name`, exported by `file`, is declared: through re-exports and `export *` barrels. */
function declarationOf(index, file, name, seen = new Set()) {
  if (seen.has(file)) return null;
  seen.add(file);
  const parsed = index.get(file);
  if (!parsed) return null;
  const item = parsed.items.find((it) => it.exports.includes(name));
  if (item) return { file, line: item.start };
  for (const reexport of parsed.reexports) {
    if (reexport.exported === name) return declarationOf(index, reexport.target, reexport.imported);
  }
  for (const target of parsed.stars) {
    const found = declarationOf(index, target, name, seen);
    if (found) return found;
  }
  return null;
}

/** `items` and every item of the same module declaring a name they use, to a fixpoint. */
function withLocalCallees(parsed, items) {
  const out = new Set(items);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of parsed.items) {
      if (out.has(item) || item.kind !== "declaration") continue;
      if (![...out].some((used) => item.locals.some(({ local }) => used.names.has(local))))
        continue;
      out.add(item);
      grew = true;
    }
  }
  return out;
}

/** A drizzle write, `db.insert(bookings)` / `tx.update(people)` / `.delete(x)`: the table's name. */
const WRITE = /\.(?:insert|update|delete)\(\s*([\w$]+)\s*[,)]/g;

/**
 * The schema tables `items` of `parsed` write, as `{ target, imported }` import bindings: the
 * writes in the items and the local helpers they call, and one hop into a `src/db/` writer they
 * import (`createBookingRecord`), whose own writes count the same way. A table only read is not
 * data the edit changes.
 */
function tablesWritten(index, parsed, items, hop = true) {
  const used = withLocalCallees(parsed, items);
  const written = new Set();
  for (const item of used) for (const [, name] of item.text.matchAll(WRITE)) written.add(name);
  const out = [];
  for (const { local, target, imported } of parsed.imports) {
    if (!target) continue;
    if (SCHEMA.test(target)) {
      if (written.has(local)) out.push({ target, imported });
      continue;
    }
    if (!hop || !/^src\/db\//.test(target) || SEED.test(target)) continue;
    if (![...used].some((item) => item.names.has(local))) continue;
    const writer = index.get(target);
    const declared = writer?.items.filter((it) => it.exports.includes(imported)) ?? [];
    if (declared.length > 0) out.push(...tablesWritten(index, writer, declared, false));
  }
  return out;
}

/** The module index with no edge out of a seed module: the walk stops at the data. */
function sealed(modules, keep = () => false) {
  const importers = new Map();
  for (const [file, from] of modules.importers) {
    importers.set(file, SEED.test(file) ? new Set([...from].filter(keep)) : from);
  }
  return { ...modules, importers };
}

/**
 * The modules a diff reaches when some of it is data. Three walks over the module index, none
 * of which passes *through* a seed module:
 *
 *   1. code: `edited`, name by name. A seed scenario it reaches is data, handed to walk 2; the
 *      orchestrator or the dev credentials is every capture (`{ all }`).
 *   2. data: the scenarios `data` names and walk 1 reached, followed into the scenarios that
 *      import them. The tables each one's touched items write (`tablesWritten`) are what the
 *      edit writes differently.
 *   3. schema: `schema`'s changed lines and the tables of walk 2, name by name to their readers.
 *
 * Returns `{ reached }` (every module touched outside the seed) or `{ all }`.
 */
export function dataReach(
  modules,
  { edited = new Map(), data = new Map(), schema = new Map(), before },
) {
  const { index } = modules;
  const outside = sealed(modules);
  const reached = new Set();
  const scenarios = new Map(data);
  for (const [file, exports] of symbolReach(outside, edited, { before })) {
    if (!SEED.test(file)) {
      if (EVERYWHERE.test(file)) {
        return { all: `the diff reaches ${file}, which builds the data every capture shows` };
      }
      reached.add(file);
      continue;
    }
    if (EVERYWHERE.test(file) && file === "src/db/seed.ts") {
      return { all: `the diff reaches ${file}, which builds the data every capture shows` };
    }
    if (scenarios.has(file)) continue;
    const parsed = index.get(file);
    const at =
      exports === ALL_LINES
        ? ALL_LINES
        : parsed.items.filter((it) => it.exports.some((name) => exports.has(name)));
    if (at === ALL_LINES || at.length > 0) {
      scenarios.set(file, at === ALL_LINES ? at : at.map((it) => it.start));
    }
  }
  // Scenario to scenario only: the orchestrator imports every one and writes nothing of theirs.
  const amongSeeds = sealed(modules, (from) => SEED.test(from) && from !== "src/db/seed.ts");
  const tables = new Map(schema);
  const touched = symbolReach(amongSeeds, scenarios, { before });
  for (const [file, exports] of touched) {
    const parsed = index.get(file);
    const lines = scenarios.get(file);
    let items;
    if (lines === ALL_LINES || exports === ALL_LINES) items = parsed.items;
    else {
      items = parsed.items.filter(
        (it) =>
          it.kind === "declaration" &&
          (it.exports.some((name) => exports.has(name)) ||
            [...(lines ?? [])].some((line) => line >= it.start && line <= it.end) ||
            parsed.imports.some(
              ({ local, target, imported }) =>
                it.names.has(local) &&
                touched.get(target) !== undefined &&
                (touched.get(target) === ALL_LINES || touched.get(target).has(imported)),
            )),
      );
    }
    for (const { target, imported } of tablesWritten(index, parsed, items)) {
      const declared = declarationOf(index, target, imported);
      if (!declared) return { all: `${file} writes ${imported}, which no schema module declares` };
      const prior = tables.get(declared.file);
      if (prior === ALL_LINES) continue;
      tables.set(declared.file, new Set([...(prior ?? []), declared.line]));
    }
  }
  // Not the proxy either: it reads a table to decide whether a public route exists, and that
  // route's own page reads the same table, so the walk has reached it already.
  for (const file of symbolReach(outside, tables, { before }).keys()) {
    if (!SEED.test(file) && !RUNTIME_ROOT.test(file)) reached.add(file);
  }
  return { reached };
}

/**
 * Why `changed` cannot be bounded (a reason to capture everything), or the routes it reaches:
 * `{ all: string }` or `{ routes: [{ route, broad }], boundaries, visualSpec, helpersEdited }`:
 * `boundaries` are the not-found and error pages edited (`{ route, boundary }`); the two flags
 * say {@link editedCaptures} must read the visual spec's or `e2e/helpers.ts`'s changed lines.
 *
 * `context` reads what a path alone cannot say; each piece left out falls back to capturing
 * everything for the files that need it:
 *   - `before(file)` / `after(file)`: the file's text at the fork point / at HEAD, null when it
 *     does not exist there (a locale bundle, `package.json`, a deleted module);
 *   - `sources`: `src/` text by path, to find who names a message key or an asset;
 *   - `configImports`: the `src/` modules `next.config.ts` imports;
 *   - `lines`: each changed `src/` file's changed lines, and `modules`: the
 *     `symbol-reach.mjs` index, to follow an edit name by name (without them, a module reaches
 *     every page that imports it, through any chain).
 */
export function changedRoutes(changed, graph, context = {}) {
  const { before, after, sources, configImports = [], lines, modules } = context;
  const routes = new Map();
  const add = (route) => {
    const key = route.route;
    const prior = routes.get(key);
    routes.set(key, { route: key, broad: Boolean(prior?.broad || route.broad) });
  };
  // Modules the diff changes, each with its changed lines or "all".
  const edited = new Map();
  const seed = (file, at) => {
    const prior = edited.get(file);
    if (prior === "all" || at === "all") edited.set(file, "all");
    else edited.set(file, new Set([...(prior ?? []), ...at]));
  };
  const seedAll = (found) => {
    for (const [file, at] of found) seed(file, at);
  };
  // Seed scenarios and schema modules the diff changes: data, followed to its readers below.
  const data = new Map();
  const schema = new Map();
  let visualSpec = false;
  let helpersEdited = false;
  const boundaries = [];
  // A layout or loading state draws every page beneath it; a not-found or error page draws only
  // the captures that hit it.
  const addEntry = (file) => {
    const route = routeOf(file);
    if (!route) return;
    const boundary = file.match(/\/(not-found|error)\.tsx?$/)?.[1];
    if (boundary) boundaries.push({ route: route.route, boundary });
    else add(route);
  };
  for (const file of changed) {
    if (INERT.test(file)) continue;
    if (isVisualSpec(file)) {
      visualSpec = true;
      continue;
    }
    if (file.startsWith("scripts/") || file.startsWith(".github/")) {
      if (VISUAL_PLUMBING.test(file)) return { all: `${file} is the capture's own plumbing` };
      continue;
    }
    if (file === "e2e/helpers.ts") {
      helpersEdited = true;
      continue;
    }
    if (file.startsWith("e2e/")) return { all: `${file} is the capture harness` };
    if (file.startsWith("config/") && CODE.test(file)) {
      if (!sources) return { all: `${file} was not traced to its importers` };
      seedAll(namedBy([file.replace(/\.[^.]+$/, "")], sources));
      continue;
    }
    if (file === "package.json") {
      if (!before || !after) return { all: "package.json was not read" };
      const why = packageJsonReach(before(file), after(file));
      if (why) return { all: why };
      continue;
    }
    if (file.startsWith("public/")) {
      if (!sources) return { all: `${file} was not traced to its consumers` };
      const consumers = assetConsumers(file, sources);
      const css = [...consumers.keys()].find((consumer) => !CODE.test(consumer));
      if (css) return { all: `${file} is named by ${css}, which no import can follow` };
      seedAll(consumers);
      continue;
    }
    if (LOCALE.test(file)) {
      if (!sources || !before || !after) return { all: `${file} was not traced to its keys` };
      let keys;
      try {
        keys = changedMessageKeys(file, before(file), after(file));
      } catch {
        return { all: `${file} could not be parsed` };
      }
      for (const { key, removed } of keys) {
        if (removed) continue;
        // A key no module names is not on any screen (`check:copy` reports it as unused).
        for (const [consumer, at] of messageConsumers(key, sources)) {
          if (CODE.test(consumer)) seed(consumer, at);
        }
      }
      continue;
    }
    if (!file.startsWith("src/")) return { all: `${file} can reach every page` };
    if (EVERYWHERE.test(file)) return { all: `${file} is data every capture shows` };
    if (SEED.test(file) || SCHEMA.test(file)) {
      if (!modules?.index.has(file)) {
        // Deleted: what read or ran it is in the same diff.
        if (modules && after && after(file) === null) continue;
        return { all: `${file} is data the import graph does not hold` };
      }
      (SEED.test(file) ? data : schema).set(file, lines?.get(file) ?? "all");
      continue;
    }
    if (file.endsWith(".json") && sources) {
      // Data a module imports (`src/content/*.json`): its importers carry the reach.
      seedAll(namedBy([`/${file.split("/").pop()}`], sources));
      continue;
    }
    if (!CODE.test(file)) return { all: `${file} is not code an import can be followed through` };
    if (file.startsWith("src/app/")) {
      addEntry(file);
      // A route's own component can be imported by another route's page too.
      if (modules && graph.has(file)) seed(file, lines?.get(file) ?? "all");
      continue;
    }
    if (!graph.has(file)) {
      // Deleted: every module that imported it is in the same diff, and carries the reach.
      if (after && after(file) === null) continue;
      return { all: `${file} is not in the import graph` };
    }
    seed(file, lines?.get(file) ?? "all");
  }
  // The modules the edits reach: name by name when the module index is given, else file by file.
  const reached = new Set();
  if (modules) {
    const reach = dataReach(modules, { edited, data, schema, before });
    if (reach.all) return { all: reach.all };
    for (const file of reach.reached) reached.add(file);
  } else {
    for (const file of edited.keys()) {
      if (graph.has(file)) for (const importer of importersOf(graph, [file])) reached.add(importer);
    }
    // An edit the seed runs (a write helper it calls) changes the data every capture shows.
    const seeded = [...reached].find((f) => EVERYWHERE.test(f) || SEED.test(f));
    if (seeded) {
      return { all: `the diff reaches ${seeded}, which builds the data every capture shows` };
    }
  }
  const root = [...reached].find((f) => RUNTIME_ROOT.test(f) || configImports.includes(f));
  if (root) return { all: `the diff reaches ${root}, which runs for every page` };
  // A module no page reaches (a test fixture, a script's helper) moves no capture.
  for (const entry of [...reached].filter((f) => ENTRY.test(f))) addEntry(entry);
  return { routes: [...routes.values()], boundaries, visualSpec, helpersEdited };
}

/** A route or a literal path, as segments; a `[param]` or `${…}` segment matches anything. */
function segmentsOf(route) {
  return route
    .split("/")
    .filter(Boolean)
    .map((segment) => (/^\[.*\]$|\$\{/.test(segment) ? null : segment));
}

/** `prefix` names `route` or an ancestor of it, segment by segment. */
export function covers(prefix, route) {
  const a = segmentsOf(prefix);
  const b = segmentsOf(route);
  if (a.length > b.length) return false;
  return a.every((segment, i) => segment === null || b[i] === null || segment === b[i]);
}

/** Every app path a source text names in a string literal. */
export function literalPaths(text) {
  const paths = new Set();
  const SEGMENT = String.raw`(?:[\w.~%[\]-]+|\$\{[^}]+\})`;
  const pattern = new RegExp(
    String.raw`["'\`](\/${SEGMENT}(?:\/${SEGMENT})*\/?|\/)(?=["'\`?#])`,
    "g",
  );
  for (const match of text.matchAll(pattern)) {
    const found = match[1];
    if (/^\/(?:_next|api\/test)\b/.test(found)) continue;
    // A bare "/" is far more often `split("/")` than the landing page, and as a path it would
    // cover every route; it counts only as a navigation's own argument.
    if (
      found === "/" &&
      !/\.goto\(\s*$/.test(text.slice(Math.max(0, match.index - 12), match.index))
    ) {
      continue;
    }
    paths.add(found.replace(/\/$/, "") || "/");
  }
  return paths;
}

/**
 * Top-level declarations in a module, with the lines they span (1-based): a function's body, or
 * a constant's statement (a path is often a constant,
 * `const BOARD = "/shop/blue-mantis/schedule/board"`).
 */
export function helperSpans(source) {
  const lines = source.split("\n");
  const spans = [];
  const FUNCTION = /^(\s*)(?:export\s+)?(?:async\s+)?function\s+(\w+)\b/;
  // A constant at the top level, or a function-valued one at any depth (a describe block's own
  // `const openWalkIn = async (page) => {`).
  const CONSTANT = /^(\s*)(?:export\s+)?(?:const|let)\s+(\w+)\b(.*)$/;
  for (let i = 0; i < lines.length; i += 1) {
    const fn = lines[i].match(FUNCTION);
    const constant = fn ? null : lines[i].match(CONSTANT);
    const match = fn ?? constant;
    if (!match) continue;
    const indent = match[1];
    if (constant && indent !== "" && !/=\s*(?:async\s*)?(?:\(|\w+\s*=>)/.test(constant[3]))
      continue;
    const block = Boolean(fn) || /[{([]\s*$/.test(lines[i]);
    const closes = new RegExp(`^${indent}[})\\]]`);
    let end = i;
    if (block || !/;\s*$/.test(lines[i])) {
      // A block runs to its closing bracket at its own indent; a statement to its semicolon.
      while (
        end < lines.length - 1 &&
        !(block ? end > i && closes.test(lines[end]) : /;\s*$/.test(lines[end]))
      ) {
        end += 1;
      }
    }
    spans.push({
      name: match[2],
      start: i + 1,
      end: end + 1,
      body: lines.slice(i, end + 1).join("\n"),
    });
  }
  return spans;
}

/** {@link helperSpans} by name, a name declared twice keeping both bodies. */
export function helperBodies(source) {
  const bodies = new Map();
  for (const { name, body } of helperSpans(source)) {
    bodies.set(name, bodies.has(name) ? `${bodies.get(name)}\n${body}` : body);
  }
  return bodies;
}

/** The text a capture reads: its own lines and the helpers and constants it names, transitively. */
function captureText(block, helpers) {
  const seen = new Set();
  const parts = [block];
  const queue = [block];
  while (queue.length > 0) {
    const text = queue.pop();
    for (const match of text.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
      const name = match[1];
      if (seen.has(name) || !helpers.has(name)) continue;
      seen.add(name);
      parts.push(helpers.get(name));
      queue.push(helpers.get(name));
    }
  }
  return { text: parts.join("\n"), names: seen };
}

/** The new-side line numbers a `git diff -U0` touches in one file; a pure deletion marks both neighbours. */
export function changedLines(diffText) {
  const lines = new Set();
  for (const match of diffText.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) {
      lines.add(start);
      lines.add(start + 1);
    }
    for (let line = start; line < start + count; line += 1) lines.add(line);
  }
  return lines;
}

/**
 * Every listed capture with its `--test-list` line and the source lines it spans: from its own
 * line to the next listed test's. Two captures made in one loop (light and dark) share a line and
 * so a span.
 */
export function captureSpans(report, sourceLines, visualSources = new Map()) {
  const tests = [];
  function walk(suite, titles, file) {
    for (const spec of suite.specs ?? []) {
      tests.push({
        line: testListLine(spec.file ?? file, [...titles, spec.title]),
        at: spec.line,
        file: path.basename(spec.file ?? file),
        rootFile: path.basename(file),
      });
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title], file);
  }
  for (const suite of report?.suites ?? []) walk({ ...suite, specs: suite.specs }, [], suite.file);
  return tests.map((test) => {
    const lines =
      visualSources.get(test.file)?.split("\n") ??
      (test.file === test.rootFile ? sourceLines : undefined);
    if (!lines) return { ...test, text: "", sourceMissing: true };
    const starts = [
      ...new Set(tests.filter((other) => other.file === test.file).map((other) => other.at)),
    ].sort((a, b) => a - b);
    const next = starts.find((start) => start > test.at) ?? lines.length + 1;
    return { ...test, text: lines.slice(test.at - 1, next - 1).join("\n") };
  });
}

/**
 * What an edit to the visual spec `file` recaptures: the captures whose test body holds a changed
 * line, and those that call (transitively) a helper whose lines changed. A changed line in
 * neither (an import, a `beforeEach`, a describe's options) can move any capture: `{ all }`.
 */
export function editedCaptures(spans, source, changed, file = "the visual spec") {
  const sourceLines = source.split("\n");
  const helpers = helperSpans(source);
  const touched = new Set();
  const bodies = [...new Set(spans.map((span) => span.at))].map((at) => {
    const indent = sourceLines[at - 1]?.match(/^\s*/)[0] ?? "";
    let end = at;
    const closes = new RegExp(`^${indent}\\}\\);?\\s*$`);
    while (end < sourceLines.length && !closes.test(sourceLines[end])) {
      end += 1;
    }
    return { at, end: end + 1 };
  });
  const hitAt = new Set();
  for (const line of changed) {
    if (line > sourceLines.length) continue;
    const body = bodies.find((b) => line >= b.at && line <= b.end);
    if (body) {
      hitAt.add(body.at);
      continue;
    }
    const helper = helpers.find((h) => line >= h.start && line <= h.end);
    if (helper) {
      touched.add(helper.name);
      continue;
    }
    if (/^\s*(?:\/\/.*)?$/.test(sourceLines[line - 1] ?? "")) continue;
    return { all: `${file} line ${line} sits outside every capture and helper` };
  }
  return { at: hitAt, helpers: touched };
}

/**
 * The helpers an edit to a helper module touches, by name, or `{ all }` when a changed line sits
 * outside every helper (an import, a module-level statement).
 */
export function editedHelpers(source, changed) {
  const sourceLines = source.split("\n");
  const helpers = helperSpans(source);
  const touched = new Set();
  for (const line of changed) {
    if (line > sourceLines.length) continue;
    const helper = helpers.find((h) => line >= h.start && line <= h.end);
    if (helper) touched.add(helper.name);
    else if (!/^\s*(?:\/\/.*|\*.*|\/\*.*)?$/.test(sourceLines[line - 1] ?? "")) {
      return { all: `e2e/helpers.ts line ${line} sits outside every helper` };
    }
  }
  return { helpers: touched };
}

/**
 * The selection. Returns `{ mode: "all", why }` or `{ mode: "affected", lines, why }`, where
 * `lines` is the set of `--test-list` lines to capture. `context` is {@link changedRoutes}'s;
 * `visualLines` and `helperLines` the new-side lines a diff changes in the visual spec `file`
 * (whose text is `source`) and `e2e/helpers.ts` (whose text is `helpersSource`).
 */
export function selectCaptures({
  changed,
  graph,
  report,
  source,
  helpers,
  context = {},
  visualLines,
  helperLines,
  helpersSource,
  visualSources = new Map(),
  file = "the visual spec",
}) {
  const reach = changedRoutes(changed, graph, context);
  if (reach.all) return { mode: "all", why: reach.all };
  const spans = captureSpans(report, source.split("\n"), visualSources);
  const missing = spans.find((span) => span.sourceMissing);
  if (missing)
    return { mode: "all", why: `${missing.file} was not read for its capture locations` };
  let edits = { at: new Set(), helpers: new Set() };
  if (reach.visualSpec) {
    if (!visualLines) return { mode: "all", why: `${file} changed in lines not read` };
    edits = editedCaptures(
      spans.filter((span) => span.file === span.rootFile),
      source,
      visualLines,
      file,
    );
    if (edits.all) return { mode: "all", why: edits.all };
  }
  if (reach.helpersEdited) {
    if (!helperLines || helpersSource === undefined) {
      return { mode: "all", why: "e2e/helpers.ts changed in lines not read" };
    }
    const touched = editedHelpers(helpersSource, helperLines);
    if (touched.all) return { mode: "all", why: touched.all };
    for (const name of touched.helpers) edits.helpers.add(name);
  }
  const lines = new Set();
  const why = new Map();
  for (const span of spans) {
    if (SMOKE.some((pattern) => pattern.test(span.line))) {
      lines.add(span.line);
      why.set(span.line, "smoke");
      continue;
    }
    const localHelpers = helperBodies(visualSources.get(span.file) ?? "");
    const read = captureText(span.text, new Map([...helpers, ...localHelpers]));
    const helper = [...read.names].find((name) => edits.helpers.has(name));
    if ((span.file === span.rootFile && edits.at.has(span.at)) || helper) {
      lines.add(span.line);
      why.set(span.line, helper ? `calls ${helper}, which changed` : "its lines changed");
      continue;
    }
    const named = literalPaths(read.text);
    const boundary = (reach.boundaries ?? []).find(
      ({ route, boundary: kind }) =>
        new RegExp(kind === "error" ? String.raw`\berror\b` : "not[- ]found", "i").test(
          span.text,
        ) &&
        (route === "/" || [...named].some((visited) => covers(route, visited))),
    );
    if (boundary) {
      lines.add(span.line);
      why.set(
        span.line,
        `shows ${boundary.route === "/" ? "" : boundary.route}/${boundary.boundary}`,
      );
      continue;
    }
    if (named.size === 0) {
      lines.add(span.line);
      why.set(span.line, "names no route");
      continue;
    }
    for (const changedRoute of reach.routes) {
      const hit = [...named].find(
        (visited) =>
          covers(visited, changedRoute.route) ||
          (changedRoute.broad && covers(changedRoute.route, visited)),
      );
      if (hit) {
        lines.add(span.line);
        why.set(span.line, `${hit} → ${changedRoute.route}`);
        break;
      }
    }
  }
  return { mode: "affected", lines, why };
}

/** `report` with only the specs `keep` names, and no suite left empty. */
export function filterReport(report, keep) {
  function prune(suite, titles, file) {
    const specs = (suite.specs ?? []).filter((spec) =>
      keep.has(testListLine(spec.file ?? file, [...titles, spec.title])),
    );
    const suites = (suite.suites ?? [])
      .map((child) => prune(child, [...titles, child.title], file))
      .filter((child) => child.specs.length > 0 || child.suites.length > 0);
    return { ...suite, specs, suites };
  }
  return {
    ...report,
    suites: (report.suites ?? [])
      .map((suite) => prune(suite, [], suite.file))
      .filter((suite) => suite.specs.length > 0 || suite.suites.length > 0),
  };
}

// These suites assert capture plumbing, geometry, or PDF rendering without publishing PNGs.
const NO_SCREENSHOT_SPEC_FILES = new Set([
  "visual-capture-harness.spec.ts",
  "visual-consistency.spec.ts",
  "visual-print-departure-paper.spec.ts",
]);

const NO_SCREENSHOT_TESTS = new Map([
  [
    "visual-audit-remaining-expanded.ts",
    new Set(["the party link disclosure shows the complete claim URL"]),
  ],
  [
    "visual-print-filter-context.spec.ts",
    new Set(["printed roster states its visible subset rather than a web page number"]),
  ],
  [
    "visual-print.spec.ts",
    new Set(["every sheet of an expanded crew rota renders context and warning ink"]),
  ],
  [
    "visual-staff-today.spec.ts",
    new Set(["grouped departure links have a usable touch target and keyboard focus"]),
  ],
]);

/** Test IDs for planned visual tests that must produce at least one PNG. */
export function expectedCaptureTestIds(report) {
  const ids = [];
  function walk(suite, file) {
    const suiteFile = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      const specFile = path.basename(spec.file ?? suiteFile);
      if (
        NO_SCREENSHOT_SPEC_FILES.has(specFile) ||
        NO_SCREENSHOT_TESTS.get(specFile)?.has(spec.title)
      ) {
        continue;
      }
      if (typeof spec.id !== "string" || spec.id.length < 1 || spec.id.length > 512) {
        throw new Error(`visual capture plan has no stable Playwright test ID: ${specFile}`);
      }
      ids.push(spec.id);
    }
    for (const child of suite.suites ?? []) walk(child, suiteFile);
  }
  for (const suite of report?.suites ?? []) walk(suite, suite.file ?? "");
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new Error("visual capture plan must contain unique screenshot test IDs");
  }
  return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * How many shards a selection needs: as many as keep each near the full run's per-shard weight,
 * never more than {@link FULL_SHARDS} and never more than there are captures to deal.
 */
export function shardCount(lines, durations) {
  const all = Object.values(durations).filter((ms) => Number.isFinite(ms) && ms > 0);
  if (all.length === 0) return Math.max(1, Math.min(FULL_SHARDS, lines.length));
  const mean = all.reduce((sum, ms) => sum + ms, 0) / all.length;
  const perShard = all.reduce((sum, ms) => sum + ms, 0) / FULL_SHARDS;
  const weight = lines.reduce((sum, line) => sum + (durations[line] ?? mean), 0);
  return Math.max(1, Math.min(FULL_SHARDS, lines.length, Math.ceil(weight / perShard)));
}

function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

/** `src/` text by path, tests left out: where a message key or an asset path is named. */
export function readSources(root = ROOT) {
  const sources = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (
        /\.(?:ts|tsx|mts|mjs|js|jsx|json|css)$/.test(rel) &&
        !/\.test\.[^/]+$/.test(rel) &&
        !/^src\/i18n\/locales\//.test(rel)
      ) {
        sources.set(rel, readFileSync(path.join(root, rel), "utf8"));
      }
    }
  };
  walk("src");
  return sources;
}

/**
 * Everything {@link selectCaptures} reads from git and the tree, for a diff from `forkPoint` to
 * HEAD: the changed paths, the {@link changedRoutes} context, and the changed lines of the e2e
 * helpers (each visual spec's own are read per file, in {@link selectCaptureFiles}).
 */
export function diffContext({ root = ROOT, git = gitReader(root), forkPoint }) {
  const names = git(["diff", "--name-only", forkPoint, "HEAD"]);
  if (names === null) return null;
  const read = (file) => {
    try {
      return readFileSync(path.join(root, file), "utf8");
    } catch {
      return null;
    }
  };
  const nextConfig = read("next.config.ts") ?? "";
  const configImports = [...nextConfig.matchAll(/from\s+["']\.\/(src\/[^"']+)["']/g)].flatMap(
    ([, spec]) => [".ts", ".tsx", "/index.ts"].map((ext) => spec + ext),
  );
  const lines = (file) => {
    const text = git(["diff", "-U0", "--no-color", forkPoint, "HEAD", "--", file]);
    return text === null ? undefined : changedLines(text);
  };
  return {
    changed: names.split("\n").filter(Boolean),
    context: {
      before: (file) => git(["show", `${forkPoint}:${file}`]),
      after: read,
      sources: readSources(root),
      configImports,
      lines: changedLinesByFile(
        git(["diff", "-U0", "--no-color", forkPoint, "HEAD", "--", "src"]) ?? "",
      ),
      modules: moduleIndex(readModules(root)),
    },
    helperLines: lines("e2e/helpers.ts"),
    helpersSource: read("e2e/helpers.ts") ?? undefined,
  };
}

/**
 * A Playwright `--grep` for `lines`' light-mode captures only, the cheap local pass (#2517):
 * every capture waits for the state it photographs, so a moved heading fails it before CI does.
 */
export function lightGrep(lines) {
  const titles = [...lines]
    .filter((line) => / › light mode(?: [^›]*)? › /.test(line))
    .map((line) =>
      line
        .split(" › ")
        .at(-1)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
  return titles.length === 0 ? null : `(?:${titles.join("|")})$`;
}

/**
 * A pull request's captures in light mode only (A1, 2026-10-24): dark mode is 339 of 836
 * captures and ~40% of capture time, and a change that moves a dark pixel without moving the
 * light one is a colour token or a theme module, which {@link THEME} names. Returns
 * `{ lines }` without the dark captures, or `{ dark }` saying why they stay: a theme path in
 * the diff, or no diff to read (`changed` null).
 */
export function lightOnly(lines, changed) {
  if (changed === null) return { dark: "the diff could not be read" };
  const theme = changed.find((file) => THEME.test(file));
  if (theme) return { dark: `${theme} changes a colour token or theme` };
  return { lines: lines.filter((line) => !DARK.test(line)) };
}

/** Each spec owns its line numbers; never apply one file's spans to another. */
export function selectCaptureFiles({
  files,
  report,
  diff,
  graph,
  readSource,
  linesFor,
  visualSources = new Map(),
}) {
  const results = files.map((file) => {
    const source = readSource(file);
    const fileReport = {
      ...report,
      suites: report.suites.filter((suite) => path.basename(suite.file) === path.basename(file)),
    };
    // Another visual spec's edit is that file's own selection, never this one's.
    const changed = diff.changed.filter((name) => !files.includes(name) || name === file);
    const visualLines = linesFor(file);
    return selectCaptures({
      ...diff,
      changed,
      file,
      visualLines,
      graph,
      report: fileReport,
      source,
      visualSources,
      helpers: new Map([
        ...helperBodies(readSource("e2e/helpers.ts")),
        ...helperBodies(readSource("e2e/visual-harness.ts")),
        ...helperBodies(source),
      ]),
    });
  });
  return (
    results.find((item) => item.mode === "all") ?? {
      mode: "affected",
      lines: new Set(results.flatMap((item) => [...item.lines])),
      why: new Map(results.flatMap((item) => [...item.why])),
    }
  );
}

async function main() {
  const args = process.argv.slice(2);
  const listFile = option(args, "list");
  const outFile = option(args, "out");
  if (!listFile || !outFile) {
    console.error(
      "usage: node scripts/visual-affected.mjs --list <json> --out <json> [--base <ref>] [--all] [--light-only] [--github-output] [--grep <file>]",
    );
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(listFile, "utf8"));
  const every = listedTests(report);
  let result;
  // The diff's paths, or null when there is no diff to read (dark mode is then kept).
  let changedFiles = null;
  if (args.includes("--all")) {
    result = { mode: "all", why: "complete visual capture requested" };
  } else {
    const git = gitReader(ROOT);
    const base = option(args, "base") ?? "origin/main";
    const forkPoint = git(["merge-base", base, "HEAD"]);
    const diff = forkPoint ? diffContext({ git, forkPoint }) : null;
    if (diff === null) {
      result = { mode: "all", why: `git could not diff against ${base}` };
    } else {
      changedFiles = diff.changed;
      result = selectCaptureFiles({
        files: visualSpecs(ROOT),
        report,
        diff,
        graph: importGraph(ROOT),
        visualSources: await collectVisualSources(ROOT),
        readSource: (file) => readFileSync(path.join(ROOT, file), "utf8"),
        linesFor: (file) => changedLines(git(["diff", "--unified=0", forkPoint, "--", file]) ?? ""),
      });
    }
  }

  let durations = {};
  try {
    durations =
      JSON.parse(readFileSync(path.join(ROOT, "scripts/e2e-durations.json"), "utf8")).visual ?? {};
  } catch {}
  let chosen = result.mode === "all" ? every : every.filter((line) => result.lines.has(line));
  let mode = result.mode;
  let schemes = "";
  if (args.includes("--light-only")) {
    const light = lightOnly(chosen, changedFiles);
    if (light.dark) schemes = ` Dark mode too: ${light.dark}.`;
    else {
      chosen = light.lines;
      if (mode === "all") mode = "light";
      schemes = " Light mode only; the dark captures are the baseline's own (main captures both).";
    }
  }
  const filtered = mode === "all" ? report : filterReport(report, new Set(chosen));
  writeFileSync(
    outFile,
    JSON.stringify({ ...filtered, expectedCaptureTestIds: expectedCaptureTestIds(filtered) }),
  );
  const grepFile = option(args, "grep");
  if (grepFile) writeFileSync(grepFile, lightGrep(chosen) ?? "");
  const shards = mode === "all" ? FULL_SHARDS : shardCount(chosen, durations);

  const headline =
    mode === "all"
      ? `visual-affected: all ${every.length} captures on ${shards} shards — ${result.why}.${schemes}`
      : mode === "light"
        ? `visual-affected: ${chosen.length} of ${every.length} captures (every light-mode one) on ${shards} shard(s) — ${result.why}.${schemes}`
        : `visual-affected: ${chosen.length} of ${every.length} captures on ${shards} shard(s); the rest are copied from the baseline before the compare.${schemes}`;
  console.log(headline);
  if (mode === "affected") {
    for (const line of chosen) console.log(`  ${line}  — ${result.why.get(line)}`);
  }
  if (args.includes("--github-output") && process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `mode=${mode}`,
        `count=${shards}`,
        `shards=${JSON.stringify(Array.from({ length: shards }, (_, i) => i + 1))}`,
        `captured=${chosen.length}`,
        `total=${every.length}`,
        "",
      ].join("\n"),
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${headline}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
