import { describe, expect, it } from "vitest";
import { marineLifeCard } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";
import { rankSiteSightings } from "@/lib/sightings";
import type { DiveBriefing } from "./types";
import { wildlifeCards } from "./wildlife-cards";

const t = diverTranslator("en-US");
const card = (slug: Parameters<typeof marineLifeCard>[0]) => ({
  ...marineLifeCard(slug, t),
  id: slug,
});
const briefing = (site: string, creatures: ReturnType<typeof card>[]) =>
  ({ diveSite: { id: site }, creatures }) as unknown as DiveBriefing;
const tally = (speciesSlug: string, dives: number) => ({
  speciesSlug,
  dives,
  total: dives,
  lastSeenAt: new Date("2026-11-01T00:00:00Z"),
});

describe("wildlifeCards", () => {
  it("keeps every selection in order and marks a selection even below the summary cutoff", () => {
    const picked = [
      card("blue-tang"),
      card("queen-angelfish"),
      card("green-sea-turtle"),
      card("nurse-shark"),
    ];
    const result = rankSiteSightings({
      diveSiteId: "reef",
      dives: 9,
      tallies: [
        tally("french-grunt", 9),
        tally("bluehead-wrasse", 8),
        tally("french-angelfish", 7),
        tally("blue-tang", 1),
      ],
    });
    if (!result) throw new Error("missing sightings");
    const rows = wildlifeCards([briefing("reef", picked)], new Map([["reef", result]]), t);
    expect(rows.slice(0, 4).map(({ card, seen }) => [card.slug, seen])).toEqual([
      ["blue-tang", true],
      ["queen-angelfish", false],
      ["green-sea-turtle", false],
      ["nurse-shark", false],
    ]);
    expect(rows).toHaveLength(7);
  });
  it("ranks at most three additional sightings by category and avoids false site matches", () => {
    const result = rankSiteSightings({
      diveSiteId: "other",
      dives: 5,
      tallies: [
        tally("blue-tang", 5),
        tally("nurse-shark", 1),
        tally("green-sea-turtle", 1),
        tally("french-angelfish", 4),
      ],
    });
    if (!result) throw new Error("missing sightings");
    const rows = wildlifeCards(
      [briefing("chosen", [card("blue-tang")]), briefing("other", [])],
      new Map([["other", result]]),
      t,
    );
    expect(rows[0]).toMatchObject({ card: { slug: "blue-tang" }, seen: false });
    expect(rows.slice(1).map(({ card }) => card.slug)).toEqual([
      "green-sea-turtle",
      "nurse-shark",
      "french-angelfish",
    ]);
  });
});
