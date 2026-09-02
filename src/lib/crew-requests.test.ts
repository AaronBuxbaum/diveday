import { describe, expect, it } from "vitest";

import {
  type AvailabilityBlock,
  blockCoversDay,
  blockCoversMeetings,
  crewRequestRefusal,
  overlappingBlocks,
} from "./crew-requests";

const TZ = "America/New_York";

function block(overrides: Partial<AvailabilityBlock> = {}): AvailabilityBlock {
  return {
    id: "block-1",
    personId: "person-1",
    startsOn: "2026-08-24",
    endsOn: "2026-08-26",
    note: null,
    ...overrides,
  };
}

/** 8:00 AM – 1:00 PM Key Largo on the given day. */
const morningOf = (day: string) => ({
  startsAt: new Date(`${day}T12:00:00.000Z`),
  endsAt: new Date(`${day}T17:00:00.000Z`),
});

describe("a range of days", () => {
  it("covers its own ends, inclusively", () => {
    expect(blockCoversDay(block(), "2026-08-24")).toBe(true);
    expect(blockCoversDay(block(), "2026-08-26")).toBe(true);
    expect(blockCoversDay(block(), "2026-08-23")).toBe(false);
    expect(blockCoversDay(block(), "2026-08-27")).toBe(false);
  });

  it("covers a single day when both ends are the same", () => {
    const one = block({ startsOn: "2026-08-25", endsOn: "2026-08-25" });
    expect(blockCoversDay(one, "2026-08-25")).toBe(true);
    expect(blockCoversDay(one, "2026-08-24")).toBe(false);
  });
});

describe("a range of days against a departure", () => {
  it("meets a run on any of its days, not just the day it starts on", () => {
    // A Thursday-to-Saturday course against a Friday-only blackout.
    const course = [morningOf("2026-08-27"), morningOf("2026-08-28"), morningOf("2026-08-29")];
    const friday = block({ startsOn: "2026-08-28", endsOn: "2026-08-28" });
    expect(blockCoversMeetings(friday, course, TZ)).toBe(true);
  });

  it("reads the departure in the shop's zone, not the host's", () => {
    // 8:00 PM Key Largo on the 26th is already the 27th in UTC. A blackout for
    // the 27th must not claim it, and one for the 26th must.
    const evening = {
      startsAt: new Date("2026-08-27T00:00:00.000Z"),
      endsAt: new Date("2026-08-27T02:00:00.000Z"),
    };
    expect(
      blockCoversMeetings(block({ startsOn: "2026-08-26", endsOn: "2026-08-26" }), [evening], TZ),
    ).toBe(true);
    expect(
      blockCoversMeetings(block({ startsOn: "2026-08-27", endsOn: "2026-08-27" }), [evening], TZ),
    ).toBe(false);
  });

  it("leaves a meeting that ends exactly at midnight to the day it started in", () => {
    const untilMidnight = {
      startsAt: new Date("2026-08-27T02:00:00.000Z"), // 10 PM on the 26th
      endsAt: new Date("2026-08-27T04:00:00.000Z"), // midnight, exclusive
    };
    expect(
      blockCoversMeetings(
        block({ startsOn: "2026-08-27", endsOn: "2026-08-27" }),
        [untilMidnight],
        TZ,
      ),
    ).toBe(false);
  });

  it("names which days, so a surface can say them", () => {
    const blocks = [block(), block({ id: "other", personId: "person-2" })];
    const found = overlappingBlocks(blocks, "person-1", [morningOf("2026-08-25")], TZ);
    expect(found.map((b) => b.id)).toEqual(["block-1"]);
    // Somebody else's holiday is not this person's warning.
    expect(overlappingBlocks(blocks, "person-3", [morningOf("2026-08-25")], TZ)).toEqual([]);
  });
});

describe("whether a crew member may ask for a departure", () => {
  const base = {
    personId: "person-1",
    meetings: [morningOf("2026-08-28")],
    crewPersonIds: [] as string[],
    livePendingOrDecidedPersonIds: [] as string[],
    blocks: [] as AvailabilityBlock[],
    timeZone: TZ,
    now: new Date("2026-08-20T00:00:00.000Z"),
  };

  it("allows an ordinary ask", () => {
    expect(crewRequestRefusal(base)).toBeNull();
  });

  it("refuses somebody already on the crew — they came here without reading the roster", () => {
    expect(crewRequestRefusal({ ...base, crewPersonIds: ["person-1"] })).toBe("already_crewing");
  });

  it("refuses a second ask, because a second tap is the same ask", () => {
    expect(crewRequestRefusal({ ...base, livePendingOrDecidedPersonIds: ["person-1"] })).toBe(
      "already_requested",
    );
  });

  it("refuses a departure the person has said they are away for", () => {
    expect(
      crewRequestRefusal({
        ...base,
        blocks: [block({ startsOn: "2026-08-28", endsOn: "2026-08-28" })],
      }),
    ).toBe("unavailable");
  });

  it("ignores somebody else's blackout", () => {
    expect(
      crewRequestRefusal({
        ...base,
        blocks: [block({ personId: "person-2", startsOn: "2026-08-28", endsOn: "2026-08-28" })],
      }),
    ).toBeNull();
  });

  it("refuses a departure that has sailed, with the shop-wide hour of grace", () => {
    // The trip ends at 1:00 PM Key Largo (17:00 UTC). Forty minutes later it is
    // still askable — trips run late, and AGENTS.md's buffer says so.
    expect(crewRequestRefusal({ ...base, now: new Date("2026-08-28T17:40:00.000Z") })).toBeNull();
    expect(crewRequestRefusal({ ...base, now: new Date("2026-08-28T18:30:00.000Z") })).toBe("past");
  });

  it("answers the crew check before the blackout, so the clearer refusal wins", () => {
    expect(
      crewRequestRefusal({
        ...base,
        crewPersonIds: ["person-1"],
        blocks: [block({ startsOn: "2026-08-28", endsOn: "2026-08-28" })],
      }),
    ).toBe("already_crewing");
  });
});
