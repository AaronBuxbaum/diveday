import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { securityHeaderRules } from "./security-headers";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

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
    found.push(...tokenRouteDirectories(join(dir, entry.name), [...trail, entry.name]));
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
    const tokenSources = tokenRouteDirectories().map((prefix) => `/${prefix}/:token`);
    for (const source of tokenSources) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, `expected a header rule for ${source}`).toBeDefined();
      expect(rule?.headers).toEqual([{ key: "Referrer-Policy", value: "no-referrer" }]);
    }
    // Nothing outside the catch-all and the token routes above.
    expect(rules).toHaveLength(1 + tokenSources.length);
  });
});
