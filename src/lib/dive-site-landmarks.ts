export type DiveSiteLandmark = {
  name: string;
  kind: string;
  description: string;
};

const landmarkDetails: Record<string, Record<string, Omit<DiveSiteLandmark, "name">>> = {
  "Molasses Reef": {
    "Molasses Reef Light": {
      kind: "Navigation mark",
      description:
        "The reef light is the easiest above-water reference and a useful way to stay oriented around the central reef.",
    },
    "Historic ship's winch": {
      kind: "Reef history",
      description:
        "A large ship's winch rests near the reef light—a compact piece of maritime history now folded into the reef.",
    },
    "Spanish anchor": {
      kind: "Reef history",
      description:
        "An old anchor lies among the coral formations. Let the crew point it out; it can disappear surprisingly well into the reef.",
    },
  },
  "Spiegel Grove": {
    "Flight deck and cranes": {
      kind: "Wreck feature",
      description:
        "The broad flight deck and paired cranes make the ship's scale click into place. Stay outside the structure and follow the guide's line.",
    },
    "Well deck": {
      kind: "Wreck feature",
      description:
        "The open well deck is one of the wreck's most dramatic exterior spaces, with changing light and room for big schools of fish.",
    },
  },
  "Christ of the Abyss": {
    "Christ of the Abyss": {
      kind: "Underwater monument",
      description:
        "The 8.6-foot bronze statue stands on a concrete pedestal in shallow water—the unmistakable centrepiece of this dive.",
    },
    "Dry Rocks sand channels": {
      kind: "Reef formation",
      description:
        "Bright sand channels weave between coral formations around the statue and are good places to look for rays, grouper, and moray eels.",
    },
  },
};

export function buildDiveSiteLandmarks(
  siteName: string,
  names: readonly string[],
): DiveSiteLandmark[] {
  const details = landmarkDetails[siteName] ?? {};
  return names.map((name) => ({
    name,
    kind: details[name]?.kind ?? "Point of interest",
    description:
      details[name]?.description ??
      "A memorable reference point the crew can identify during the site briefing.",
  }));
}
