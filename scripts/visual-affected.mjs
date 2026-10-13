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
// removes captures nothing could have moved: anything under `e2e/` but another spec (the
// harness, the helpers, the visual spec itself), the visual plumbing in `scripts/` and the CI
// workflow, the seed and the schema, a stylesheet, a locale bundle, `public/`, a root config,
// and any `src/` module that reaches no page.
//
// Which routes a capture visits is read from its own source: the test's lines in
// `e2e/visual.spec.ts` and the bodies of the helpers it calls (the spec's own and
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
//        [--base <ref>] [--all] [--github-output]

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { importersOf, importGraph, routeOf } from "./e2e-affected.mjs";
import { listedTests } from "./e2e-shard.mjs";
import { gitReader } from "./stack-map.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The visual run's shard count when it captures everything. */
export const FULL_SHARDS = 8;

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

/** Paths no capture can move: docs, playbooks, infrastructure, unit tests, other specs. */
const INERT =
  /^(?:docs\/|\.claude\/|infra\/|LICENSE$)|\.md$|(?:^|\/)[^/]+\.test\.(?:ts|tsx|mts|mjs|js)$|^e2e\/(?!visual\.spec\.ts$)[^/]+\.spec\.ts$/;

/** `scripts/` and `.github/` are inert except the files the capture or the build runs. */
const VISUAL_PLUMBING =
  /^scripts\/(?:visual-|e2e-shard|reg-suit-keys|wait-for-baseline|build-service-worker|check-e2e-build)|^\.github\/(?:workflows\/ci\.yml|actions\/)/;

/** `src/` paths whose blast radius is every page: the data every capture shows. */
const EVERYWHERE = /^src\/db\/(?:seed|schema\/|dev-credentials)/;

const CODE = /\.(?:ts|tsx|mts|mjs|js|jsx)$/;
const ENTRY = /\/(?:page|layout|route|template|loading|default|not-found|error)\.tsx?$/;

/**
 * Why `changed` cannot be bounded (a reason to capture everything), or the routes it reaches:
 * `{ all: string }` or `{ routes: [{ route, broad }] }`.
 */
export function changedRoutes(changed, graph) {
  const routes = new Map();
  const add = (route) => {
    const key = route.route;
    const prior = routes.get(key);
    routes.set(key, { route: key, broad: Boolean(prior?.broad || route.broad) });
  };
  const edited = [];
  for (const file of changed) {
    if (INERT.test(file)) continue;
    if (file.startsWith("scripts/") || file.startsWith(".github/")) {
      if (VISUAL_PLUMBING.test(file)) return { all: `${file} is the capture's own plumbing` };
      continue;
    }
    if (file.startsWith("e2e/"))
      return { all: `${file} is the capture harness or the visual spec` };
    if (!file.startsWith("src/")) return { all: `${file} can reach every page` };
    if (EVERYWHERE.test(file)) return { all: `${file} is data every capture shows` };
    if (!CODE.test(file)) return { all: `${file} is not code an import can be followed through` };
    if (file.startsWith("src/app/")) {
      const route = routeOf(file);
      if (route) add(route);
      continue;
    }
    if (!graph.has(file)) {
      // Deleted, or not a module the graph read: its importers are not knowable from here.
      return { all: `${file} is not in the import graph` };
    }
    edited.push(file);
  }
  if (edited.length > 0) {
    for (const file of edited) {
      const reached = [...importersOf(graph, [file])].filter((f) => ENTRY.test(f));
      if (reached.length === 0) return { all: `${file} reaches no page, so its reach is unknown` };
      for (const entry of reached) {
        const route = routeOf(entry);
        if (route) add({ ...route, broad: false });
      }
    }
  }
  return { routes: [...routes.values()] };
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
 * Top-level declarations in a module, by name: a function's body, or a constant's statement (a
 * path is often a constant, `const BOARD = "/shop/blue-mantis/schedule/board"`).
 */
export function helperBodies(source) {
  const lines = source.split("\n");
  const bodies = new Map();
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
    const name = match[2];
    const body = lines.slice(i, end + 1).join("\n");
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
  return parts.join("\n");
}

/**
 * Every listed capture with its `--test-list` line and the source lines it spans: from its own
 * line to the next listed test's. Two captures made in one loop (light and dark) share a line and
 * so a span.
 */
export function captureSpans(report, sourceLines) {
  const tests = [];
  function walk(suite, titles, file) {
    for (const spec of suite.specs ?? []) {
      tests.push({ line: [file, ...titles, spec.title].join(" › "), at: spec.line });
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title], file);
  }
  for (const suite of report?.suites ?? []) walk({ ...suite, specs: suite.specs }, [], suite.file);
  const starts = [...new Set(tests.map((test) => test.at))].sort((a, b) => a - b);
  return tests.map((test) => {
    const next = starts.find((start) => start > test.at) ?? sourceLines.length + 1;
    return { ...test, text: sourceLines.slice(test.at - 1, next - 1).join("\n") };
  });
}

/**
 * The selection. Returns `{ mode: "all", why }` or `{ mode: "affected", lines, why }`, where
 * `lines` is the set of `--test-list` lines to capture.
 */
export function selectCaptures({ changed, graph, report, source, helpers }) {
  const reach = changedRoutes(changed, graph);
  if (reach.all) return { mode: "all", why: reach.all };
  const spans = captureSpans(report, source.split("\n"));
  const lines = new Set();
  const why = new Map();
  for (const span of spans) {
    if (SMOKE.some((pattern) => pattern.test(span.line))) {
      lines.add(span.line);
      why.set(span.line, "smoke");
      continue;
    }
    const named = literalPaths(captureText(span.text, helpers));
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
      keep.has([file, ...titles, spec.title].join(" › ")),
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

function main() {
  const args = process.argv.slice(2);
  const listFile = option(args, "list");
  const outFile = option(args, "out");
  if (!listFile || !outFile) {
    console.error(
      "usage: node scripts/visual-affected.mjs --list <json> --out <json> [--base <ref>] [--all] [--github-output]",
    );
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(listFile, "utf8"));
  const every = listedTests(report);
  let result;
  if (args.includes("--all")) {
    result = { mode: "all", why: "not a pull request: every capture, published as the baseline" };
  } else {
    const git = gitReader(ROOT);
    const base = option(args, "base") ?? "origin/main";
    const forkPoint = git(["merge-base", base, "HEAD"]);
    const names = forkPoint ? git(["diff", "--name-only", forkPoint, "HEAD"]) : null;
    if (names === null) {
      result = { mode: "all", why: `git could not diff against ${base}` };
    } else {
      result = selectCaptures({
        changed: names.split("\n").filter(Boolean),
        graph: importGraph(ROOT),
        report,
        source: readFileSync(path.join(ROOT, "e2e/visual.spec.ts"), "utf8"),
        helpers: new Map([
          ...helperBodies(readFileSync(path.join(ROOT, "e2e/helpers.ts"), "utf8")),
          ...helperBodies(readFileSync(path.join(ROOT, "e2e/visual.spec.ts"), "utf8")),
        ]),
      });
    }
  }

  let durations = {};
  try {
    durations =
      JSON.parse(readFileSync(path.join(ROOT, "scripts/e2e-durations.json"), "utf8")).visual ?? {};
  } catch {}
  const chosen = result.mode === "all" ? every : every.filter((line) => result.lines.has(line));
  const filtered = result.mode === "all" ? report : filterReport(report, result.lines);
  writeFileSync(outFile, JSON.stringify(filtered));
  const shards = result.mode === "all" ? FULL_SHARDS : shardCount(chosen, durations);

  const headline =
    result.mode === "all"
      ? `visual-affected: all ${every.length} captures on ${shards} shards — ${result.why}.`
      : `visual-affected: ${chosen.length} of ${every.length} captures on ${shards} shard(s); the rest are copied from the baseline before the compare.`;
  console.log(headline);
  if (result.mode === "affected") {
    for (const line of chosen) console.log(`  ${line}  — ${result.why.get(line)}`);
  }
  if (args.includes("--github-output") && process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `mode=${result.mode}`,
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
  main();
}
