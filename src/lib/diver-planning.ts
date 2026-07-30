/** The fixed beats of a dock day; the component looks each one up in `trip.timeline.*`. */
export type DockDayStep =
  | "arrive"
  | "briefing"
  | "departure"
  | "boatRide"
  | "surfaceInterval"
  | "return";

/**
 * The diver's dock-day rhythm. `dockCallMinutes` is the shop's arrival call
 * (default 30); the crew briefing sits between arrival and departure, so a
 * short call time never puts the briefing before the diver is asked to arrive.
 *
 * Returns message *keys*, not prose: `src/lib` never renders, and a compiled-in
 * English label here is exactly the kind of string a diver on a Spanish page
 * would have read in English forever (docs ADR 20260729-diver-copy-localization).
 */
export function dockDayTimeline(
  startsAt: Date,
  dockCallMinutes = 30,
  endsAt?: Date,
): Array<{ step: DockDayStep; at: Date }> {
  const at = (minutesBefore: number) => new Date(startsAt.getTime() - minutesBefore * 60_000);
  const briefingBefore = Math.min(15, Math.floor(dockCallMinutes / 2));
  return [
    { step: "arrive", at: at(dockCallMinutes) },
    { step: "briefing", at: at(briefingBefore) },
    { step: "departure", at: startsAt },
    ...(endsAt
      ? ([
          {
            step: "boatRide",
            at: new Date(startsAt.getTime() + (endsAt.getTime() - startsAt.getTime()) / 3),
          },
          {
            step: "surfaceInterval",
            at: new Date(startsAt.getTime() + ((endsAt.getTime() - startsAt.getTime()) * 2) / 3),
          },
          { step: "return", at: endsAt },
        ] as const)
      : []),
  ];
}

export type SitePlanningFacts = {
  difficulty: string | null;
  depthRange: string | null;
  currentNote: string | null;
};

/** Which of the three fit readings a site's published facts support. */
export type SiteFitTone = "demanding" | "welcoming" | "unknown";

/**
 * How demanding a site reads from what the shop published about it. Returns the
 * *tone*, not prose, for the same reason `dockDayTimeline` returns steps: the
 * component looks up `trip.siteFit<Tone>Label`/`Detail` in the reader's own
 * language.
 */
export function siteFit(facts: SitePlanningFacts): { tone: SiteFitTone } {
  const evidence = [facts.difficulty, facts.depthRange, facts.currentNote]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const text = evidence.join(" ").toLowerCase();
  if (/advanced|expert|strong|swift|surge|deep|30\s*m|100\s*ft/.test(text)) {
    return { tone: "demanding" };
  }
  if (/beginner|easy|gentle|sheltered|calm|shallow/.test(text)) return { tone: "welcoming" };
  return { tone: "unknown" };
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
