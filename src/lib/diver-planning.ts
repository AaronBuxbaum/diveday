/**
 * The diver's dock-day rhythm. `dockCallMinutes` is the shop's arrival call
 * (default 30); the crew briefing sits between arrival and departure, so a
 * short call time never puts the briefing before the diver is asked to arrive.
 */
export function dockDayTimeline(startsAt: Date, dockCallMinutes = 30, endsAt?: Date) {
  const at = (minutesBefore: number) => new Date(startsAt.getTime() - minutesBefore * 60_000);
  const briefingBefore = Math.min(15, Math.floor(dockCallMinutes / 2));
  return [
    { label: "Arrive and check in", at: at(dockCallMinutes) },
    { label: "Crew briefing and kit set-up", at: at(briefingBefore) },
    { label: "Departure", at: startsAt },
    ...(endsAt
      ? [
          {
            label: "Boat ride and dives — crew confirms the live plan",
            at: new Date(startsAt.getTime() + (endsAt.getTime() - startsAt.getTime()) / 3),
          },
          {
            label: "Surface interval and second briefing",
            at: new Date(startsAt.getTime() + ((endsAt.getTime() - startsAt.getTime()) * 2) / 3),
          },
          { label: "Expected return", at: endsAt },
        ]
      : []),
  ];
}

export type SitePlanningFacts = {
  difficulty: string | null;
  depthRange: string | null;
  currentNote: string | null;
};

export function siteFit(facts: SitePlanningFacts) {
  const evidence = [facts.difficulty, facts.depthRange, facts.currentNote]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const text = evidence.join(" ").toLowerCase();
  const demanding = /advanced|expert|strong|swift|surge|deep|30\s*m|100\s*ft/.test(text);
  const welcoming = /beginner|easy|gentle|sheltered|calm|shallow/.test(text);
  return {
    label: demanding
      ? "Best with recent experience"
      : welcoming
        ? "Welcoming dive"
        : "Ask the crew about fit",
    detail: demanding
      ? "Depth or water movement can add work here. Read the site facts and check with the crew if it has been a while."
      : welcoming
        ? "The published depth and water movement make this an approachable crew-led day."
        : "The crew adapts the route to the group and the day. The facts below are the useful starting point.",
  };
}

export function packingConfidence(
  shopItems: string[],
  rental: null | Record<string, boolean | string | null>,
  waterTemperatureC: number | null,
) {
  const rented = rental
    ? [
        ["rentsBcd", "BCD"],
        ["rentsRegulator", "Regulator"],
        ["rentsWetsuit", "Wetsuit"],
        ["rentsMaskFins", "Mask and fins"],
        ["rentsWeights", "Weights"],
        ["rentsDiveComputer", "Dive computer"],
        ["rentsGopro", "GoPro"],
      ]
        .filter(([field]) => rental[field] === true)
        .map(([, label]) => label)
    : [];
  const temperatureTip =
    waterTemperatureC === null
      ? null
      : waterTemperatureC < 20
        ? `Water is expected around ${waterTemperatureC}°C — ask the shop whether you need extra exposure protection.`
        : `Water is expected around ${waterTemperatureC}°C — use the shop's wetsuit guidance for comfort.`;
  return {
    bring: shopItems,
    rented,
    provided: ["Tanks and weights", "Crew briefing"],
    temperatureTip,
  };
}

export function conditionsChangedSinceBooking(
  conditionsUpdatedAt: Date | null,
  conditionsBriefedAt: Date | null,
) {
  return Boolean(
    conditionsUpdatedAt &&
      (!conditionsBriefedAt || conditionsUpdatedAt.getTime() > conditionsBriefedAt.getTime()),
  );
}
