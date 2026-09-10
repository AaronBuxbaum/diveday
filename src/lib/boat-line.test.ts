import { describe, expect, it } from "vitest";
import {
  BOAT_LINE_AS_OF_AFTER_MS,
  type BoatLineStep,
  boatLineClosesAt,
  boatLineMarks,
  boatLineSteps,
  boatWordIsStale,
} from "./boat-line";
import { DEFAULT_DOCK_DAY_RHYTHM } from "./diver-planning";
import { STAGE_STALE_AFTER_MS } from "./trip-stages";

const startsAt = new Date("2026-08-27T11:00:00.000Z");
const endsAt = new Date("2026-08-27T14:30:00.000Z");

function steps(): BoatLineStep[] {
  return boatLineSteps({
    startsAt,
    endsAt,
    rhythm: DEFAULT_DOCK_DAY_RHYTHM,
    siteNames: ["Molasses Reef", "French Reef"],
  });
}

describe("boatLineSteps", () => {
  it("names check-in, the departure, each site in the plan, and back", () => {
    expect(steps().map((step) => [step.kind, step.siteName])).toEqual([
      ["checkIn", null],
      ["leaves", null],
      ["site", "Molasses Reef"],
      ["site", "French Reef"],
      ["back", null],
    ]);
  });

  it("opens check-in before the departure and closes on the published return", () => {
    const line = steps();
    expect(line[0]?.at.getTime()).toBeLessThan(startsAt.getTime());
    expect(line[1]?.at).toEqual(startsAt);
    expect(line.at(-1)?.at).toEqual(endsAt);
  });

  it("keeps a site with no name on the line rather than dropping the dive", () => {
    const line = boatLineSteps({
      startsAt,
      endsAt,
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      siteNames: [null, null],
    });
    expect(line.filter((step) => step.kind === "site")).toHaveLength(2);
    expect(line.every((step) => step.siteName === null)).toBe(true);
  });

  it("renders the dock beats only when the departure states no return", () => {
    const line = boatLineSteps({
      startsAt,
      endsAt: null,
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      siteNames: ["Molasses Reef"],
    });
    expect(line.map((step) => step.kind)).toEqual(["checkIn", "leaves"]);
  });
});

describe("boatLineMarks", () => {
  it("leaves the whole line ahead when the crew has said nothing", () => {
    expect(boatLineMarks(steps(), null)).toEqual(["todo", "todo", "todo", "todo", "todo"]);
  });

  it("marks the step the day had reached when the crew spoke", () => {
    // "On the surface", said between the two sites.
    const said = new Date("2026-08-27T12:52:00.000Z");
    expect(boatLineMarks(steps(), { stage: "surface", recordedAt: said })).toEqual([
      "done",
      "done",
      "now",
      "todo",
      "todo",
    ]);
  });

  it("does not walk the line forward while the crew stays quiet", () => {
    const line = steps();
    const said = new Date("2026-08-27T10:40:00.000Z");
    const boarding = { stage: "boarding", recordedAt: said } as const;
    // Two readings of the same word, hours apart in wall-clock terms: the mark
    // is the same, because a clock is not evidence about a boat.
    expect(boatLineMarks(line, boarding)).toEqual(boatLineMarks(line, boarding));
    expect(boatLineMarks(line, boarding)).toEqual(["now", "todo", "todo", "todo", "todo"]);
  });

  it("marks the first step for a crew that boards ahead of its own check-in", () => {
    const said = new Date("2026-08-27T09:00:00.000Z");
    expect(boatLineMarks(steps(), { stage: "boarding", recordedAt: said })).toEqual([
      "now",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
  });

  it("closes the whole line when the crew says the boat is home", () => {
    const said = new Date("2026-08-27T14:35:00.000Z");
    expect(boatLineMarks(steps(), { stage: "home", recordedAt: said })).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  it("marks nothing on an empty line", () => {
    expect(boatLineMarks([], { stage: "underway", recordedAt: startsAt })).toEqual([]);
  });
});

describe("boatWordIsStale", () => {
  const said = new Date("2026-08-27T12:52:00.000Z");

  it("lets a fresh word stand on its own", () => {
    expect(boatWordIsStale(said, new Date(said.getTime() + BOAT_LINE_AS_OF_AFTER_MS))).toBe(false);
  });

  it("names the time once the word is a quarter of an hour old", () => {
    expect(boatWordIsStale(said, new Date(said.getTime() + BOAT_LINE_AS_OF_AFTER_MS + 1000))).toBe(
      true,
    );
  });

  it("treats a word from the future as fresh rather than as an error", () => {
    expect(boatWordIsStale(said, new Date(said.getTime() - 60_000))).toBe(false);
  });
});

describe("boatLineClosesAt", () => {
  it("closes one stale-stage window past the published return", () => {
    expect(boatLineClosesAt(startsAt, endsAt, STAGE_STALE_AFTER_MS)).toEqual(
      new Date(endsAt.getTime() + STAGE_STALE_AFTER_MS),
    );
  });

  it("closes a departure with no stated return rather than answering forever", () => {
    const closes = boatLineClosesAt(startsAt, null, STAGE_STALE_AFTER_MS);
    expect(closes.getTime()).toBeGreaterThan(startsAt.getTime());
    expect(closes.getTime()).toBeLessThan(startsAt.getTime() + 24 * 60 * 60 * 1000);
  });
});
