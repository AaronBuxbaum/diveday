import { describe, expect, it } from "vitest";
import type { PlacedTrip } from "@/lib/staffing-week";
import { mobileDepartureGroups } from "./staffing-mobile-groups";

describe("phone departure grouping", () => {
  const meeting = {
    startsAt: new Date("2026-08-27T11:00:00Z"),
    endsAt: new Date("2026-08-27T15:00:00Z"),
  };
  const trip = {
    ...meeting,
    tripId: "reef-one",
    title: "Reef",
    continuesFrom: null,
    endsThisDay: true,
    awayBlocks: [],
    clashes: [],
  };
  const person = (id: string, trips: PlacedTrip[] = [trip]) => ({
    personId: id,
    name: id,
    roles: ["Divemaster"],
    days: [{ date: "2026-08-27", shifts: [], away: [], crewing: trips }],
  });
  it("groups a shared departure once and retains every person independently", () => {
    const grouped = mobileDepartureGroups([person("keiko"), person("sal")], 0, []);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.crew.map(({ person }) => person.personId)).toEqual(["keiko", "sal"]);
  });
  it("never merges same-named departures or separate sessions", () => {
    const other = { ...trip, tripId: "reef-two" };
    const later = {
      ...trip,
      startsAt: new Date("2026-08-27T17:00:00Z"),
      endsAt: new Date("2026-08-27T21:00:00Z"),
    };
    const grouped = mobileDepartureGroups([person("keiko", [trip, other, later])], 0, []);
    expect(grouped).toHaveLength(3);
    expect(grouped.map(({ trip }) => trip.tripId)).toEqual(["reef-one", "reef-two", "reef-one"]);
  });
  it("keeps a gap with its own departure while retaining that person's warnings", () => {
    const warningTrip = { ...trip, clashes: [{ tripId: "other", title: "Other boat" }] };
    const gap = {
      ...trip,
      gap: "uncrewed_departure" as const,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      tripId: trip.tripId,
      requests: [],
      viewerMayRequest: false,
      viewerAskWontClose: false,
      ratingLapsed: true,
    };
    const grouped = mobileDepartureGroups([person("keiko", [warningTrip])], 0, [gap]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.gap).toBe(gap);
    expect(grouped[0]?.crew[0]?.trip.clashes).toEqual(warningTrip.clashes);
  });
});
