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
 */

const APP = path.join(process.cwd(), "src/app");

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
      const offered = new Set<string>();
      let sawProvider = false;
      for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
        for (const name of SEGMENT_FILES) {
          const namespaces = providedNamespaces(sources.get(path.join(directory, name)) ?? "");
          if (!namespaces) continue;
          sawProvider = true;
          for (const namespace of namespaces) offered.add(namespace);
        }
        if (directory === APP) break;
      }

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
    // The seven bearer-token routes plus the public shop namespace. Staff
    // boundaries are deliberately absent — `staff-messages.ts` has no client
    // provider, so their remainder is named in ADR
    // 20260803-error-boundary-copy-bridge rather than covered here.
    expect(withCopy.sort()).toEqual([
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
