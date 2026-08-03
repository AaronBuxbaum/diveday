import { describe, expect, it } from "vitest";
import { type DiverMessageKey, diverTranslator } from "@/i18n/messages";
import { INTERNAL_VOCABULARY } from "@/test/copy";
import { getMigrationGuide, MIGRATION_GUIDE_SLUGS, MIGRATION_GUIDES } from "./migration-guides";

const t = diverTranslator("en-US");

/**
 * Resolve a guide's message key to its English text, and prove the key really
 * exists in the bundle: `diverTranslator`'s fallback returns the key itself
 * for a key the bundle doesn't hold, which would otherwise let a typo'd key
 * pass every length assertion below.
 */
function en(key: DiverMessageKey, values?: { competitor: string }): string {
  const resolved = t(key, values);
  expect(resolved, `bundle is missing ${key}`).not.toBe(key);
  return resolved;
}

describe("migration guides", () => {
  it("exposes every guide's slug, with EVE first and the named incumbents present", () => {
    expect(MIGRATION_GUIDE_SLUGS).toEqual(MIGRATION_GUIDES.map((g) => g.slug));
    // EVE ships first, and the named incumbents from the strategy are all present.
    expect(MIGRATION_GUIDE_SLUGS[0]).toBe("eve");
    for (const slug of ["eve", "diveshop360", "diveadmin", "smartwaiver", "fareharbor", "rezdy"]) {
      expect(MIGRATION_GUIDE_SLUGS).toContain(slug);
    }
  });

  it("resolves a guide by slug and refuses an unknown one", () => {
    expect(getMigrationGuide("eve")?.competitor).toBe("EVE");
    expect(getMigrationGuide("smartwaiver")?.competitor).toBe("Smartwaiver");
    expect(getMigrationGuide("fareharbor")?.competitor).toBe("FareHarbor");
    expect(getMigrationGuide("rezdy")?.competitor).toBe("Rezdy");
    // No coming-soon / roadmap entries — an unlisted incumbent (e.g. Checkfront) has no page.
    expect(getMigrationGuide("checkfront")).toBeNull();
    expect(getMigrationGuide("nope")).toBeNull();
  });

  it("carries the coexist framing only on the booking-channel guides, not the leave-it ones", () => {
    // FareHarbor and Rezdy are booking/distribution channels, so they earn the
    // coexist block; the records-system guides stay straight leave-it migrations.
    for (const slug of ["fareharbor", "rezdy"]) {
      const guide = getMigrationGuide(slug);
      expect(guide?.coexist, `${slug} coexist`).toBeDefined();
      expect(guide?.coexist?.runsInDiveDay.length).toBeGreaterThan(0);
      const values = { competitor: guide?.competitor ?? "" };
      for (const item of guide?.coexist?.runsInDiveDay ?? []) {
        expect(en(item.title, values).trim().length).toBeGreaterThan(0);
        expect(en(item.detail, values).trim().length).toBeGreaterThan(0);
      }
      const coexist = guide?.coexist;
      if (!coexist) throw new Error("unreachable");
      expect(en(coexist.bridgeNote).trim().length).toBeGreaterThan(0);
      expect(en(coexist.replace.body).trim().length).toBeGreaterThan(0);
    }
    for (const slug of ["eve", "diveshop360", "diveadmin", "smartwaiver"]) {
      expect(getMigrationGuide(slug)?.coexist).toBeUndefined();
    }
  });

  it("interpolates the competitor's name into the shared coexist items, never a placeholder", () => {
    // The runsInDiveDay list is authored once in the bundle; two of its
    // messages take the competitor name as an ICU value. Rendered with the
    // guide's competitor, no message may leak a raw `{competitor}`.
    for (const slug of ["fareharbor", "rezdy"]) {
      const guide = getMigrationGuide(slug);
      const values = { competitor: guide?.competitor ?? "" };
      const details = (guide?.coexist?.runsInDiveDay ?? []).map((item) => en(item.detail, values));
      expect(details.join(" ")).not.toContain("{competitor}");
      // The parameterised items really carry the incumbent's own name.
      expect(details.some((d) => d.includes(guide?.competitor ?? ""))).toBe(true);
    }
  });

  it("every guide carries the full three-part promise — no empty shell can ship", () => {
    for (const guide of MIGRATION_GUIDES) {
      expect(en(guide.heroLede).trim().length, `${guide.slug} lede`).toBeGreaterThan(0);
      expect(guide.context.length, `${guide.slug} context`).toBeGreaterThan(0);
      for (const paragraph of guide.context) {
        expect(en(paragraph).trim().length).toBeGreaterThan(0);
      }
      expect(en(guide.exportHeading).trim().length, `${guide.slug} export heading`).toBeGreaterThan(
        0,
      );
      expect(guide.exportSteps.length, `${guide.slug} export steps`).toBeGreaterThan(0);
      for (const step of guide.exportSteps) {
        expect(en(step.title).trim().length).toBeGreaterThan(0);
        expect(en(step.detail).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("every guide cites at least one source with an absolute URL (claims policy)", () => {
    for (const guide of MIGRATION_GUIDES) {
      expect(guide.sources.length, `${guide.slug} sources`).toBeGreaterThan(0);
      for (const source of guide.sources) {
        expect(source.label.trim().length).toBeGreaterThan(0);
        expect(source.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("has unique slugs", () => {
    const slugs = MIGRATION_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("never instructs a shop to hand DiveDay a competitor login (legal guardrail)", () => {
    // We migrate from files the shop exports itself; the copy must not describe
    // logging DiveDay into the incumbent or handing over its credentials.
    for (const guide of MIGRATION_GUIDES) {
      const values = { competitor: guide.competitor };
      const coexist = guide.coexist
        ? [
            en(guide.coexist.heading),
            en(guide.coexist.intro),
            ...guide.coexist.runsInDiveDay.flatMap((i) => [
              en(i.title, values),
              en(i.detail, values),
            ]),
            en(guide.coexist.bridgeNote),
            en(guide.coexist.replace.heading),
            en(guide.coexist.replace.body),
          ]
        : [];
      const prose = [
        en(guide.heroLede),
        ...guide.context.map((p) => en(p)),
        ...coexist,
        en(guide.exportIntro),
        ...guide.exportSteps.flatMap((s) => [en(s.title), en(s.detail)]),
        ...guide.exportNotes.map((n) => en(n)),
      ]
        .join(" ")
        .toLowerCase();
      expect(prose).not.toMatch(/your (eve )?(password|credentials|login)/);
    }
  });

  it("never leaks internal vocabulary into copy a shop owner reads", () => {
    // These pages are rendered verbatim from the bundle. An ADR id, a
    // decision-register id, a reviewer-agent name, or a source path is how *we*
    // talk to each other about a decision — a shop owner reading "see the
    // imported-waiver ADR" has been handed a dead end. Say the thing the copy
    // is pointing at instead.
    for (const guide of MIGRATION_GUIDES) {
      const copy = [
        en(guide.cardSummary),
        en(guide.metaTitle),
        en(guide.metaDescription),
        en(guide.heroEyebrow),
        en(guide.heroTitle),
        en(guide.heroLede),
        ...guide.context.map((p) => en(p)),
        en(guide.exportHeading),
        en(guide.exportIntro),
        ...guide.exportSteps.flatMap((s) => [en(s.title), en(s.detail)]),
        ...guide.exportNotes.map((n) => en(n)),
        guide.importerNote ? en(guide.importerNote) : "",
        ...guide.sources.map((s) => s.label),
      ].join(" ");
      expect(copy).not.toMatch(INTERNAL_VOCABULARY);
    }
  });
});
