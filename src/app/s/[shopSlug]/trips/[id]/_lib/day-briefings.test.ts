import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { dayBriefings } from "./day-briefings";

type Dives = Parameters<typeof dayBriefings>[0];
type Extras = Parameters<typeof dayBriefings>[1];

const t = diverTranslator("en-US");
const reef = { id: "site-reef", name: "Molasses Reef" };
const dives = [
  { dive: { id: "dive-1", diveNumber: 1 }, diveSite: reef },
  { dive: { id: "dive-2", diveNumber: 2 }, diveSite: null },
] as unknown as Dives;
const moment = { id: "moment-1" };
const extras = {
  creatures: new Map([
    [
      reef.id,
      [
        { id: "row-1", catalogSlug: "blue-chromis" },
        { id: "row-2", catalogSlug: null },
        { id: "row-3", catalogSlug: "not-in-the-catalog" },
      ],
    ],
  ]),
  moments: new Map([[reef.id, [moment]]]),
} as unknown as Extras;

describe("dayBriefings", () => {
  it("gives each dive, in order, its site's field-guide cards and saved moments", () => {
    const [first] = dayBriefings(dives, extras, t);
    expect(first?.dive).toBe(dives[0]?.dive);
    expect(first?.diveSite).toBe(reef);
    expect(first?.creatures.map((card) => [card.id, card.slug])).toEqual([
      ["row-1", "blue-chromis"],
    ]);
    expect(first?.moments).toEqual([moment]);
  });

  it("drops a creature with no catalogue species rather than drawing an empty card", () => {
    const [first] = dayBriefings(dives, extras, t);
    expect(first?.creatures).toHaveLength(1);
  });

  it("gives a dive with no site neither cards nor moments", () => {
    const [, second] = dayBriefings(dives, extras, t);
    expect(second?.diveSite).toBeNull();
    expect(second?.creatures).toEqual([]);
    expect(second?.moments).toEqual([]);
  });

  it("gives a site the shop has said nothing about empty lists, not undefined", () => {
    const empty = { creatures: new Map(), moments: new Map() } as unknown as Extras;
    const [first] = dayBriefings(dives, empty, t);
    expect(first?.creatures).toEqual([]);
    expect(first?.moments).toEqual([]);
  });
});
