import type { DiveSiteDifficulty } from "@/lib/dive-site-difficulty";
import type { RentableItemKind } from "@/lib/rentals";

/**
 * The beats of a dock day; the component looks each one up in
 * `trip.timeline.*`. `dive` and `surfaceInterval` repeat, so both carry a
 * number — a two-tank morning has a Dive 1 and a Dive 2, and calling them the
 * same thing was how the old timeline got away with printing one of each.
 */
export type DockDayStep =
  | "arrive"
  | "gearSetup"
  | "briefing"
  | "departure"
  | "boatRide"
  | "dive"
  | "surfaceInterval"
  | "return";

/**
 * **The shop's own day, in minutes.** Every field here is a number a shop sets
 * in Settings; nothing about the rhythm is inferred any more.
 *
 * It used to be. One field — the arrival call — produced the whole timeline: the
 * briefing was `min(15, dockCall / 2)`, and the two beats on the water were
 * literally the trip window's thirds, so "Boat ride and dives" landed at 1/3
 * and "Surface interval" at 2/3 of the day no matter how far the site was, how
 * long the dives ran, or whether there were two of them at all. A one-tank
 * check-out dive printed a surface interval it would never have. A shop that
 * doesn't brief at the dock, or that kits up on the boat, or that walks into
 * the water off a beach, had no way to say so and read DiveDay telling their
 * divers otherwise.
 *
 * Two kinds of number, and the difference is the whole model:
 *
 * - **before departure**, a beat is *how many minutes ahead of the lines coming
 *   off* it happens. `0` means the shop does not run that beat and it drops out
 *   of the day entirely — that is the switch for "we don't brief" and "kit up
 *   on board".
 * - **after departure**, a beat is a *duration*, and the day is laid end to end
 *   from them: ride out, dive, surface interval, dive, … for as many dives as
 *   the departure actually plans.
 *
 * Nothing here is a sentence. `src/lib` returns steps and numbers; the surface
 * looks each step up in the reader's own language (docs ADR
 * 20260729-diver-copy-localization).
 */
export type DockDayRhythm = {
  /** Minutes before departure divers are asked to be at the dock. */
  dockCallMinutes: number;
  /** Minutes before departure gear set-up starts; 0 — the shop kits up on board. */
  gearSetupMinutes: number;
  /** Minutes before departure the briefing starts; 0 — the shop doesn't brief at the dock. */
  briefingMinutes: number;
  /** How long the ride out to the first site takes; 0 — a shore entry. */
  boatRideMinutes: number;
  /** How long one dive spends in the water. */
  bottomTimeMinutes: number;
  /** How long between two dives; 0 — back-to-back. Never used on a one-dive day. */
  surfaceIntervalMinutes: number;
};

/**
 * What a shop's day looks like before anybody has changed it — and, because the
 * columns carry these as their defaults, what every existing shop reads as on
 * the morning this shipped. Chosen to sit as close to the old derived timeline
 * as a fixed set of numbers can: a 30-minute call with a 15-minute briefing is
 * exactly what `min(15, dockCall / 2)` produced at the default call, and no
 * set-up beat because there never was one.
 */
export const DEFAULT_DOCK_DAY_RHYTHM: DockDayRhythm = {
  dockCallMinutes: 30,
  gearSetupMinutes: 0,
  briefingMinutes: 15,
  boatRideMinutes: 20,
  bottomTimeMinutes: 45,
  surfaceIntervalMinutes: 60,
};

/**
 * What each field will accept, in one place: the Settings form's `min`/`max`
 * attributes, the server action that refuses a forged submission, and the
 * table's own CHECK constraints all read from here, so a bound can never be
 * loosened on the form alone.
 *
 * `bottomTimeMinutes` has a floor above zero because it is the one beat with no
 * "we don't do that" reading — a dive trip has dives. The rest floor at zero,
 * which *is* the switch that takes the beat out of the day.
 */
export const DOCK_DAY_LIMITS = {
  dockCallMinutes: { min: 5, max: 180 },
  gearSetupMinutes: { min: 0, max: 180 },
  briefingMinutes: { min: 0, max: 180 },
  boatRideMinutes: { min: 0, max: 480 },
  bottomTimeMinutes: { min: 5, max: 180 },
  surfaceIntervalMinutes: { min: 0, max: 480 },
} as const satisfies Record<keyof DockDayRhythm, { min: number; max: number }>;

/** The rhythm's fields in the order a shop reads and edits them. */
export const DOCK_DAY_FIELDS = [
  "dockCallMinutes",
  "gearSetupMinutes",
  "briefingMinutes",
  "boatRideMinutes",
  "bottomTimeMinutes",
  "surfaceIntervalMinutes",
] as const satisfies ReadonlyArray<keyof DockDayRhythm>;

/**
 * A submitted rhythm, or `null` if any field is not a whole number inside its
 * own bounds. Null rather than a clamp on purpose: the caller refuses the whole
 * save and says so, so a forged form can never quietly write a day that the
 * table's CHECK constraints would have rejected anyway.
 */
export function parseDockDayRhythm(values: Partial<Record<keyof DockDayRhythm, unknown>>) {
  const parsed = {} as DockDayRhythm;
  for (const field of DOCK_DAY_FIELDS) {
    const minutes = Number(values[field]);
    const { min, max } = DOCK_DAY_LIMITS[field];
    if (!Number.isInteger(minutes) || minutes < min || minutes > max) return null;
    parsed[field] = minutes;
  }
  return parsed;
}

/** One beat and where it falls relative to departure; negative is before it. */
export type DockDayOffset = { step: DockDayStep; number?: number; minutesFromDeparture: number };

/**
 * The whole day as offsets from departure, with no departure to hang it on.
 *
 * This is the single description of the shape — `dockDayTimeline` maps it onto
 * one departure's clock, and Settings renders it as-is beside the fields that
 * produce it, so a shop reading "Briefing · 15 min before" is reading the same
 * arithmetic their divers will. `return` is deliberately absent: a trip's own
 * return time is a published promise, not something these numbers get a vote in.
 *
 * Beats before departure are clamped to the arrival call. That invariant is
 * older than this function and worth keeping: a briefing that starts before the
 * diver was asked to be there is a briefing they were set up to miss.
 */
/**
 * How long each dive of a departure spends in the water, dive 1 first — a
 * site's own `expectedBottomTimeMinutes` where it has one, and a null (or a
 * short list, or none at all) meaning "the shop's number is right for this
 * dive".
 *
 * The override belongs per *dive* rather than per departure because a two-tank
 * morning routinely visits two sites: a wall the shop runs at 30 minutes and a
 * shallow reef it runs at 60. One number told the diver the wrong time on
 * whichever of the two it wasn't.
 */
export type SiteBottomTimes = readonly (number | null | undefined)[];

/** Dive `number`'s own minutes, or the shop's when this site names none. */
function bottomTimeForDive(
  rhythm: DockDayRhythm,
  siteBottomTimes: SiteBottomTimes | undefined,
  number: number,
): number {
  const override = siteBottomTimes?.[number - 1];
  return typeof override === "number" && override > 0 ? override : rhythm.bottomTimeMinutes;
}

export function dockDayOffsets(
  rhythm: DockDayRhythm,
  plannedDives = 2,
  siteBottomTimes?: SiteBottomTimes,
): DockDayOffset[] {
  const beforeDeparture: DockDayOffset[] = [
    { step: "arrive", minutesFromDeparture: -rhythm.dockCallMinutes },
  ];
  for (const [step, minutes] of [
    ["gearSetup", rhythm.gearSetupMinutes],
    ["briefing", rhythm.briefingMinutes],
  ] as const) {
    if (minutes > 0) {
      beforeDeparture.push({
        step,
        minutesFromDeparture: -Math.min(minutes, rhythm.dockCallMinutes),
      });
    }
  }
  // Stable, so a beat clamped onto the arrival call still reads after "Arrive".
  beforeDeparture.sort((a, b) => a.minutesFromDeparture - b.minutesFromDeparture);

  const afterDeparture: DockDayOffset[] = [];
  let cursor = 0;
  if (rhythm.boatRideMinutes > 0) {
    afterDeparture.push({ step: "boatRide", minutesFromDeparture: 0 });
    cursor += rhythm.boatRideMinutes;
  }
  const dives = Math.max(1, Math.trunc(plannedDives));
  for (let number = 1; number <= dives; number++) {
    if (number > 1 && rhythm.surfaceIntervalMinutes > 0) {
      afterDeparture.push({
        step: "surfaceInterval",
        number: number - 1,
        minutesFromDeparture: cursor,
      });
      cursor += rhythm.surfaceIntervalMinutes;
    }
    afterDeparture.push({ step: "dive", number, minutesFromDeparture: cursor });
    cursor += bottomTimeForDive(rhythm, siteBottomTimes, number);
  }

  return [...beforeDeparture, { step: "departure", minutesFromDeparture: 0 }, ...afterDeparture];
}

/** The beats that happen once the lines are off — the half a return time bounds. */
const ON_THE_WATER = new Set<DockDayStep>(["boatRide", "dive", "surfaceInterval"]);

/**
 * One departure's day on the clock: the shop's rhythm laid over this trip's own
 * `startsAt`, `endsAt` and dive count.
 *
 * The published return time wins over the shop's minutes. A shop whose stated
 * dives don't fit the window they sold has a scheduling problem, and answering
 * it by printing "Dive 3 · 5:40 PM" under a trip that returns at 5:00 PM would
 * make the page argue with itself in front of the diver.
 *
 * The day is **truncated** at the first beat that doesn't fit, not filtered
 * beat by beat. The water half is a chain — ride, dive, surface, dive — so
 * dropping only the members that overrun leaves the ones before them dangling:
 * a surface interval at 4:35 with no second dive after it reads as a boat that
 * surfaced and gave up. Cutting the chain at the point it stops fitting says
 * the true thing, which is that the published return is where the day ends.
 *
 * Without an `endsAt` there is nothing to bound the water half at all, so only
 * the dock beats render.
 */
export function dockDayTimeline(
  startsAt: Date,
  rhythm: DockDayRhythm,
  endsAt?: Date,
  plannedDives = 2,
  siteBottomTimes?: SiteBottomTimes,
): Array<{ step: DockDayStep; number?: number; at: Date }> {
  const beats: Array<{ step: DockDayStep; number?: number; at: Date }> = [];
  for (const offset of dockDayOffsets(rhythm, plannedDives, siteBottomTimes)) {
    // By step, never by "offset > 0" — a shore-entry shop's Dive 1 sits at
    // offset zero alongside the departure itself, and it is still a beat on the
    // water that only a stated return time can bound.
    const onTheWater = ON_THE_WATER.has(offset.step);
    if (onTheWater && !endsAt) continue;
    const at = new Date(startsAt.getTime() + offset.minutesFromDeparture * 60_000);
    if (onTheWater && endsAt && at >= endsAt) break;
    beats.push({ step: offset.step, number: offset.number, at });
  }
  // A ride out and a surface interval are both *between* things: each one only
  // means something because of the dive that follows it. Truncating the chain
  // can leave one at the end with nothing on the other side — "Surface interval
  // · 4:35 PM, Expected return · 5:00 PM" reads as a boat that surfaced and
  // gave up — so the tail is walked back to the last beat that stands alone.
  while (
    beats.length > 0 &&
    (beats.at(-1)?.step === "surfaceInterval" || beats.at(-1)?.step === "boatRide")
  ) {
    beats.pop();
  }
  if (endsAt) beats.push({ step: "return", at: endsAt });
  return beats;
}

export type SitePlanningFacts = {
  /** A `dive_site_difficulty` code, or null when the shop has not said. */
  difficultyLevel: DiveSiteDifficulty | null;
  depthRange: string | null;
  currentNote: string | null;
  /**
   * The shop's own answer, when it has given one. Null means "read it off the
   * facts below", which is what every site said before a shop could choose.
   */
  fitTone?: SiteFitTone | null;
};

/** Which of the three fit readings a site's published facts support. */
export type SiteFitTone = "demanding" | "welcoming" | "unknown";

/**
 * How demanding a site reads from what the shop published about it. Returns the
 * *tone*, not prose, for the same reason `dockDayTimeline` returns steps: the
 * component looks up `trip.siteFit<Tone>Label`/`Detail` in the reader's own
 * language.
 *
 * A shop that has chosen a tone wins outright. The keyword sniff below is a
 * *guess* at what free text a shop wrote for another purpose implies — good
 * enough to be worth having as the default, and wrong often enough that a shop
 * needs a way to say so: a gentle reef whose current note mentioned a "deep
 * channel" told divers to bring recent experience, and no field on the site
 * could take that back.
 */
export function siteFit(facts: SitePlanningFacts): { tone: SiteFitTone } {
  if (facts.fitTone) return { tone: facts.fitTone };
  // A difficulty the shop actually chose is evidence, not a guess, so it is
  // read before the keyword sniff rather than thrown into it. It used to be
  // free text and went into the same regex soup as the depth range and the
  // current note; now that it is one of three codes, "the shop said advanced"
  // and "the shop's current note happens to contain the word deep" are no
  // longer the same quality of signal and are no longer treated alike.
  if (facts.difficultyLevel === "advanced") return { tone: "demanding" };
  if (facts.difficultyLevel === "beginner") return { tone: "welcoming" };
  const evidence = [facts.depthRange, facts.currentNote]
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
 * What most divers are comfortable wearing at a given water temperature.
 *
 * A water temperature on a booking page is a number a diver has to translate
 * before it means anything, and the translation is the only reason they were
 * reading it: 24°C answers no question, "most divers want a 5 mm full suit"
 * answers the one they have. Suit thickness is the rare diving figure that
 * needs no unit decision — neoprene is sold in millimetres in every market,
 * including the ones that read feet and Fahrenheit — so this stays true
 * whatever the shop's `depth_unit` and `temperature_unit` say.
 *
 * The bands are the ordinary recreational rule of thumb, not an agency
 * standard, and they are **advisory**: thermal comfort varies enormously by
 * person, dive time, and how many dives are behind you that day, and the crew's
 * own conditions note is what a diver should believe over this. The words say
 * "most divers" for that reason, and the shop's rental list is what actually
 * turns up on the boat.
 *
 * A code, never a sentence (AGENTS.md — src/lib returns codes, the UI picks the
 * words). Thresholds are in stored Celsius, so a shop reading Fahrenheit gets
 * the same band as its neighbour reading Celsius rather than one shifted by a
 * rounding step.
 */
export type ExposureSuit = "swimwear" | "shorty" | "wetsuit5mm" | "wetsuit7mm" | "drysuit";

/**
 * Lower bound (inclusive, °C) of each band, warmest first. Read in order, so
 * the first threshold a reading clears wins and anything below the last one
 * falls through to `drysuit`.
 *
 * 29 / 25 / 21 / 17 rather than round Fahrenheit numbers because Celsius is
 * what is stored; in Fahrenheit they land at roughly 84 / 77 / 70 / 63, which
 * is the same rule of thumb a US shop would recognise.
 */
const EXPOSURE_SUIT_BANDS: ReadonlyArray<readonly [number, ExposureSuit]> = [
  [29, "swimwear"],
  [25, "shorty"],
  [21, "wetsuit5mm"],
  [17, "wetsuit7mm"],
];

export function exposureSuitFor(celsius: number): ExposureSuit {
  return EXPOSURE_SUIT_BANDS.find(([floor]) => celsius >= floor)?.[1] ?? "drysuit";
}

export function packingConfidence(
  shopItems: string[],
  rental: null | Record<string, boolean | string | null>,
  /**
   * Whether the shop runs a briefing at all (`briefingMinutes > 0`). "Crew
   * briefing" used to be an unconditional entry under *Provided*, which put the
   * page in the position of promising one three inches under a rhythm that no
   * longer had a briefing in it.
   */
  briefs = true,
): {
  bring: string[];
  rented: RentableItemKind[];
  provided: ProvidedItemCode[];
} {
  const rented = rental
    ? RENTAL_FIELD_KINDS.filter(([field]) => rental[field] === true).map(([, kind]) => kind)
    : [];
  return {
    bring: shopItems,
    rented,
    provided: briefs ? ["tanksAndWeights", "crewBriefing"] : ["tanksAndWeights"],
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
