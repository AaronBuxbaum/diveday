import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **`ui/` is the primitive set, by rule** (issue #2767). The component tree has
 * three tiers: `ui/` takes words as props and knows no domain, `components/`
 * is the composition shared across routes, and `_components/` is one route's
 * own. This test holds `ui/` to that. `components/` is not held to "two or
 * more routes": a component whose last second user goes away stays put, not
 * moved for the sake of a count (Aaron, 2026-11-17).
 *
 * Two rules, each with today's violations banked below as a ratchet: a
 * listed file may be fixed (and must then be deleted from its list, so the
 * number only falls), and a file that is not listed may not break the rule.
 *
 * 1. A `ui/` module imports nothing from `@/db` or `@/i18n`, and from `@/lib`
 *    only `motion`.
 * 2. A `ui/` module has a test beside it (`name.test.ts(x)`).
 *
 * Text scans, like `stacking-layers.test.ts`: the rules are about who imports
 * whom, which needs no render.
 */

const ROOT = process.cwd();
const UI = "src/components/ui";

/** `ui/` modules that import domain today (rule 1). Delete an entry when it is fixed. */
const UI_IMPORTS_DOMAIN = new Set<string>([
  "src/components/ui/ForgivingInput.tsx",
  "src/components/ui/forgiving-copy.ts",
  "src/components/ui/form.tsx",
]);

/** `ui/` modules with no test beside them today (rule 2). */
const UI_WITHOUT_TEST = new Set<string>([
  "src/components/ui/DateInput.tsx",
  "src/components/ui/DisclosureCaret.tsx",
  "src/components/ui/FieldErrorFocus.tsx",
  "src/components/ui/FilterChipsScroller.tsx",
  "src/components/ui/StickyActionsInset.tsx",
  "src/components/ui/forgiving-copy.ts",
  "src/components/ui/group-label.tsx",
  "src/components/ui/rail.ts",
  "src/components/ui/reveal-event.ts",
  "src/components/ui/settled-mark.ts",
  "src/components/ui/tone.ts",
]);

const isTest = (file: string) => /\.test\.tsx?$/.test(file);

/** Every module specifier a file imports, re-exports or dynamically imports. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

const uiModules = readdirSync(path.join(ROOT, UI))
  .filter((name) => /\.tsx?$/.test(name) && !isTest(name))
  .map((name) => `${UI}/${name}`);

const ALLOWED_LIB = new Set(["@/lib/motion"]);

function importsDomain(file: string): boolean {
  return specifiers(readFileSync(path.join(ROOT, file), "utf8")).some(
    (spec) =>
      spec.startsWith("@/db") ||
      spec.startsWith("@/i18n") ||
      (spec.startsWith("@/lib") && !ALLOWED_LIB.has(spec)),
  );
}

function hasTestBeside(file: string): boolean {
  const base = file.replace(/\.tsx?$/, "");
  return [".test.ts", ".test.tsx"].some((ext) => {
    try {
      readFileSync(path.join(ROOT, base + ext));
      return true;
    } catch {
      return false;
    }
  });
}

function reportDelta(label: string, found: Set<string>, banked: Set<string>) {
  const added = [...found].filter((file) => !banked.has(file)).sort();
  const fixed = [...banked].filter((file) => !found.has(file)).sort();
  expect(added, `${label}: new violations (fix them, do not bank them)`).toEqual([]);
  expect(fixed, `${label}: fixed, so delete them from the baseline (it only falls)`).toEqual([]);
}

describe("ui/ is the primitive set", () => {
  it("imports no domain: nothing from @/db, @/i18n, or @/lib beyond motion", () => {
    reportDelta(
      "ui modules importing domain",
      new Set(uiModules.filter(importsDomain)),
      UI_IMPORTS_DOMAIN,
    );
  });

  it("has a test beside every module", () => {
    reportDelta(
      "ui modules without a test",
      new Set(uiModules.filter((file) => !hasTestBeside(file))),
      UI_WITHOUT_TEST,
    );
  });
});
