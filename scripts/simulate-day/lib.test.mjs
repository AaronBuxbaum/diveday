import { describe, expect, it } from "vitest";
import { RECAP_AUTOMATIC_DELAY_MS } from "../../src/lib/recap-schedule";
import { rollCallCheckpoints } from "../../src/lib/roll-call";
import {
  CLOSE_OUT_AFTER_MS,
  DAY_STATES,
  dayTimeline,
  RECAP_FLOOR_MS,
  renderTranscript,
  screenshotName,
} from "./lib.mjs";

const NEWLINE = String.fromCharCode(10);
const dayStart = new Date("2026-07-21T10:00:00.000Z"); // 06:00 in New York
const sailAt = new Date("2026-07-21T15:00:00.000Z"); // 11:00
const endsAt = new Date("2026-07-21T18:30:00.000Z"); // 14:30

describe("dayTimeline", () => {
  it("keeps the recap floor equal to the schedule's own", () => {
    expect(RECAP_FLOOR_MS).toBe(RECAP_AUTOMATIC_DELAY_MS);
  });

  it("places every state, in order, and never asks the clock to step back", () => {
    const timeline = dayTimeline({ dayStart, sailAt, endsAt, plannedDives: 2 });
    expect(timeline.map((state) => state.id)).toEqual(DAY_STATES.map((state) => state.id));
    const instants = timeline.flatMap((state) => state.at.map((d) => d.getTime()));
    for (let i = 1; i < instants.length; i += 1) {
      expect(instants[i]).toBeGreaterThanOrEqual(instants[i - 1]);
    }
  });

  it("anchors the day on the departure's window", () => {
    const byId = Object.fromEntries(
      dayTimeline({ dayStart, sailAt, endsAt, plannedDives: 2 }).map((s) => [s.id, s.at]),
    );
    expect(byId["shop-open"][0]).toEqual(dayStart);
    expect(byId.underway[0]).toEqual(sailAt);
    expect(byId.home[0]).toEqual(endsAt);
    expect(byId["checked-in"][0].getTime()).toBeLessThan(sailAt.getTime());
    expect(byId["day-closed"][0].getTime()).toBe(endsAt.getTime() + CLOSE_OUT_AFTER_MS);
    expect(byId["recap-sent"][0].getTime()).toBeGreaterThan(endsAt.getTime() + RECAP_FLOOR_MS);
  });

  it("gives one after-dive roll call per planned dive, matching the manifest's checkpoints", () => {
    for (const dives of [1, 2, 3, 4]) {
      const [afterDives] = dayTimeline({ dayStart, sailAt, endsAt, plannedDives: dives })
        .filter((state) => state.id === "roll-call-after-dives")
        .map((state) => state.at);
      // The departure checkpoint is its own state; the rest are one per dive.
      expect(afterDives).toHaveLength(rollCallCheckpoints(dives).length - 1);
      for (const instant of afterDives) {
        expect(instant.getTime()).toBeGreaterThan(sailAt.getTime());
        expect(instant.getTime()).toBeLessThan(endsAt.getTime());
      }
    }
  });

  it("refuses a window that is not a day", () => {
    expect(() => dayTimeline({ dayStart, sailAt: dayStart, endsAt, plannedDives: 2 })).toThrow(
      /sails before the shop opens/,
    );
    expect(() => dayTimeline({ dayStart, sailAt, endsAt: sailAt, plannedDives: 2 })).toThrow(
      /ties up before it sails/,
    );
  });
});

describe("screenshotName", () => {
  it("zero-pads the index and carries an optional suffix", () => {
    expect(screenshotName(0, "shop-open")).toBe("01-shop-open.png");
    expect(screenshotName(11, "recap-sent", "diver")).toBe("12-recap-sent-diver.png");
  });
});

describe("renderTranscript", () => {
  const base = {
    shopSlug: "reef-otter",
    timeZone: "America/New_York",
    dayStart,
    startedAt: new Date("2026-09-07T20:00:00.000Z"),
    finishedAt: new Date("2026-09-07T20:03:30.000Z"),
  };

  it("writes a row per state with the shop's own time and the screenshots it left", () => {
    const md = renderTranscript({
      ...base,
      results: [
        {
          id: "shop-open",
          label: "The shop opens",
          status: "reached",
          simulatedAt: dayStart,
          realMs: 4200,
          screenshots: ["01-shop-open.png"],
        },
        {
          id: "seat-booked",
          label: "A diver books a seat",
          status: "reached",
          simulatedAt: new Date("2026-07-21T10:15:00.000Z"),
          realMs: 800,
          screenshots: ["02-seat-booked.png"],
          note: "Sam Simulation, 1 seat",
        },
      ],
    });
    expect(md).toContain("**Result: every state reached** — 2 of 2.");
    expect(md).toContain("| 01 | The shop opens | 06:00 | 4.2 s | `01-shop-open.png` |  |");
    expect(md).toContain(
      "| 02 | A diver books a seat | 06:15 | 800 ms | `02-seat-booked.png` | Sam Simulation, 1 seat |",
    );
    expect(md).toContain("Real time: 3 min 30 s");
  });

  it("names the failed state and marks everything after it as not attempted", () => {
    const md = renderTranscript({
      ...base,
      results: [
        {
          id: "shop-open",
          label: "The shop opens",
          status: "reached",
          simulatedAt: dayStart,
          realMs: 1,
        },
        {
          id: "seat-booked",
          label: "A diver books a seat",
          status: "failed",
          simulatedAt: dayStart,
          realMs: 9000,
          error: "expected /ready/ but got /s/reef-otter | 500",
        },
        { id: "waiver-signed", label: "The diver signs", status: "not-attempted" },
      ],
    });
    expect(md).toContain('**Result: FAILED at "A diver books a seat"** — 1 of 3 states reached.');
    expect(md).toContain("| 02 | **A diver books a seat** — failed |");
    expect(md).toContain("got /s/reef-otter \\| 500");
    expect(md).toContain("| 03 | The diver signs — not attempted |  |  |  |  |");
  });

  it("calls a run that stopped without a failure incomplete, never complete", () => {
    const md = renderTranscript({
      ...base,
      results: [
        {
          id: "shop-open",
          label: "The shop opens",
          status: "reached",
          simulatedAt: dayStart,
          realMs: 1,
        },
        { id: "seat-booked", label: "A diver books a seat", status: "not-attempted" },
      ],
    });
    expect(md).toContain("**Result: incomplete** — 1 of 2 states reached");
    expect(md).not.toContain("every state reached");
  });

  it("strips the colour codes Playwright puts in an assertion message", () => {
    const esc = String.fromCharCode(27);
    const md = renderTranscript({
      ...base,
      results: [
        {
          id: "seat-booked",
          label: "A diver books a seat",
          status: "failed",
          error: `${esc}[2mexpect(${esc}[22m${esc}[31mlocator${esc}[39m${esc}[2m).${esc}[22mtoBeVisible failed`,
        },
      ],
    });
    expect(md).toContain("| expect(locator).toBeVisible failed |");
    expect(md).not.toContain(esc);
  });

  /**
   * A transcript row is a Markdown table cell, so a pipe in an error message
   * has to be escaped -- and escaping only the pipe is worse than not escaping
   * it, because the backslash it adds is itself unescaped. `a\\|b` became
   * `a\\\\|b`: a literal backslash, then a live pipe, and every row below it
   * shifted a column.
   */
  it("escapes a backslash before the pipe that follows it", () => {
    const md = renderTranscript({
      ...base,
      results: [
        {
          id: "seat-booked",
          label: "A diver books a seat",
          status: "failed",
          error: String.raw`waiting for locator('text=/a\|b/')`,
        },
      ],
    });
    expect(md).toContain(String.raw`| waiting for locator('text=/a\\\|b/') |`);
    // One cell, not two: the row still has the six columns its header names,
    // so splitting on unescaped pipes leaves 6 fields between 2 empty ends.
    const row = md
      .split(NEWLINE)
      .find((line) => line.startsWith("|") && line.includes("A diver books a seat"));
    expect(row?.split(/(?<!\\)\|/)).toHaveLength(8);
  });
});
