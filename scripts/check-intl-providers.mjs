import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **Diver copy has a provider above it.** Every Client Component that calls
 * `useTranslations` must sit under a `DiverIntlProvider` (or the
 * `ErrorBoundaryIntlProvider`) carrying the namespaces it reads, or it renders
 * a blank page in production. A text scan over segments, not the true render
 * tree: a provider in an ancestor directory is assumed to wrap the component,
 * so it under-reports rather than over-reports, which is the right way round
 * for a guard whose failure mode is a blank page.
 *
 * A second pass covers the consumers the segment walk cannot see: a shared
 * Client Component under `src/components` has no route ancestry of its own, so
 * its provider is whichever page renders it. For each such consumer the guard
 * follows the import graph backwards to every route that pulls it in. A shared
 * server composition may carry the provider too, but only on an import path
 * that renders the consumer inside that provider; a neighboring component or
 * a second route that bypasses it does not count.
 * Moved from `src/i18n/provider-coverage.test.ts` (test review 2026-10-14, L2c).
 */

/** Segment files that can hold a provider above a component in the same directory. */
const SEGMENT_FILES = ["layout.tsx", "template.tsx", "page.tsx", "error.tsx"];

/**
 * The bearer-token routes and the public shop namespace whose `error.tsx` reads
 * `errorBoundary` copy. Staff boundaries are deliberately absent: they have no
 * client provider (ADR 20260803-error-boundary-copy-bridge).
 */
export const ERROR_BOUNDARIES_WITH_COPY = [
  "(token)/error.tsx",
  "(token)/recap/[token]/error.tsx",
  "(token)/waivers/[token]/error.tsx",
  "s/[shopSlug]/error.tsx",
];

/** `source` with its comments out; block comments first, then line comments. */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * The namespaces a provider in this source offers, or null when it mounts
 * none. `DiverIntlProvider` names them in a prop (inline, or a module-scope
 * `const NAME = [...]`); `ErrorBoundaryIntlProvider` carries exactly
 * `errorBoundary`, by construction.
 */
export function providedNamespaces(source) {
  const offered = new Set();
  if (source.includes("<ErrorBoundaryIntlProvider")) offered.add("errorBoundary");
  if (!source.includes("<DiverIntlProvider")) return offered.size > 0 ? offered : null;
  // `DiverIntlProvider` always carries the words bundle (src/i18n/DiverIntlProvider.tsx).
  offered.add("words");
  for (const block of source.matchAll(/namespaces=\{\[([^\]]*)\]\}/g)) {
    for (const name of block[1].matchAll(/"([^"]+)"/g)) offered.add(name[1]);
  }
  for (const prop of source.matchAll(/namespaces=\{([A-Z_][A-Z0-9_]*)\}/g)) {
    const list = source.match(new RegExp(`const ${prop[1]} = \\[([^\\]]*)\\]`));
    for (const name of list?.[1].matchAll(/"([^"]+)"/g) ?? []) offered.add(name[1]);
  }
  return offered;
}

/**
 * The namespaces a Client Component needs: `useTranslations("x")` names one;
 * a bare `useTranslations()` addresses the root, so each key's first segment.
 */
export function requiredNamespaces(source) {
  const needed = new Set();
  for (const call of source.matchAll(/useTranslations\(\s*"([^"]+)"\s*\)/g)) needed.add(call[1]);
  if (/useTranslations\(\s*\)/.test(source)) {
    for (const key of source.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)\./g)) needed.add(key[1]);
  }
  return needed;
}

function offeredAbove(app, file, sources) {
  const offered = new Set();
  let sawProvider = false;
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    for (const name of SEGMENT_FILES) {
      const namespaces = providedNamespaces(sources.get(path.join(directory, name)) ?? "");
      if (!namespaces) continue;
      sawProvider = true;
      for (const namespace of namespaces) offered.add(namespace);
    }
    if (directory === app || directory === path.dirname(directory)) break;
  }
  return { sawProvider, offered };
}

function resolveImport(root, importer, specifier, sources) {
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(root, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(importer), specifier);
  if (!base) return null;
  for (const candidate of [base, `${base}.tsx`, path.join(base, "index.tsx")]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

/** Value-import edges, including the local component names rendered by a wrapper. */
function importerGraph(root, sources) {
  const graph = new Map();
  for (const [file, source] of sources) {
    if (file.endsWith(".test.tsx")) continue;
    for (const match of source.matchAll(/\bimport\s+([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
      if (/^type\b/.test(match[1])) continue;
      const clause = match[1].trim();
      const bindings = clause
        .replace(/[{}]/g, "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name && !/^type\s/.test(name))
        .map((name) => {
          const parts = name.split(/\s+as\s+/);
          return { imported: parts[0].trim(), local: parts.at(-1).trim() };
        });
      if (bindings.length === 0) continue;
      const target = resolveImport(root, file, match[2], sources);
      if (!target) continue;
      const edges = graph.get(target) ?? [];
      edges.push({ importer: file, bindings });
      graph.set(target, edges);
    }
  }
  return graph;
}

/**
 * A multi-export client file can render different subtrees: the cancelled
 * notice does not render the booking form merely because both share a file.
 * Resolve named function exports when possible, retaining the whole source for
 * shapes this deliberately small source guard cannot distinguish.
 */
function importedRenderSource(source, bindings) {
  const declarations = [
    ...source.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)\b/g),
  ];
  const selected = declarations.filter((declaration) =>
    bindings.some((binding) => binding.imported === declaration[1]),
  );
  if (selected.length === 0) return source;
  return selected
    .map((declaration) => {
      const next = declarations.find((candidate) => candidate.index > declaration.index);
      return source.slice(declaration.index, next?.index ?? source.length);
    })
    .join("\n");
}

function combinedOffers(...proofs) {
  const offered = new Set();
  let sawProvider = false;
  for (const proof of proofs) {
    if (!proof) continue;
    sawProvider ||= proof.sawProvider;
    for (const namespace of proof.offered) offered.add(namespace);
  }
  return { sawProvider, offered };
}

/** A server wrapper supplies copy only to imported components inside its provider. */
function renderedProvider(source, names) {
  if (/^\s*["']use client["']/m.test(source)) return null;
  const offered = new Set();
  let sawProvider = false;
  for (const match of source.matchAll(
    /<(DiverIntlProvider|ErrorBoundaryIntlProvider)\b[\s\S]*?<\/\1\s*>/g,
  )) {
    const block = match[0];
    if (!names.some((name) => new RegExp(`<${name.replace(/\*/g, "")}\\b`).test(block))) {
      continue;
    }
    // Keep module-scope namespace lists available without borrowing another
    // provider's inline list in the same component.
    const constants = [...source.matchAll(/const\s+[A-Z_][A-Z0-9_]*\s*=\s*\[[^\]]*\]/g)]
      .map((constant) => constant[0])
      .join("\n");
    const namespaces = providedNamespaces(`${constants}\n${block}`);
    if (!namespaces) continue;
    sawProvider = true;
    for (const namespace of namespaces) offered.add(namespace);
  }
  return { sawProvider, offered };
}

/** A rendered server shell can put its own provider around the route's children. */
function renderedShellProviders(file, sources, graph) {
  const source = sources.get(file) ?? "";
  const offered = new Set();
  let sawProvider = false;
  for (const [target, edges] of graph) {
    for (const edge of edges) {
      if (edge.importer !== file) continue;
      const shell = importedRenderSource(sources.get(target) ?? "", edge.bindings);
      if (/^\s*["']use client["']/m.test(shell)) continue;
      for (const { local } of edge.bindings) {
        if (!new RegExp(`<${local}\\b[\\s\\S]*?<\\/${local}\\s*>`).test(source)) continue;
        for (const match of shell.matchAll(
          /<(DiverIntlProvider|ErrorBoundaryIntlProvider)\b[\s\S]*?<\/\1\s*>/g,
        )) {
          if (!/\{\s*children\s*\}/.test(match[0])) continue;
          const namespaces = providedNamespaces(match[0]);
          if (!namespaces) continue;
          sawProvider = true;
          for (const namespace of namespaces) offered.add(namespace);
        }
      }
    }
  }
  return { sawProvider, offered };
}

/** Every import route is checked separately, so a wrapped route cannot bless a bypass. */
function compositionOffers(app, consumer, sources, graph) {
  const results = [];
  const walk = (file, inherited, seen, throughNames, needed) => {
    const proof = combinedOffers(
      inherited,
      offeredAbove(app, file, sources),
      renderedShellProviders(file, sources, graph),
    );
    const isSegment =
      file.startsWith(app + path.sep) && SEGMENT_FILES.includes(path.basename(file));
    const parents = graph.get(file) ?? [];
    if (isSegment || parents.length === 0) {
      results.push({ ...proof, file, needed });
      return;
    }
    for (const { importer, bindings } of parents) {
      if (seen.has(importer)) continue;
      const rendered = importedRenderSource(sources.get(file) ?? "", bindings);
      if (throughNames && !throughNames.some((name) => new RegExp(`\\b${name}\\b`).test(rendered)))
        continue;
      const names = bindings.map((binding) => binding.local);
      walk(
        importer,
        combinedOffers(proof, renderedProvider(sources.get(importer) ?? "", names)),
        new Set([...seen, importer]),
        names,
        file === consumer ? requiredNamespaces(rendered) : needed,
      );
    }
  };
  walk(consumer, null, new Set([consumer]), null, requiredNamespaces(sources.get(consumer) ?? ""));
  return results.length ? results : [{ ...offeredAbove(app, consumer, sources), file: consumer }];
}

/** Every `src/app` file that imports `consumer`, through other shared components if need be. */
function appImportersOf(root, app, consumer, sources) {
  const importersOf = new Map();
  for (const [file, source] of sources) {
    // A type-only import renders nothing, so it is not a provider obligation.
    const valueImports = source.replace(/import\s+type\b[^;]*;/g, "");
    for (const match of valueImports.matchAll(/from\s+["']([^"']+)["']/g)) {
      const target = resolveImport(root, file, match[1], sources);
      if (!target) continue;
      const list = importersOf.get(target) ?? [];
      list.push(file);
      importersOf.set(target, list);
    }
  }
  const appFiles = new Set();
  const seen = new Set([consumer]);
  const queue = [consumer];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const importer of importersOf.get(current) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      if (importer.startsWith(app + path.sep)) appFiles.add(importer);
      else queue.push(importer);
    }
  }
  return [...appFiles].sort();
}

async function tsxFiles(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await tsxFiles(full, found);
    else if (entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const isClientConsumer = (source) =>
  /^\s*["']use client["']/m.test(source) && source.includes("useTranslations(");

/** Every problem under `root`. */
export async function providerProblems(root = process.cwd()) {
  const app = path.join(root, "src/app");
  const components = path.join(root, "src/components");
  const rel = (file) => path.relative(root, file).replaceAll(path.sep, "/");
  const sources = new Map();
  for (const file of [...(await tsxFiles(app)), ...(await tsxFiles(components))]) {
    sources.set(file, stripComments(await readFile(file, "utf8")));
  }
  const problems = [];
  const graph = importerGraph(root, sources);
  const check = (where, needed, { sawProvider, offered }, consumer) => {
    const via = consumer ? ` (rendering ${consumer})` : "";
    if (!sawProvider) {
      problems.push(
        `${where}${via}: calls useTranslations with no diver copy provider in any ancestor segment`,
      );
      return;
    }
    const missing = [...needed].filter((namespace) => !offered.has(namespace));
    if (missing.length > 0) {
      problems.push(`${where}${via}: provider is missing namespace(s) ${missing.join(", ")}`);
    }
  };

  let consumers = 0;
  for (const [file, source] of sources) {
    if (!file.startsWith(app + path.sep) || !isClientConsumer(source)) continue;
    consumers++;
    for (const proof of compositionOffers(app, file, sources, graph)) {
      check(rel(file), proof.needed ?? requiredNamespaces(source), proof);
    }
  }
  for (const [file, source] of sources) {
    if (!file.startsWith(components + path.sep) || file.endsWith(".test.tsx")) continue;
    if (!isClientConsumer(source)) continue;
    for (const proof of compositionOffers(app, file, sources, graph)) {
      if (!proof.file.startsWith(app + path.sep)) continue;
      check(rel(proof.file), proof.needed ?? requiredNamespaces(source), proof, rel(file));
    }
  }

  // Guards the guard: a shared consumer the graph must trace, and the error
  // boundaries that must keep reading copy, so a silent move cannot empty a pass.
  const shared = path.join(components, "BookingPartyFields.tsx");
  if (!sources.has(shared) || !requiredNamespaces(sources.get(shared)).has("party")) {
    problems.push(
      "src/components/BookingPartyFields.tsx moved or stopped reading `party`; update this guard",
    );
  } else if (appImportersOf(root, app, shared, sources).length === 0) {
    problems.push(
      "BookingPartyFields.tsx has no src/app importer; the shared-consumer pass is empty",
    );
  }
  const withCopy = [...sources]
    .filter(
      ([file, source]) =>
        path.basename(file) === "error.tsx" &&
        file.startsWith(app + path.sep) &&
        source.includes('useTranslations("errorBoundary")'),
    )
    .map(([file]) => path.relative(app, file).replaceAll(path.sep, "/"))
    .sort();
  if (JSON.stringify(withCopy) !== JSON.stringify(ERROR_BOUNDARIES_WITH_COPY)) {
    problems.push(
      `the error boundaries reading errorBoundary copy changed: found ${withCopy.join(", ")}; update ERROR_BOUNDARIES_WITH_COPY on purpose`,
    );
  }
  return { problems, consumers };
}

async function main() {
  const { problems, consumers } = await providerProblems();
  if (problems.length > 0) {
    console.error(`Diver copy without a provider:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`intl-providers: ${consumers} client consumers of diver copy sit under a provider`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
