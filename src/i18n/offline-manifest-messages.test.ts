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
 * pulls both locale barrels: 31 namespaces times two locales to render three.
 *
 * The set is **derived** rather than restated. A hard-coded list of three would
 * only re-assert the shipped module and prove nothing about what the view
 * reaches, which is the half that moves.
 */

const ROOT = process.cwd();

/** The three the narrow module ships. */
const SHIPPED = ["manifest", "shared", "trips"] as const;

/**
 * Every module whose staff keys the view can reach.
 *
 * The view itself, plus the four `@/i18n/*-labels` modules it hands its
 * translator to. Scanning a whole helper module over-approximates — the view
 * calls five functions out of those files, not all of them — and that is the
 * safe direction on this surface: a namespace named here and not shipped is a
 * raw dotted key on a boat manifest, and a false alarm costs a reader one look.
 */
const REACHABLE = [
  "src/components/OfflineManifestView.tsx",
  "src/i18n/manifest-labels.ts",
  "src/i18n/readiness-labels.ts",
  "src/i18n/rental-labels.ts",
  "src/i18n/support-needs-labels.ts",
];

/** The 31 staff namespaces, off disk — one JSON file each. */
function staffNamespaces(): string[] {
  return readdirSync(path.join(ROOT, "src/i18n/locales/en-US/staff"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""));
}

/**
 * Staff namespaces a file mentions, as `"<namespace>.<something>"`.
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
  const found = [...source.matchAll(/"([a-zA-Z]+)\.[a-zA-Z][\w.]*"/g)]
    .map((match) => match[1] as string)
    .filter((namespace) => known.includes(namespace));
  return [...new Set(found)].sort();
}

describe("the offline manifest's message bundle", () => {
  it("ships every staff namespace the view and its helpers can reach", () => {
    const known = staffNamespaces();
    expect(known.length, "expected the staff bundle to have namespaces").toBeGreaterThan(20);

    const reached = [
      ...new Set(REACHABLE.flatMap((file) => staffNamespacesIn(file, known))),
    ].sort();
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
    const reached = new Set(REACHABLE.flatMap((file) => staffNamespacesIn(file, known)));
    expect([...SHIPPED].filter((namespace) => !reached.has(namespace))).toEqual([]);
  });

  it("resolves a key from each of the three, in both locales", () => {
    for (const locale of ["en-US", "es-ES"]) {
      const t = offlineManifestTranslator(locale);
      // One real key per namespace: a translator that resolved nothing would
      // return the dotted key, which is the failure this whole change risks.
      expect(t("shared.readiness.status.ready")).not.toContain("shared.");
      expect(t("manifest.skipToRollCall")).not.toContain("manifest.");
    }
  });

  /**
   * **The bundle is narrow at runtime, not just at build time.**
   *
   * `gear` is a real staff namespace with real keys, and this module does not
   * ship it — so resolving one must fail rather than quietly succeed. It throws
   * rather than falling back because `translatorOnError` rethrows outside
   * production by design: a message this code cannot resolve is a test failure
   * where fixing it is free, and only in production does the fallback render.
   *
   * That is the assertion worth having. If the other 28 namespaces were still
   * reaching the client — the exact regression this change exists to prevent,
   * and the one a stray `staffTranslator` import would reintroduce — this key
   * would resolve and this test would fail.
   */
  it("cannot resolve a namespace it does not ship", () => {
    const t = offlineManifestTranslator("en-US");
    expect(() => t("gear.heading" as never)).toThrow(/MISSING_MESSAGE/);
  });

  /**
   * And the fallback it would use in production walks only those three. Reusing
   * `staffFallbackMessage` from `staff-messages.ts` would pull all 31 en-US
   * namespaces back in at runtime through one reference, turning roughly
   * -109 KB gzip into -57 KB with nothing reporting the difference — so the
   * duplication in that module is deliberate, and this is what says so.
   */
  it("does not reach the full staff bundle for its fallback", () => {
    const source = readFileSync(path.join(ROOT, "src/i18n/offline-manifest-messages.ts"), "utf8");
    expect(source).not.toContain("./staff-messages");
    expect(source).not.toContain('/staff"');
    const jsonImports = [...source.matchAll(/from "\.\/locales\/[^"]+"/g)];
    expect(jsonImports).toHaveLength(6);
  });
});
