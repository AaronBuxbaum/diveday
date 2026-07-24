import { describe, expect, it } from "vitest";
import { getMigrationGuide, MIGRATION_GUIDE_SLUGS, MIGRATION_GUIDES } from "./migration-guides";

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
      for (const item of guide?.coexist?.runsInDiveDay ?? []) {
        expect(item.title.trim().length).toBeGreaterThan(0);
        expect(item.detail.trim().length).toBeGreaterThan(0);
      }
      expect(guide?.coexist?.bridgeNote.trim().length).toBeGreaterThan(0);
      expect(guide?.coexist?.replace.body.trim().length).toBeGreaterThan(0);
    }
    for (const slug of ["eve", "diveshop360", "diveadmin", "smartwaiver"]) {
      expect(getMigrationGuide(slug)?.coexist).toBeUndefined();
    }
  });

  it("every guide carries the full three-part promise — no empty shell can ship", () => {
    for (const guide of MIGRATION_GUIDES) {
      expect(guide.heroLede.trim().length, `${guide.slug} lede`).toBeGreaterThan(0);
      expect(guide.context.length, `${guide.slug} context`).toBeGreaterThan(0);
      expect(guide.exportHeading.trim().length, `${guide.slug} export heading`).toBeGreaterThan(0);
      expect(guide.exportSteps.length, `${guide.slug} export steps`).toBeGreaterThan(0);
      for (const step of guide.exportSteps) {
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(step.detail.trim().length).toBeGreaterThan(0);
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
      const coexist = guide.coexist
        ? [
            guide.coexist.heading,
            guide.coexist.intro,
            ...guide.coexist.runsInDiveDay.flatMap((i) => [i.title, i.detail]),
            guide.coexist.bridgeNote,
            guide.coexist.replace.heading,
            guide.coexist.replace.body,
          ]
        : [];
      const prose = [
        guide.heroLede,
        ...guide.context,
        ...coexist,
        guide.exportIntro,
        ...guide.exportSteps.flatMap((s) => [s.title, s.detail]),
        ...guide.exportNotes,
      ]
        .join(" ")
        .toLowerCase();
      expect(prose).not.toMatch(/your (eve )?(password|credentials|login)/);
    }
  });
});
