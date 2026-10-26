import type { PlacedGap, PlacedTrip, StaffWeek } from "@/lib/staffing-week";

/** Presentation only: identity and session window keep same-named boats apart. */
export function mobileDepartureGroups(
  people: StaffWeek["people"],
  dayIndex: number,
  gaps: readonly PlacedGap[],
) {
  type Group = {
    key: string;
    trip: PlacedTrip | PlacedGap;
    gap?: PlacedGap;
    crew: { person: StaffWeek["people"][number]; trip: PlacedTrip }[];
  };
  const groups = new Map<string, Group>();
  const groupFor = (trip: PlacedTrip | PlacedGap) => {
    const key = `${trip.tripId}:${trip.startsAt.toISOString()}:${trip.endsAt.toISOString()}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, trip, crew: [] };
      groups.set(key, group);
    }
    return group;
  };
  for (const gap of gaps) groupFor(gap).gap = gap;
  for (const person of people) {
    for (const trip of person.days[dayIndex]?.crewing ?? [])
      groupFor(trip).crew.push({ person, trip });
  }
  return [...groups.values()].sort((a, b) => a.trip.startsAt.getTime() - b.trip.startsAt.getTime());
}
