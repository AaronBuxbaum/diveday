/**
 * The categorical "type" of a named landmark — a code, not a rendered word.
 * `pointOfInterest` is the fallback for a staff-authored landmark with no
 * seeded editorial copy.
 */
export type DiveSiteLandmarkKind =
  | "navigationMark"
  | "reefHistory"
  | "wreckFeature"
  | "underwaterMonument"
  | "reefFormation"
  | "pointOfInterest";

/**
 * Which specific landmark's editorial description to show, or `generic` for
 * a staff-authored landmark this module has no copy for. Each seeded value
 * names exactly one (site, landmark) pair — see `landmarkDetails` below.
 */
export type DiveSiteLandmarkDescription =
  | "molassesReefLight"
  | "shipsWinch"
  | "spanishAnchor"
  | "flightDeckAndCranes"
  | "wellDeck"
  | "christOfAbyssStatue"
  | "dryRocksSandChannels"
  | "generic";

export type DiveSiteLandmark = {
  name: string;
  kind: DiveSiteLandmarkKind;
  description: DiveSiteLandmarkDescription;
};

const landmarkDetails: Record<string, Record<string, Omit<DiveSiteLandmark, "name">>> = {
  "Molasses Reef": {
    "Molasses Reef Light": { kind: "navigationMark", description: "molassesReefLight" },
    "Historic ship's winch": { kind: "reefHistory", description: "shipsWinch" },
    "Spanish anchor": { kind: "reefHistory", description: "spanishAnchor" },
  },
  "Spiegel Grove": {
    "Flight deck and cranes": { kind: "wreckFeature", description: "flightDeckAndCranes" },
    "Well deck": { kind: "wreckFeature", description: "wellDeck" },
  },
  "Christ of the Abyss": {
    "Christ of the Abyss": { kind: "underwaterMonument", description: "christOfAbyssStatue" },
    "Dry Rocks sand channels": { kind: "reefFormation", description: "dryRocksSandChannels" },
  },
};

export function buildDiveSiteLandmarks(
  siteName: string,
  names: readonly string[],
): DiveSiteLandmark[] {
  const details = landmarkDetails[siteName] ?? {};
  return names.map((name) => ({
    name,
    kind: details[name]?.kind ?? "pointOfInterest",
    description: details[name]?.description ?? "generic",
  }));
}
