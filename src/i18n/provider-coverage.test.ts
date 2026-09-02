import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The `DiverIntlProvider` footgun, as a test.
 *
 * A diver Client Component that calls `useTranslations()` without a provider
 * above it does not fail loudly: `NextIntlClientProvider`'s absence throws
 * during the *server* render, React falls back to rendering the route on the
 * client only, and the visitor gets a 200 with an empty page. Nothing in
 * `pnpm check` sees it, no unit test mounts the real route tree, and the
 * screenshot of a blank page looks like a slow load. It has bitten this repo
 * before (see `DiverIntlProvider.tsx`'s doc comment) and it bites hardest on
 * the surfaces nobody exercises by hand — which now includes seven
 * bearer-token `error.tsx` boundaries (ADR
 * 20260803-error-boundary-copy-bridge).
 *
 * So this walks the real route tree instead of a mock: every Client Component
 * under `src/app` that reads copy must have a segment file in its own or an
 * ancestor directory that mounts `<DiverIntlProvider>`, and that provider's
 * `namespaces` list must contain every namespace the component asks for. The
 * second half matters as much as the first: a namespace missing from the list
 * renders as its own raw key (`"booking.heading"`) rather than throwing, so an
 * incomplete list is a silent visual bug.
 *
 * It is deliberately a text scan, not a type-level or runtime check. There is
 * no way to ask React "was this component ever rendered under that provider",
 * and the alternative — booting the whole app per route — is not something a
 * unit suite can afford. The cost of the text scan is that it reasons about
 * *segments*, not the true render tree: a provider found in an ancestor
 * directory is assumed to wrap the component, which is how App Router segments
 * normally nest but is not guaranteed for a component a page renders
 * conditionally. It under-reports (a provider that exists but doesn't actually
 * wrap) rather than over-reports, which is the right way round for a guard
 * whose failure mode is a blank page.
 *
 * A second pass covers the consumers the segment walk cannot see: a shared
 * Client Component under `src/components` (e.g. `BookingPartyFields.tsx`) has
 * no route ancestry of its own, so its provider is whichever page renders it.
 * For each such consumer the test follows the import graph backwards — through
 * other shared components if needed — to every `src/app` file that pulls it
 * in, and requires *that* file's segment ancestry to offer the consumer's
 * namespaces. Same under-reporting bias: a consumer no `src/app` file imports
 * is skipped rather than guessed at.
 */

const APP = path.join(process.cwd(), "src/app");
const COMPONENTS = path.join(process.cwd(), "src/components");

/** Segment files that can hold a provider above a component in the same directory. */
const SEGMENT_FILES = ["layout.tsx", "template.tsx", "page.tsx", "error.tsx"];

/** Comments describe the footgun as often as they cause it — never scan them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function tsxFiles(directory: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await tsxFiles(full, found);
    else if (entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

/**
 * The namespaces a provider in this source offers, or null when it mounts none.
 *
 * Two providers count. `DiverIntlProvider` names its namespaces in a prop, so
 * they are read off the source. `ErrorBoundaryIntlProvider` carries exactly one
 * — `errorBoundary` — by construction rather than by configuration: it exists
 * to hold that namespace and nothing else, which is what lets it be
 * synchronous and keeps its segment layout out of the request (ADR
 * 20260804-instant-navigation). Hard-coding the name here rather than parsing
 * one is the honest reading of that component, and it stays honest because
 * `messages={{ errorBoundary: … }}` is the only thing it can provide.
 */
function providedNamespaces(source: string): Set<string> | null {
  const offered = new Set<string>();
  if (source.includes("<ErrorBoundaryIntlProvider")) offered.add("errorBoundary");
  if (!source.includes("<DiverIntlProvider")) return offered.size > 0 ? offered : null;
  for (const block of source.matchAll(/namespaces=\{\[([^\]]*)\]\}/g)) {
    for (const name of block[1].matchAll(/"([^"]+)"/g)) offered.add(name[1]);
  }
  return offered;
}

/**
 * The namespaces a Client Component needs. `useTranslations("x")` names one
 * outright; a bare `useTranslations()` addresses the bundle root, so the
 * namespace is the first segment of each key it goes on to translate.
 */
function requiredNamespaces(source: string): Set<string> {
  const needed = new Set<string>();
  for (const call of source.matchAll(/useTranslations\(\s*"([^"]+)"\s*\)/g)) needed.add(call[1]);
  if (/useTranslations\(\s*\)/.test(source)) {
    for (const key of source.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)\./g)) needed.add(key[1]);
  }
  return needed;
}

/** Union of namespaces offered by providers in this file's segment ancestry. */
function offeredAbove(
  file: string,
  sources: Map<string, string>,
): { sawProvider: boolean; offered: Set<string> } {
  const offered = new Set<string>();
  let sawProvider = false;
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    for (const name of SEGMENT_FILES) {
      const namespaces = providedNamespaces(sources.get(path.join(directory, name)) ?? "");
      if (!namespaces) continue;
      sawProvider = true;
      for (const namespace of namespaces) offered.add(namespace);
    }
    // The second guard only matters for a caller outside src/app, where the
    // walk would otherwise never meet APP and spin at the filesystem root.
    if (directory === APP || directory === path.dirname(directory)) break;
  }
  return { sawProvider, offered };
}

/** The scanned file a static import specifier lands on, or null for a package. */
function resolveImport(
  importer: string,
  specifier: string,
  sources: Map<string, string>,
): string | null {
  let base: string | null = null;
  if (specifier.startsWith("@/")) base = path.join(process.cwd(), "src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = path.resolve(path.dirname(importer), specifier);
  if (!base) return null;
  for (const candidate of [base, `${base}.tsx`, path.join(base, "index.tsx")]) {
    if (sources.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Every `src/app` file that (transitively, through other shared components)
 * imports `consumer`. This is what turns "which provider wraps a shared
 * component" — unanswerable from the component's own path — into the
 * checkable "which provider wraps each page that renders it".
 */
function appImportersOf(consumer: string, sources: Map<string, string>): string[] {
  const importersOf = new Map<string, string[]>();
  for (const [file, source] of sources) {
    // A type-only import renders nothing, so it is not a provider obligation.
    const valueImports = source.replace(/import\s+type\b[^;]*;/g, "");
    for (const match of valueImports.matchAll(/from\s+["']([^"']+)["']/g)) {
      const target = resolveImport(file, match[1], sources);
      if (!target) continue;
      const list = importersOf.get(target) ?? [];
      list.push(file);
      importersOf.set(target, list);
    }
  }

  const appFiles = new Set<string>();
  const seen = new Set<string>([consumer]);
  const queue = [consumer];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const importer of importersOf.get(current) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      if (importer.startsWith(APP + path.sep)) appFiles.add(importer);
      else queue.push(importer);
    }
  }
  return [...appFiles].sort();
}

describe("diver copy has a provider above it", () => {
  it("gives every client consumer of useTranslations a provider carrying its namespaces", async () => {
    const files = await tsxFiles(APP);
    const sources = new Map<string, string>();
    for (const file of files) sources.set(file, stripComments(await readFile(file, "utf8")));

    const failures: string[] = [];
    for (const [file, source] of sources) {
      if (!/^\s*["']use client["']/m.test(source)) continue;
      if (!source.includes("useTranslations(")) continue;

      const needed = requiredNamespaces(source);
      const { sawProvider, offered } = offeredAbove(file, sources);

      const where = path.relative(process.cwd(), file);
      if (!sawProvider) {
        failures.push(
          `${where}: calls useTranslations with no diver copy provider in any ancestor segment`,
        );
        continue;
      }
      const missing = [...needed].filter((namespace) => !offered.has(namespace));
      if (missing.length > 0) {
        failures.push(`${where}: provider is missing namespace(s) ${missing.join(", ")}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("routes each shared-component consumer through every src/app importer's provider", async () => {
    // The segment walk above cannot see a consumer under src/components — it
    // has no route ancestry. Its provider is whichever page renders it, so
    // every src/app file that (transitively) imports it must sit under a
    // provider carrying the consumer's namespaces.
    const files = [...(await tsxFiles(APP)), ...(await tsxFiles(COMPONENTS))];
    const sources = new Map<string, string>();
    for (const file of files) sources.set(file, stripComments(await readFile(file, "utf8")));

    const failures: string[] = [];
    for (const [file, source] of sources) {
      if (!file.startsWith(COMPONENTS + path.sep) || file.endsWith(".test.tsx")) continue;
      if (!/^\s*["']use client["']/m.test(source)) continue;
      if (!source.includes("useTranslations(")) continue;

      const needed = requiredNamespaces(source);
      const consumer = path.relative(process.cwd(), file);
      for (const importer of appImportersOf(file, sources)) {
        const { sawProvider, offered } = offeredAbove(importer, sources);
        const where = path.relative(process.cwd(), importer);
        if (!sawProvider) {
          failures.push(
            `${where}: renders ${consumer} (a useTranslations consumer) with no DiverIntlProvider in any ancestor segment`,
          );
          continue;
        }
        const missing = [...needed].filter((namespace) => !offered.has(namespace));
        if (missing.length > 0) {
          failures.push(
            `${where}: provider is missing namespace(s) ${missing.join(", ")} needed by ${consumer}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("finds BookingPartyFields as a traced shared consumer, so a silent move can't empty that scan", async () => {
    // Guards the guard, like the error-boundary assertion below: if the shared
    // consumer stopped being detected or lost all src/app importers, the
    // assertion above would pass vacuously.
    const files = [...(await tsxFiles(APP)), ...(await tsxFiles(COMPONENTS))];
    const sources = new Map<string, string>();
    for (const file of files) sources.set(file, stripComments(await readFile(file, "utf8")));

    const consumer = path.join(COMPONENTS, "BookingPartyFields.tsx");
    const source = sources.get(consumer);
    expect(source, "BookingPartyFields.tsx moved — update this test's path").toBeDefined();
    expect(requiredNamespaces(source ?? "")).toContain("party");
    expect(appImportersOf(consumer, sources).length).toBeGreaterThan(0);
  });

  it("finds the diver error boundaries, so a silent rename can't empty this scan", async () => {
    // Guards the guard: if `error.tsx` stopped reading copy, or the walk stopped
    // reaching these routes, the assertion above would pass vacuously.
    const consumers = (await tsxFiles(APP)).filter((file) => path.basename(file) === "error.tsx");
    const withCopy: string[] = [];
    for (const file of consumers) {
      const source = stripComments(await readFile(file, "utf8"));
      if (source.includes('useTranslations("errorBoundary")')) {
        withCopy.push(path.relative(APP, file).replaceAll(path.sep, "/"));
      }
    }
    // The eight bearer-token routes plus the public shop namespace. Staff
    // boundaries are deliberately absent — `staff-messages.ts` has no client
    // provider, so their remainder is named in ADR
    // 20260803-error-boundary-copy-bridge rather than covered here.
    expect(withCopy.sort()).toEqual([
      "claim/[token]/error.tsx",
      "confirm-contact/[token]/error.tsx",
      "invite/[token]/error.tsx",
      "ready/[token]/error.tsx",
      "recap/[token]/error.tsx",
      "reset-password/[token]/error.tsx",
      "s/[shopSlug]/error.tsx",
      "unsubscribe/[token]/error.tsx",
      "verify/[token]/error.tsx",
      "waivers/[token]/error.tsx",
    ]);
  });
});
