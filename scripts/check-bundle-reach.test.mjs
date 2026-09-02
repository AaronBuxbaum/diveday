import { describe, expect, it } from "vitest";

import { findReaches, loadBundles } from "./check-bundle-reach.mjs";

/**
 * The direction that matters is the false positive.
 *
 * A key this guard wrongly reports is an invitation to delete a live sentence
 * — worse than no guard at all, because the report reads as authority. So
 * every way this repo reaches a key without writing a `t("…")` call is pinned
 * here: record maps, `as const` arrays, helpers that pass a key along, and the
 * runtime-assembled keys the walk deliberately declines to decide about.
 */

const literals = (source) => findReaches(source).literals;
const prefixes = (source) => findReaches(source).dynamicPrefixes;

describe("a key written out in full is reached, however it is written", () => {
  it("finds a plain translator call", () => {
    expect(literals('const label = t("divers.certifications.agency");')).toContain(
      "divers.certifications.agency",
    );
  });

  it("finds t.raw and t.rich", () => {
    expect(literals('t.raw("account.verify.unavailableText");')).toContain(
      "account.verify.unavailableText",
    );
    expect(literals('t.rich("shared.legal.terms", { link });')).toContain("shared.legal.terms");
  });

  it("finds a value in a Record<…, StaffMessageKey> map — the false positive that would hurt", () => {
    // The real shape, from src/i18n/readiness-labels.ts. A guard that reported
    // these would be telling somebody to delete the readiness vocabulary.
    const source = `
      export const READINESS_STATUS_KEYS: Record<ReadinessStatus, StaffMessageKey> = {
        ready: "shared.readiness.status.ready",
        blocked: "shared.readiness.status.blocked",
      };
    `;
    expect(literals(source)).toContain("shared.readiness.status.ready");
    expect(literals(source)).toContain("shared.readiness.status.blocked");
  });

  it("finds a key in an `as const` array of key names", () => {
    const source = `
      const STATUS_TARGET_ANCHORS = ["today.blockers.waiver", "today.blockers.cert"] as const;
    `;
    expect(literals(source)).toContain("today.blockers.waiver");
    expect(literals(source)).toContain("today.blockers.cert");
  });

  it("finds a key in single quotes and in a plain template literal", () => {
    expect(literals("t('shared.pager.next')")).toContain("shared.pager.next");
    expect(literals("const KEY = `shared.pager.previous`;")).toContain("shared.pager.previous");
  });
});

describe("a scoped translator, whose call sites write a relative key", () => {
  /**
   * `useTranslations("booking")` scopes the translator, so the call site writes
   * `t("bookAndPay")` and the full key appears nowhere in the file. Within an
   * hour of this guard landing that reported all 39 of `booking.*` as dead —
   * the live booking page's copy, offered up for deletion.
   */
  it("reads a relative call through the namespace the file scopes to", () => {
    const source = `
      const t = useTranslations("booking");
      const label = t("bookAndPay");
      const money = t("money.fare");
    `;
    expect(literals(source)).toContain("booking.bookAndPay");
    expect(literals(source)).toContain("booking.money.fare");
  });

  it("declines the whole namespace when a scoped file assembles its keys", () => {
    // No head to narrow by, so the honest answer is "some key under `trip`",
    // not a guess at which.
    expect(prefixes('const t = useTranslations("trip");\nt(`${step}`)')).toContain("trip.");
  });

  it("does not prefix a call in a file that scopes nothing", () => {
    // Unscoped, `t("owner")` is not a key — and must not become `.owner`.
    expect(literals('const t = useTranslations();\nconst role = t("owner");')).toEqual(new Set());
  });
});

describe("a key assembled at runtime is declined, never reported", () => {
  it("collects the static head of an interpolated translator call", () => {
    // src/app/switching/_components/guide.tsx — the key cannot be enumerated,
    // so every key under the head is treated as reached.
    expect(prefixes(`t(\`switching.common.facts.\${fact}.label\`)`)).toContain(
      "switching.common.facts.",
    );
  });

  it("collects it from t.raw and t.rich too", () => {
    expect(prefixes(`t.raw(\`shared.offlineManifest.freshnessCopy.\${freshness}\`)`)).toContain(
      "shared.offlineManifest.freshnessCopy.",
    );
  });

  it("ignores a template with no dotted head, which reaches no bundle key", () => {
    expect(prefixes(`redirect(\`/waivers/\${token}?sent=rate\`)`)).toEqual(new Set());
  });

  /**
   * A key is as often *built* and passed along as it is interpolated inside a
   * `t(…)` call. Requiring the `t(` reported nine live keys dead — the real
   * shape, from `PackingSection.tsx`.
   */
  it("collects a head from a template that is nowhere near a translator call", () => {
    expect(prefixes("return `trip.timeline.${step}` as DiverMessageKey;")).toContain(
      "trip.timeline.",
    );
  });
});

describe("what is not a key", () => {
  it("does not read a single-segment string as a key", () => {
    expect(literals('const role = "owner";')).toEqual(new Set());
  });

  it("does not read a path or a class list as a key", () => {
    // Both carry dots or slashes; neither is `word.word`.
    expect([...literals('href="/s/blue-mantis"')]).toEqual([]);
  });
});

describe("against the real bundles", () => {
  it("loads every staff namespace and the diver bundle, keyed as a call site writes them", async () => {
    const bundles = await loadBundles();
    const all = [...bundles.values()].flat();

    expect(bundles.size).toBeGreaterThan(20);
    // The staff namespace is the filename, exactly as staff/index.ts composes
    // it — a key that lost its namespace prefix here would report every staff
    // key as dead at once.
    expect(all).toContain("shared.readiness.status.ready");
    expect(all).toContain("divers.certifications.agency");
    // The diver bundle is flat from its own root, with no bundle prefix.
    expect(all).toContain("account.verify.unavailableTitle");
  });
});
