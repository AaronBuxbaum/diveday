import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **`ui/` is the primitive set, by rule** (issue #2767). The component tree has
 * three tiers: `ui/` takes words as props and knows no domain, `components/`
 * is a composition shared by two or more routes, and `_components/` is one
 * route's own. This test holds the first two tiers to that.
 *
 * Three rules, each with today's violations banked below as a ratchet: a
 * listed file may be fixed (and must then be deleted from its list, so the
 * number only falls), and a file that is not listed may not break the rule.
 *
 * 1. A `ui/` module imports nothing from `@/db` or `@/i18n`, and from `@/lib`
 *    only `motion`.
 * 2. A `ui/` module has a test beside it (`name.test.ts(x)`).
 * 3. A top-level `components/` file is not imported from a single route (its
 *    importers sit under more than one route root, or outside `src/app`).
 *    A component one route uses lives in that route's `_components/`.
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
  "src/components/ui/Modal.tsx",
  "src/components/ui/StickyActionsInset.tsx",
  "src/components/ui/forgiving-copy.ts",
  "src/components/ui/group-label.tsx",
  "src/components/ui/rail.ts",
  "src/components/ui/reveal-event.ts",
  "src/components/ui/settled-mark.ts",
  "src/components/ui/tone.ts",
]);

/** Top-level components imported from one route only today (rule 3). */
const SINGLE_ROUTE_COMPONENTS = new Set<string>([
  "src/components/AgencyTabs",
  "src/components/BoardingBar",
  "src/components/BookingPartyFields",
  "src/components/DetectTimezone",
  "src/components/DiveDeclarationFields",
  "src/components/DiveSitesPeek",
  "src/components/ForgetThisDevice",
  "src/components/IdentityCheck",
  "src/components/ImageUploadTile",
  "src/components/JumpNav",
  "src/components/LanguageFallbackNotice",
  "src/components/MarketingNavView",
  "src/components/MedicalClearanceControl",
  "src/components/OfflineManifestAutoSave",
  "src/components/OfflineManifestManager",
  "src/components/OfflineManifestView",
  "src/components/PublicShopChrome",
  "src/components/PushOptIn",
  "src/components/ShopNav",
  "src/components/ShopSearchField",
  "src/components/StarRatingInput",
  "src/components/SuggestShopLink",
  "src/components/TripArrivalCard",
  "src/components/focus-on-mount",
]);

function sourcesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const here = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourcesUnder(here);
    return /\.tsx?$/.test(entry.name) ? [here] : [];
  });
}

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

/**
 * The route root a file under `src/app` belongs to: its first two segments
 * with route groups and the shop slug folded away (`shop/[shopSlug]/trips/...`
 * is `shop/trips`; `(token)/ready/[token]/...` is `ready/[token]`). Anything
 * outside `src/app` is `shared`.
 */
function routeRootOf(file: string): string {
  if (!file.startsWith("src/app/")) return "shared";
  const segments = file
    .slice("src/app/".length)
    .split("/")
    .filter((segment) => !/^\(.+\)$/.test(segment) && segment !== "[shopSlug]");
  return segments.slice(0, 2).join("/");
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

describe("components/ is shared", () => {
  it("holds no component imported from one route only", () => {
    const components = readdirSync(path.join(ROOT, "src/components"))
      .filter((name) => /\.tsx?$/.test(name) && !isTest(name))
      .map((name) => name.replace(/\.tsx?$/, ""));
    const importers = new Map<string, Set<string>>(components.map((name) => [name, new Set()]));
    for (const file of sourcesUnder("src").filter((candidate) => !isTest(candidate))) {
      const root = routeRootOf(file);
      const inComponents = path.dirname(file) === "src/components";
      for (const spec of specifiers(readFileSync(path.join(ROOT, file), "utf8"))) {
        const name = spec.startsWith("@/components/")
          ? spec.slice("@/components/".length)
          : inComponents && spec.startsWith("./")
            ? spec.slice(2)
            : null;
        if (name && importers.has(name)) importers.get(name)?.add(inComponents ? "shared" : root);
      }
    }
    const single = new Set(
      [...importers]
        .filter(([, roots]) => roots.size === 1 && !roots.has("shared"))
        .map(([name]) => `src/components/${name}`),
    );
    reportDelta("single-route components", single, SINGLE_ROUTE_COMPONENTS);
  });
});
