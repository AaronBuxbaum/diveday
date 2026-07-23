import { describe, expect, it } from "vitest";
import {
  getLiveMigrationGuide,
  LIVE_MIGRATION_GUIDE_SLUGS,
  MIGRATION_GUIDES,
} from "./migration-guides";

describe("migration guides", () => {
  it("exposes exactly the live slugs, and EVE is the first one shipped", () => {
    const live = MIGRATION_GUIDES.filter((g) => g.status === "live").map((g) => g.slug);
    expect(LIVE_MIGRATION_GUIDE_SLUGS).toEqual(live);
    expect(LIVE_MIGRATION_GUIDE_SLUGS).toContain("eve");
  });

  it("resolves a live guide by slug and refuses planned or unknown ones", () => {
    expect(getLiveMigrationGuide("eve")?.competitor).toBe("EVE");
    // A planned competitor exists in the registry but has no page.
    expect(MIGRATION_GUIDES.some((g) => g.slug === "diveshop360")).toBe(true);
    expect(getLiveMigrationGuide("diveshop360")).toBeNull();
    expect(getLiveMigrationGuide("nope")).toBeNull();
  });

  it("every live guide carries the full three-part promise — no empty shell can ship live", () => {
    for (const guide of MIGRATION_GUIDES.filter((g) => g.status === "live")) {
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

  it("has unique slugs", () => {
    const slugs = MIGRATION_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("never instructs a shop to hand DiveDay a competitor login (legal guardrail)", () => {
    // We migrate from files the shop exports itself; the copy must not describe
    // logging DiveDay into the incumbent or handing over its credentials.
    for (const guide of MIGRATION_GUIDES.filter((g) => g.status === "live")) {
      const prose = [
        guide.heroLede,
        ...guide.context,
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
