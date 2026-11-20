import { describe, expect, it } from "vitest";
import { collisionsFor, type DayDeparture, dayCollisions } from "./rules";

const at = (hhmm: string) => new Date(`2026-11-21T${hhmm}:00Z`);
const trip = (
  tripId: string,
  start: string,
  end: string,
  boatId: string | null,
  crew: string[] = [],
): DayDeparture => ({
  tripId,
  startsAt: at(start),
  endsAt: at(end),
  boatId,
  crew: crew.map((personId) => ({ personId })),
});

describe("dayCollisions", () => {
  const cases: { name: string; trips: DayDeparture[]; expected: unknown[] }[] = [
    {
      name: "one person on two boats at overlapping hours",
      trips: [
        trip("a", "08:00", "12:00", "b1", ["ana"]),
        trip("b", "10:00", "14:00", "b2", ["ana"]),
      ],
      expected: [{ kind: "crew", personId: "ana", tripIds: ["a", "b"] }],
    },
    {
      name: "a morning two-tank and an afternoon single are a double shift, not a clash",
      trips: [
        trip("a", "08:00", "12:00", "b1", ["ana"]),
        trip("b", "13:00", "16:00", "b2", ["ana"]),
      ],
      expected: [],
    },
    {
      name: "a boat home exactly as the next sails is not a clash",
      trips: [
        trip("a", "08:00", "12:00", "b1", ["ana"]),
        trip("b", "12:00", "16:00", "b2", ["ana"]),
      ],
      expected: [],
    },
    {
      name: "the same boat on two overlapping departures",
      trips: [trip("a", "08:00", "12:00", "b1"), trip("b", "11:00", "15:00", "b1")],
      expected: [{ kind: "boat", boatId: "b1", tripIds: ["a", "b"] }],
    },
    {
      name: "departures with no boat named never collide on a boat",
      trips: [trip("a", "08:00", "12:00", null), trip("b", "09:00", "13:00", null)],
      expected: [],
    },
    {
      name: "different crew on overlapping boats is fine",
      trips: [
        trip("a", "08:00", "12:00", "b1", ["ana"]),
        trip("b", "08:00", "12:00", "b2", ["ben"]),
      ],
      expected: [],
    },
    {
      name: "a shared boat and a shared person are two collisions",
      trips: [
        trip("a", "08:00", "12:00", "b1", ["ana"]),
        trip("b", "09:00", "11:00", "b1", ["ana"]),
      ],
      expected: [
        { kind: "boat", boatId: "b1", tripIds: ["a", "b"] },
        { kind: "crew", personId: "ana", tripIds: ["a", "b"] },
      ],
    },
  ];
  it.each(cases)("$name", ({ trips, expected }) => {
    expect(dayCollisions(trips)).toEqual(expected);
  });

  it("names the collisions one departure is part of", () => {
    const all = dayCollisions([
      trip("a", "08:00", "12:00", "b1", ["ana"]),
      trip("b", "09:00", "11:00", "b2", ["ana"]),
      trip("c", "14:00", "16:00", "b1", ["ana"]),
    ]);
    expect(collisionsFor("b", all)).toHaveLength(1);
    expect(collisionsFor("c", all)).toHaveLength(0);
  });
});
