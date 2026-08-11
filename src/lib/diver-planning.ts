import type { RentableItemKind } from "@/lib/rentals";

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
/**
 * How long before departure the crew briefing starts, derived from the shop's
 * arrival call so a short call time can never put the briefing before the
 * diver was asked to arrive. Named and exported so the Settings row that sets
 * the call can show the beat it produces, rather than each side doing this
 * arithmetic and drifting.
 */
export function briefingLeadMinutes(dockCallMinutes = 30): number {
  return Math.min(15, Math.floor(dockCallMinutes / 2));
}

/**
 * The rhythm as *offsets*, with no departure to hang it on — what Settings
 * shows beside the one field that sets it, so a shop can see that "30 minutes"
 * is the whole of the timeline their divers read as "Your dock-day rhythm".
 * The beats after departure (`boatRide`, `surfaceInterval`, `return`) are
 * derived from a particular trip's own length, so they are not a shop setting
 * and are deliberately absent here.
 */
export type DockDayRhythmStep = Extract<DockDayStep, "arrive" | "briefing" | "departure">;

export function dockDayRhythmPreview(
  dockCallMinutes = 30,
): Array<{ step: DockDayRhythmStep; minutesBefore: number }> {
  return [
    { step: "arrive", minutesBefore: dockCallMinutes },
    { step: "briefing", minutesBefore: briefingLeadMinutes(dockCallMinutes) },
    { step: "departure", minutesBefore: 0 },
  ];
}

export function dockDayTimeline(
  startsAt: Date,
  dockCallMinutes = 30,
  endsAt?: Date,
): Array<{ step: DockDayStep; at: Date }> {
  const at = (minutesBefore: number) => new Date(startsAt.getTime() - minutesBefore * 60_000);
  const briefingBefore = briefingLeadMinutes(dockCallMinutes);
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

/** What the shop hands every diver regardless of their rental fit — a fixed pair of codes. */
export type ProvidedItemCode = "tanksAndWeights" | "crewBriefing";

/** Which `rental_fit_profiles` boolean field toggles which rentable kind, in display order. */
const RENTAL_FIELD_KINDS: ReadonlyArray<readonly [string, RentableItemKind]> = [
  ["rentsBcd", "bcd"],
  ["rentsRegulator", "regulator"],
  ["rentsWetsuit", "wetsuit"],
  ["rentsMaskFins", "mask_fins"],
  ["rentsWeights", "weights"],
  ["rentsDiveComputer", "dive_computer"],
  ["rentsGopro", "gopro"],
];

/**
 * How cold the water reads, for the "pack a little more neoprene" nudge — a
 * code plus the raw reading, never a rendered sentence: the component
 * composes the one ICU template (`trip.temperatureTip.<tone>`) with
 * `{celsius}` itself.
 */
export type TemperatureTip = { tone: "cold" | "mild"; celsius: number };

export function packingConfidence(
  shopItems: string[],
  rental: null | Record<string, boolean | string | null>,
  waterTemperatureC: number | null,
): {
  bring: string[];
  rented: RentableItemKind[];
  provided: ProvidedItemCode[];
  temperatureTip: TemperatureTip | null;
} {
  const rented = rental
    ? RENTAL_FIELD_KINDS.filter(([field]) => rental[field] === true).map(([, kind]) => kind)
    : [];
  const temperatureTip: TemperatureTip | null =
    waterTemperatureC === null
      ? null
      : { tone: waterTemperatureC < 20 ? "cold" : "mild", celsius: waterTemperatureC };
  return {
    bring: shopItems,
    rented,
    provided: ["tanksAndWeights", "crewBriefing"],
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
