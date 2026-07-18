export function packingChecklist(
  waterTemperatureC: number | null,
  surfaceConditions: string | null,
) {
  const items = ["Mask, fins, computer, certification card, and a dry layer for the ride home"];
  if (waterTemperatureC !== null && waterTemperatureC < 25)
    items.unshift("Exposure protection suited to cooler water");
  if (surfaceConditions?.toLowerCase().includes("chop"))
    items.push("Secure any loose gear for the boat ride");
  return items;
}

export function dockDayTimeline(startsAt: Date) {
  const at = (minutesBefore: number) => new Date(startsAt.getTime() - minutesBefore * 60_000);
  return [
    { label: "Arrive and check in", at: at(30) },
    { label: "Crew briefing and gear set-up", at: at(15) },
    { label: "Departure", at: startsAt },
  ];
}

export function fitMessage(
  difficulty: string | null,
  depthRange: string | null,
  currentNote: string | null,
) {
  const level = difficulty ? `${difficulty[0]?.toUpperCase()}${difficulty.slice(1)}` : "Crew-led";
  return [level, depthRange, currentNote].filter(Boolean).join(" · ");
}
