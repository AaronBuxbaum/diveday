import { describe, expect, it } from "vitest";
import type { TodayAction } from "@/lib/today";
import { pushCrewGapRows } from "./today-crew-gap-rows";
import { NOW, rowsContext } from "./today-rows-test-fixtures";

const trip = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date(NOW.getTime() + 24 * 3_600_000),
  course: null,
  booked: 8,
  bookedDivers: 8,
  selfGuided: false,
} as never;
const where = {
  trip,
  when: "8:00 AM",
  departure: { tripId: "trip-1", label: "Two-Tank Reef · 8:00 AM" },
  tripHref: "/shop/blue-mantis/trips/trip-1",
};

function rows(wave: Record<string, unknown>, overrides = {}): TodayAction[] {
  const actions: TodayAction[] = [];
  pushCrewGapRows(actions, rowsContext(wave, overrides), where);
  return actions;
}

describe("pushCrewGapRows", () => {
  it("says a boat with divers and nobody rostered has no crew", () => {
    const [row, ...rest] = rows({ courseCrewCounts: new Map() });
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ kind: "uncrewed_departure", aboutDeparture: true });
    expect(row?.href).toBe("/shop/blue-mantis/trips/trip-1?view=details#crew");
  });

  it("raises nothing on a departure the shop marked self-guided", () => {
    const actions: TodayAction[] = [];
    pushCrewGapRows(actions, rowsContext({ courseCrewCounts: new Map() }), {
      ...where,
      trip: { ...(trip as object), selfGuided: true } as never,
    });
    expect(actions).toEqual([]);
  });

  it("raises nothing when the shop sets no divemaster target", () => {
    expect(rows({ courseCrewCounts: new Map() }, { diversPerDivemaster: null })).toEqual([]);
  });
});
