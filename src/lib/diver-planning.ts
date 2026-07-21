/**
 * The diver's dock-day rhythm. `dockCallMinutes` is the shop's arrival call
 * (default 30); the crew briefing sits between arrival and departure, so a
 * short call time never puts the briefing before the diver is asked to arrive.
 */
export function dockDayTimeline(startsAt: Date, dockCallMinutes = 30) {
  const at = (minutesBefore: number) => new Date(startsAt.getTime() - minutesBefore * 60_000);
  const briefingBefore = Math.min(15, Math.floor(dockCallMinutes / 2));
  return [
    { label: "Arrive and check in", at: at(dockCallMinutes) },
    { label: "Crew briefing and kit set-up", at: at(briefingBefore) },
    { label: "Departure", at: startsAt },
  ];
}
