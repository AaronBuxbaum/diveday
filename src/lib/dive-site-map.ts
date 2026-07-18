export type DiveSiteMap = {
  query: string;
  routeLabel: string;
  routeDescription: string;
  stops: readonly string[];
  path: string;
  start: { x: number; y: number };
  finish: { x: number; y: number };
};

const seedDiveSiteMaps: Record<string, DiveSiteMap> = {
  "Molasses Reef": {
    query: "Molasses Reef, Key Largo, Florida",
    routeLabel: "Reef garden loop",
    routeDescription:
      "A relaxed sweep from the mooring along the coral ridge and back by the sand channels.",
    stops: ["Mooring", "Coral ridge", "Sand channel"],
    path: "M 16 67 C 25 48, 31 32, 44 29 S 66 38, 72 52 S 67 73, 84 78",
    start: { x: 16, y: 67 },
    finish: { x: 84, y: 78 },
  },
  "Spiegel Grove": {
    query: "Spiegel Grove wreck, Key Largo, Florida",
    routeLabel: "Exterior circuit",
    routeDescription:
      "A gentle exterior circuit: descend together, trace the superstructure, then return to the ascent line.",
    stops: ["Descent line", "Superstructure", "Ascent"],
    path: "M 18 63 C 28 45, 38 34, 49 35 S 71 45, 75 60 S 69 75, 84 78",
    start: { x: 18, y: 63 },
    finish: { x: 84, y: 78 },
  },
  "Christ of the Abyss": {
    query: "Christ of the Abyss, Key Largo, Florida",
    routeLabel: "Shallow statue arc",
    routeDescription:
      "An easy, shallow arc around the statue and coral garden before a calm return to the mooring.",
    stops: ["Mooring", "The statue", "Coral garden"],
    path: "M 17 68 C 27 52, 34 38, 49 36 S 68 43, 72 56 S 69 74, 84 79",
    start: { x: 17, y: 68 },
    finish: { x: 84, y: 79 },
  },
};

export function getSeedDiveSiteMap(siteName: string): DiveSiteMap | null {
  return seedDiveSiteMaps[siteName] ?? null;
}

export function googleSatelliteEmbedUrl(query: string): string {
  return `https://maps.google.com/maps?hl=en&q=${encodeURIComponent(query)}&t=k&z=15&output=embed`;
}

export function googleMapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
