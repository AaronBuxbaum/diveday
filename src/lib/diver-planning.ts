export function dockDayTimeline(startsAt: Date) {
  const at = (minutesBefore: number) => new Date(startsAt.getTime() - minutesBefore * 60_000);
  return [
    { label: "Arrive and check in", at: at(30) },
    { label: "Crew briefing and gear set-up", at: at(15) },
    { label: "Departure", at: startsAt },
  ];
}
