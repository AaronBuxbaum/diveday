import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { offlineManifestTranslator } from "./offline-manifest-messages";

/**
 * **What the offline boat manifest is allowed to cost a diver at the rail**
 * (issue #1353).
 *
 * `OfflineManifestView` is a Client Component, so every namespace its module
 * graph reaches is downloaded by whoever opens the manifest — on a phone, from
 * cache, possibly with no signal. It used to import `staffTranslator`, which
 * pulls both locale barrels: 31 namespaces times two locales for the two it reads.
 *
 * **These tests are the whole guard, not a belt beside a braces.** A direct
 * `t("gear.title")` in the view is a compile error, but next-intl's translator
 * is method-declared and therefore bivariant, so passing the narrow translator
 * to a helper typed `StaffTranslator` compiles silently. The compiler will not
 * stop a helper reaching a third namespace, and after this change that is no
 * longer harmless: the key does not resolve, and a roll-call row would render a
 * raw `shared.readiness.status.blocked` beside a diver's name.
 *
 * That is still the right trade — an unmistakably broken string is safer on a
 * roll call than a plausible wrong word, and the alternative was handing a
 * Spanish crew silent English — but it means everything below has to actually
 * bite. Each case says what it would catch.
 */

const ROOT = process.cwd();
const VIEW = "src/components/OfflineManifestView.tsx";

/**
 * The two the narrow module ships. Was three until issue #1359 moved the
 * emergency card's six keys into `manifest.json` and dropped `trips` — 613
 * lines carried for 301 bytes of copy.
 */
const SHIPPED = ["manifest", "shared"] as const;

/** The 31 staff namespaces, off disk — one JSON file each. */
function staffNamespaces(): string[] {
  return readdirSync(path.join(ROOT, "src/i18n/locales/en-US/staff"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));
}

/**
 * Every module whose staff keys the view can reach: the view, plus each
 * `@/i18n/*` module it imports that exists as a source file.
 *
 * **Derived rather than listed**, because listing it only derives half the
 * question. The namespaces were already read off disk; the *reachability* was
 * five hand-written paths, so a later `import { buddyTeamLabelText } from
 * "@/i18n/buddy-labels"` — a `StaffTranslator`-typed helper sitting one
 * directory away — would have put a raw dotted key on a boat manifest with this
 * suite green.
 *
 * Scanning a whole helper module over-approximates: the view calls five
 * functions out of those files, not all of them. That is the safe direction
 * here, and a false alarm costs a reader one look.
 */
function reachableModules(): string[] {
  const view = readFileSync(path.join(ROOT, VIEW), "utf8");
  const imported = [...view.matchAll(/from "@\/i18n\/([a-z-]+)"/g)]
    .map((match) => `src/i18n/${match[1]}.ts`)
    .filter((file) => {
      try {
        readFileSync(path.join(ROOT, file));
        return true;
      } catch {
        return false;
      }
    });
  return [VIEW, ...new Set(imported)];
}

/**
 * Staff namespaces a file mentions, as `"<namespace>.<something>"` or
 * `` `<namespace>.${…}` ``.
 *
 * Backticks count: the view builds two keys by interpolation, and both are
 * `shared.*` today. A future `` t(`gear.${kind}`) `` would otherwise pass this
 * scan and ship a dotted key.
 *
 * Matched against the real namespace list rather than by shape, because these
 * files also hold **diver** bundle keys — `trip.`, `course.`, `common.`,
 * `ready.` — for the sibling functions that take a `DiverTranslator`. Those are
 * a different bundle and none of this view's business. `trips` is a staff
 * namespace and `trip` is not, which is exactly the distinction a
 * shape-matching regex would get wrong.
 */
function staffNamespacesIn(file: string, known: readonly string[]): string[] {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  const found = [...source.matchAll(/["`]([a-zA-Z]+)\.[a-zA-Z$][\w.${}]*["`]/g)]
    .map((match) => match[1] as string)
    .filter((namespace) => known.includes(namespace));
  return [...new Set(found)].sort();
}

describe("the offline manifest's message bundle", () => {
  it("ships every staff namespace the view and its helpers can reach", () => {
    const known = staffNamespaces();
    expect(known.length, "expected the staff bundle to have namespaces").toBeGreaterThan(20);

    const modules = reachableModules();
    expect(modules.length, "the import scan found no @/i18n modules").toBeGreaterThan(1);

    const reached = [...new Set(modules.flatMap((file) => staffNamespacesIn(file, known)))].sort();
    expect(reached.length, "found no staff keys at all — the scan is broken").toBeGreaterThan(0);

    const unshipped = reached.filter((namespace) => !SHIPPED.includes(namespace as never));
    expect(
      unshipped,
      `these namespaces are reachable from the offline manifest but not shipped by ` +
        `offline-manifest-messages.ts, so they would render as raw dotted keys: ${unshipped.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * The other direction, and the one that keeps the saving. A namespace shipped
   * but unreached is bytes on a phone at the rail for nothing.
   */
  it("ships nothing the view and its helpers do not reach", () => {
    const known = staffNamespaces();
    const reached = new Set(reachableModules().flatMap((file) => staffNamespacesIn(file, known)));
    expect([...SHIPPED].filter((namespace) => !reached.has(namespace))).toEqual([]);
  });

  /**
   * **The actual regression path**, and the one nothing else here covers.
   *
   * The narrow module's messages come from its own four JSON imports, so nothing
   * the view imports can change them — which means re-adding
   * `import { staffTranslator } from "@/i18n/staff-messages"` to the view
   * brings 107 KB back with every other test in this file still green. The
   * bytes are absent because the import is, so the import is what to assert.
   */
  it("keeps the full staff bundle out of the client graph", () => {
    const view = readFileSync(path.join(ROOT, VIEW), "utf8");
    expect(view).not.toContain('from "@/i18n/staff-messages"');
    const module = readFileSync(path.join(ROOT, "src/i18n/offline-manifest-messages.ts"), "utf8");
    expect(module).not.toContain("./staff-messages");
    expect([...module.matchAll(/from "\.\/locales\/[^"]+"/g)]).toHaveLength(4);
  });

  it("resolves a key from each of the two, in both locales", () => {
    for (const locale of ["en-US", "es-ES"]) {
      const t = offlineManifestTranslator(locale);
      // Real keys this surface renders, one per namespace. The emergency card
      // — the chamber, the dive-accident hotline, the shore contact and the
      // plan — is the single block on this page most worth resolving in the
      // reader's own language, and it moved into `manifest` with issue #1359.
      expect(t("shared.readiness.status.ready")).not.toContain("shared.");
      expect(t("manifest.diverFactsSummary")).not.toContain("manifest.");
      expect(t("manifest.emergency.heading")).not.toContain("manifest.");
    }
  });

  /**
   * **The bundle is narrow at runtime, not just at build time.** `gear.title`
   * is a real key in a real staff namespace this module does not ship, so
   * resolving it must fail. It throws rather than falling back because
   * `translatorOnError` rethrows outside production by design.
   *
   * The key has to exist for this to prove anything: an earlier version probed
   * `gear.heading`, which is in no namespace at all, so it threw whether or not
   * `gear` was shipped and asserted nothing.
   */
  it("cannot resolve a namespace it does not ship", () => {
    const t = offlineManifestTranslator("en-US");
    expect(t("shared.readiness.status.ready")).toBeTruthy();
    expect(() => t("gear.title" as never)).toThrow(/MISSING_MESSAGE/);
  });
});
