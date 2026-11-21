import { expect, it } from "vitest";
import { assembleDayCloseout, assembleEveningClose, type CloseoutTripInput } from "./closeout";
import { closeoutRoleOverlap } from "./closeout-role-overlap";

it("requires positive final evidence in both roles to deduplicate a return", () => {
  const passenger = { personId: "priya", sailed: true, confirmed: true, back: true };
  expect(
    closeoutRoleOverlap([passenger], [{ personId: "priya", ashore: false, back: true }]),
  ).toEqual({ out: 1, back: 1 });
  expect(
    closeoutRoleOverlap(
      [{ ...passenger, back: false }],
      [{ personId: "priya", ashore: false, back: true }],
    ),
  ).toEqual({ out: 1, back: 0 });
  expect(
    closeoutRoleOverlap(
      [{ ...passenger, confirmed: false }],
      [{ personId: "priya", ashore: false, back: true }],
    ),
  ).toEqual({ out: 0, back: 0 });
  expect(
    closeoutRoleOverlap([passenger], [{ personId: "priya", ashore: true, back: false }]),
  ).toEqual({ out: 0, back: 0 });
});

it("deduplicates within each departure and never celebrates over conflicting evidence", () => {
  const now = new Date("2026-08-04T20:00:00Z");
  const input = (tripId: string): CloseoutTripInput => ({
    tripId,
    title: "Reef",
    startsAt: new Date("2026-08-04T11:30:00Z"),
    endsAt: new Date("2026-08-04T15:30:00Z"),
    booked: 1,
    sailed: 1,
    capacity: 1,
    plannedDives: 1,
    crew: [{ rollCall: { state: "boarded" } }],
    recapShoutout: null,
    physicalOverlap: { out: 1, back: 1 },
  });
  const state = assembleDayCloseout({
    trips: [input("one"), input("two")],
    gaps: [],
    timeZone: "UTC",
    now,
  });
  expect(assembleEveningClose(state.departures, now)).toMatchObject({
    out: 2,
    back: 2,
    divers: 2,
    crew: 2,
    allHome: true,
  });
  const first = state.departures[0];
  if (!first) throw new Error("departure fixture missing");
  const conflict = assembleEveningClose(
    [
      {
        ...first,
        status: "unreconciled",
        gapReason: "missing_diver",
        uncounted: 1,
        physicalOverlap: { out: 1, back: 0 },
      },
    ],
    now,
  );
  expect(conflict.out).toBe(conflict.back);
  expect(conflict.allHome).toBe(false);
});
