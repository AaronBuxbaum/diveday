import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { securityHeaderRules } from "./security-headers";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

/**
 * A directory that contributes **no URL segment**.
 *
 * A route group `(name)` organises files without appearing in the path, and a
 * private `_folder` is not routable at all. Both walkers below build URLs from
 * directory names, so neither may append one: a capability route moved under
 * `src/app/(public)/unsubscribe/[token]` would otherwise be read as the prefix
 * `(public)`, and the test would demand a header rule for `/(public)/:token`,
 * which is not a URL any request can have. No route group exists today; this is
 * the walkers' model of Next routing being correct in advance rather than a
 * live failure (CodeRabbit review on PR #951).
 */
function isUrllessFolder(name: string): boolean {
  return (name.startsWith("(") && name.endsWith(")")) || name.startsWith("_");
}

/**
 * Every `[token]` route directory under `src/app`, by its first path segment --
 * the set of pages whose URL *is* a bearer credential, and therefore the set
 * that must send no referrer.
 */
function tokenRouteDirectories(dir = APP_DIR, trail: string[] = []): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "[token]") {
      const prefix = trail[0];
      if (prefix) found.push(prefix);
      continue;
    }
    // Descend, but do not let a group or private folder become a URL segment.
    const next = isUrllessFolder(entry.name) ? trail : [...trail, entry.name];
    found.push(...tokenRouteDirectories(join(dir, entry.name), next));
  }
  return found;
}

/**
 * Every routable path that lives *below* a `[token]` segment, as segments
 * appended after the token.
 *
 * The walk above cannot see these: it stops the moment it meets `[token]`, so
 * it was structurally unable to notice the one route that was not covered.
 * `src/app/unsubscribe/[token]/one-click/route.ts` is real and reachable, and
 * `"/unsubscribe/:token"` matches exactly one segment, so it matched nothing in
 * the list and fell back to the baseline policy (issue #946).
 *
 * Nothing leaked — that endpoint returns a null body, so no document exists to
 * send a `Referer` from. This asserts the invariant rather than a live fix, and
 * exists so the *next* nested capability route cannot quietly opt out.
 */
function routesNestedUnderToken(
  dir = APP_DIR,
  trail: string[] = [],
  belowToken = false,
): { prefix: string; rest: string[] }[] {
  const found: { prefix: string; rest: string[] }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (!entry.isDirectory()) {
      // Only a `page`/`route` module makes a directory addressable.
      if (belowToken && /^(page|route)\.tsx?$/.test(entry.name) && trail.length > 1) {
        found.push({ prefix: trail[0] as string, rest: trail.slice(1) });
      }
      continue;
    }
    if (entry.name === "[token]" && !belowToken) {
      found.push(...routesNestedUnderToken(child, trail, true));
      continue;
    }
    // A private folder is not routable, so nothing beneath it is a route to
    // demand a header for — and a route group contributes no URL segment.
    if (entry.name.startsWith("_")) continue;
    const next = isUrllessFolder(entry.name) ? trail : [...trail, entry.name];
    found.push(...routesNestedUnderToken(child, next, belowToken));
  }
  return found;
}

describe("securityHeaderRules (specialist-optimization-audit-20260731.md §5)", () => {
  it("applies the baseline set to every route", () => {
    const rules = securityHeaderRules();
    const catchAll = rules.find((rule) => rule.source === "/:path*");
    expect(catchAll).toBeDefined();
    const keys = catchAll?.headers.map((h) => h.key).sort();
    expect(keys).toEqual([
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
    ]);
    expect(catchAll?.headers.find((h) => h.key === "Strict-Transport-Security")?.value).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(catchAll?.headers.find((h) => h.key === "X-Content-Type-Options")?.value).toBe(
      "nosniff",
    );
    expect(catchAll?.headers.find((h) => h.key === "Referrer-Policy")?.value).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("tightens Referrer-Policy to no-referrer only on bearer-token routes", () => {
    const rules = securityHeaderRules();
    // Derived from the filesystem, not re-typed. The hand-written copy that
    // used to sit here held the *same* eight entries as the list it was
    // checking -- `claim` missing from both -- so it locked the omission in
    // instead of catching it, and `/claim/<token>` spent its whole life handing
    // its own bearer token to the next page as `document.referrer`. A second
    // hard-coded list cannot notice that the first one is short.
    //
    // Anchored the same way `src/app/observability.test.ts` anchors
    // `CAPABILITY_ROUTE_PREFIXES`, and deliberately not by importing that list:
    // `src/lib` may not import from `src/app` (check:architecture), and the
    // filesystem is the better authority anyway -- creating a capability route
    // is creating a directory, and nothing about that act reminds anyone to
    // come here.
    // Deduplicated: one prefix can legitimately appear at two places on disk
    // — a route group splitting `unsubscribe` across `(marketing)/` and the
    // root would list it twice — and the rule set holds one entry per prefix,
    // not one per directory (CodeRabbit review on PR #951).
    const tokenSources = [...new Set(tokenRouteDirectories())].map((prefix) => `/${prefix}/:token`);
    for (const source of tokenSources) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, `expected a header rule for ${source}`).toBeDefined();
      expect(rule?.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
    // Nothing outside the catch-all and the two sources per prefix.
    expect(rules).toHaveLength(1 + tokenSources.length * 2);
  });

  it("covers a route nested below the token segment, at any depth", () => {
    const rules = securityHeaderRules();
    const nested = routesNestedUnderToken();
    // The route that started this. If it ever moves, the assertion below still
    // holds for wherever the walk finds it — this only pins that the walk is
    // actually finding something, so a broken walk cannot pass vacuously.
    expect(nested).toContainEqual({ prefix: "unsubscribe", rest: ["one-click"] });

    for (const { prefix } of nested) {
      const deep = rules.find((r) => r.source === `/${prefix}/:token/:rest*`);
      expect(
        deep,
        `a routable path exists below /${prefix}/[token], so it needs a :rest* rule`,
      ).toBeDefined();
      expect(deep?.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
  });
});
