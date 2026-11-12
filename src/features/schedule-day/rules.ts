/** The actual occupied legs of one departure, within a single shop. */
export type CrewDeparture = {
  tripId: string;
  status: "scheduled" | "cancelled";
  windows: readonly { startsAt: Date; endsAt: Date }[];
  crewIds: readonly string[];
};

/** Shared crew on two live departures with overlapping half-open legs. */
export function crewCollisions(first: CrewDeparture, second: CrewDeparture): string[] {
  if (
    first.tripId === second.tripId ||
    first.status !== "scheduled" ||
    second.status !== "scheduled"
  ) {
    return [];
  }
  const overlaps = first.windows.some((a) =>
    second.windows.some((b) => a.startsAt < b.endsAt && a.endsAt > b.startsAt),
  );
  if (!overlaps) return [];
  const otherCrew = new Set(second.crewIds);
  return [...new Set(first.crewIds)].filter((id) => otherCrew.has(id));
}
