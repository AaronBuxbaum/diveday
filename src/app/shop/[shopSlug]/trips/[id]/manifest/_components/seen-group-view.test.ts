import { describe, expect, it, vi } from "vitest";
import { t } from "./diver-roll-call-test-fixtures";
import { seenGroupView } from "./seen-group-view";

vi.mock("../actions", () => ({
  recordSightingAction: { bind: (_: unknown, context: unknown) => ({ record: context }) },
  deleteSightingAction: { bind: (_: unknown, context: unknown) => ({ delete: context }) },
}));

const reef = { id: "site-reef", name: "Molasses Reef" };
const wreck = { id: "site-wreck", name: "Spiegel Grove" };
const catalogSpecies: Parameters<typeof seenGroupView>[0]["catalogSpecies"] = [
  { slug: "blue-chromis", name: "Blue chromis" },
  { slug: "barred-hamlet", name: "Barred hamlet" },
];
// Before the frozen test clock: the boat has left.
const sailed = new Date("2026-07-21T11:00:00.000Z");

function view(overrides: Partial<Parameters<typeof seenGroupView>[0]> = {}) {
  return seenGroupView({
    checkpoint: "after_dive_1",
    actionContext: { shopSlug: "blue-mantis", tripId: "trip-1", checkpoint: "after_dive_1" },
    departureStartsAt: sailed,
    executedDives: [],
    plannedDives: [{ dive: { diveNumber: 1 }, diveSite: reef }] as never,
    loggedSightings: [
      { diveSiteId: reef.id, speciesSlug: "blue-chromis", count: 3 },
      { diveSiteId: wreck.id, speciesSlug: "barred-hamlet", count: 1 },
      { diveSiteId: reef.id, speciesSlug: "a-species-diveday-retired", count: 1 },
    ] as never,
    shopPickedSpecies: [],
    catalogSpecies,
    speciesBySite: {},
    t,
    ...overrides,
  });
}

describe("seenGroupView", () => {
  it("attaches the taps to the planned reef, with that reef's tallies only", () => {
    const seen = view();
    expect(seen?.copy.consequence).toBe(t("manifest.seen.consequence", { site: reef.name }));
    expect(seen?.tallies.map((tally) => [tally.slug, tally.count])).toEqual([["blue-chromis", 3]]);
    expect(seen?.recordAction).toEqual({
      record: expect.objectContaining({ diveSiteId: reef.id }),
    });
  });

  it("lets a recorded unknown site win over the plan, and says nothing", () => {
    expect(view({ executedDives: [{ executed: { diveNumber: 1 }, actualSite: null }] })).toBeNull();
  });

  it("is nothing at the dock and nothing on a boat that has not left", () => {
    expect(view({ checkpoint: "departure" })).toBeNull();
    expect(view({ departureStartsAt: new Date("2026-07-22T11:00:00.000Z") })).toBeNull();
  });
});
