// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Anguilla. */
export const ANGUILLA: DiveSiteTemplate[] = [
  {
    slug: "prickly-pear-cays-anguilla",
    version: 1,
    area: "anguilla",
    sources: [
      "https://www.anguilla-vacation.com/activities/diving-snorkeling/",
      "https://web.archive.org/web/2007/http://www.anguilla-diving.com/parks/pricpear.htm",
      "https://openseascharters.com/scuba-diving",
    ],
    briefing: {
      name: "Prickly Pear Cays",
      locationName: "Prickly Pear Cays, Anguilla",
      // Approximate pin: the Prickly Pear Cays (OpenStreetMap's position for the cays; the park page puts the diving on the south side); placed about 250 m south of the cays, in the water. Good to about 2 km, and no other defined site lies within 200 m.
      forecastLatitude: 18.259,
      forecastLongitude: -63.18,
      description:
        "An underwater canyon off the offshore cays, with ledges along it. Two cays sit apart across a narrow inlet, and the good diving is on the south side in calm weather. The caverns are overhead; stay out.",
      marineLife: "Nurse sharks · reef fish · coral",
      marineLifeDescription:
        "Nurse sharks are seen along the ledges, with a good variety of small reef fish around them. Watch them from a distance; do not chase or touch.",
      conservationNote:
        "Anguilla’s marine parks and mooring permits protect its dive sites. Use the moorings, never an anchor on the reef.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 21 m (70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "An offshore cay dived in calm weather on the south side; anchoring is not allowed on the north side. Current is not documented; carry an SMB and ask the crew on the day. The caverns are overhead; stay out.",
      divePlan:
        "Down the mooring and along the outside of the canyon on the south side, no deeper than 21 m, and back up the line with reserve gas. The caverns are overhead; stay out. Medical care is far; confirm the boat's oxygen and plan. Staff confirm the diver's log before boarding.",
      fitTone: "unknown",
      fitNote: "An offshore canyon that needs calm weather. Ask the crew about the day’s water.",
      // The ledges and caverns are overhead and not part of the plan, so the site carries no cavern gate.
      creatureSlugs: [
        "nurse-shark",
        "queen-angelfish",
        "french-angelfish",
        "blue-tang",
        "spiny-lobster",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "anguillita-anguilla",
    version: 1,
    area: "anguilla",
    sources: [
      "https://www.anguilla-vacation.com/activities/diving-snorkeling/",
      "https://ivisitanguilla.com/diving-in-anguilla/",
      "https://www.scubashackaxa.com/diving-and-snorkling-news/a-few-of-our-favorite-dive-sites-z96wz",
      "https://openseascharters.com/scuba-diving",
    ],
    briefing: {
      name: "Anguillita",
      locationName: "Anguillita Island, Anguilla",
      // Approximate pin: Anguillita Island, which the tourist board places off the west end of Anguilla (OpenStreetMap); placed about 150 m west of the islet, in the water. Good to about 2 km, and no other defined site lies within 200 m.
      forecastLatitude: 18.1565,
      forecastLongitude: -63.179,
      description:
        "A reef beside a tiny island off the west end of Anguilla. Three mini-walls with ledges run along it, and a reef begins near 12 m and slopes into deeper water. The small caves are overhead; stay out.",
      marineLife: "Southern stingrays · spotted morays · turtles · eagle rays",
      marineLifeDescription:
        "Stingrays, morays, lobsters and turtles use the ledges, with schools of jacks and barracuda along the wall and an occasional eagle ray.",
      conservationNote:
        "Anguilla’s marine parks and mooring permits protect its dive sites. Use the moorings, never an anchor on the reef.",
      difficultyLevel: "intermediate",
      depthRange: "5–30 m (15–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "An offshore islet in open water. Current is not documented; carry an SMB and ask the crew on the day. The small caves and tunnels are overhead; stay out.",
      divePlan:
        "Down the mooring to the mini-walls, along the outside of the reef no deeper than 30 m, and back up the line with reserve gas. The small caves and tunnels are overhead; stay out. Stop on the mooring line or an SMB in open water. Staff confirm the diver's log before boarding.",
      fitTone: "unknown",
      fitNote:
        "A reef and mini-wall off an offshore islet, with a floor of 30 m. Ask the crew about the day’s water.",
      // Gated at Advanced Open Water for the open-ocean islet exposure and undocumented current, the conservative reading; depth to 30 m alone would not gate it.
      minimumCertificationLevel: "advanced_open_water",
      // The tourist board lists 60 ft (18 m) and Scuba Shack 80 to 100 ft; the deeper figure is used. The caves are overhead and not part of the plan. Depth up to 30 m does not gate by itself.
      creatureSlugs: [
        "southern-stingray",
        "spotted-moray",
        "green-sea-turtle",
        "spotted-eagle-ray",
        "great-barracuda",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "little-bay-anguilla",
    version: 1,
    area: "anguilla",
    sources: [
      "https://www.anguilla-vacation.com/activities/diving-snorkeling/",
      "https://www.carimar.com/uploads/documents/SUMMER_DIVESTAY_PACKAGE_-_DIVESITES.pdf",
    ],
    briefing: {
      name: "Little Bay",
      locationName: "Little Bay, Anguilla",
      // Approximate pin: Little Bay, the cliff-backed cove near Crocus Bay (OpenStreetMap); placed at the bay's recorded point, in the water. Good to about 2 km, and no other defined site lies within 200 m.
      forecastLatitude: 18.2288,
      forecastLongitude: -63.0693,
      description:
        "A sheltered cove under cliffs. It works as a nursery for young fish, with plenty of lobsters and small animals, and is good for macro photography. Night dives need staff approval and a briefed plan.",
      marineLife: "Juvenile reef fish · lobsters · small animals",
      marineLifeDescription:
        "Young fish and lobsters crowd the shallows, and the quiet water suits macro photography.",
      conservationNote:
        "Anguilla’s marine parks and mooring permits protect its dive sites. Use the moorings, never an anchor on the reef.",
      difficultyLevel: "beginner",
      depthRange: "5–9 m (15–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Calm and protected from the winter storms. Surge is not documented; ask the crew on the day. No entry hazard is documented; enter as the crew briefs it.",
      fitTone: "welcoming",
      fitNote: "A calm, shallow cove no deeper than 9 m, well suited to a slow dive.",
      // The tourist board lists 30 ft (9 m) and Scuba Shack 20 ft; the deeper figure is used.
      creatureSlugs: [
        "spiny-lobster",
        "sergeant-major",
        "bluehead-wrasse",
        "french-grunt",
        "smooth-trunkfish",
        "spotted-goatfish",
      ],
    },
  },
  {
    slug: "sandy-deep-anguilla",
    version: 1,
    area: "anguilla",
    sources: [
      "https://www.anguilla-vacation.com/activities/diving-snorkeling/",
      "https://www.carimar.com/uploads/documents/SUMMER_DIVESTAY_PACKAGE_-_DIVESITES.pdf",
      "https://www.scubashackaxa.com/diving-and-snorkling-news/a-few-of-our-favorite-dive-sites-z96wz",
    ],
    briefing: {
      name: "Sandy Deep",
      locationName: "Sandy Island, Anguilla",
      // Approximate pin: Sandy Island, with the dive at the southern edge of the plateau around it (OpenStreetMap and Scuba Shack); placed about 250 m south of the island, in the water. Good to about 2 km, and no other defined site lies within 200 m.
      forecastLatitude: 18.2092,
      forecastLongitude: -63.1183,
      description:
        "A mini-wall on the southern edge of the horseshoe-shaped plateau around Sandy Island, dropping abruptly from about 5 m to 18 m. There are plenty of fish and lobsters, with soft coral and sea fans on the plateau.",
      marineLife: "Reef fish · lobsters · garden eels · sea fans",
      marineLifeDescription:
        "Fish and lobsters crowd the plateau edge, and the sand at its foot holds garden eels, turtles and the odd reef shark.",
      conservationNote:
        "Anguilla’s marine parks and mooring permits protect its dive sites. Use the moorings, never an anchor on the reef.",
      difficultyLevel: "intermediate",
      depthRange: "5–18 m (15–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Sandy Island is a popular day-trip and snorkeling spot, so listen for engines and come up the mooring line. Current is not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A shallow plateau and mini-wall at Anguilla’s best-known island.",
      creatureSlugs: [
        "spiny-lobster",
        "garden-eel",
        "green-sea-turtle",
        "queen-angelfish",
        "common-sea-fan",
        "blue-tang",
      ],
    },
  },
  {
    slug: "ida-maria-wreck-anguilla",
    version: 1,
    area: "anguilla",
    sources: [
      "https://www.anguilla-vacation.com/activities/diving-snorkeling/",
      "https://www.carimar.com/uploads/documents/SUMMER_DIVESTAY_PACKAGE_-_DIVESITES.pdf",
      "https://ivisitanguilla.com/diving-in-anguilla/",
      "https://web.archive.org/web/2024/https://theanguillian.com/2012/02/heritage-corner-by-lilian-azevedo-shipwrecks-and-artificial-reefs/",
    ],
    briefing: {
      name: "Ida Maria Wreck",
      locationName: "Sandy Island, Anguilla",
      // Approximate pin: Sandy Island, with the wreck on its northwest side per Scuba Shack and ivisitanguilla (OpenStreetMap; the Zentacle map spot lies about 2 km farther northwest); placed about 250 m northwest of the island, in the water. Good to about 2 km, and no other defined site lies within 200 m.
      forecastLatitude: 18.215,
      forecastLongitude: -63.121,
      description:
        "A 120 ft vessel that survived Hurricane Klaus afloat and was then dragged down on her anchor chains. Storms have since compacted her, the most of any of Anguilla’s wrecks, and hard and soft coral cover both the wreck and the reef beneath it. The dive is long at moderate depth.",
      marineLife: "Reef fish · hard coral · soft coral",
      marineLifeDescription:
        "Fish life is abundant, with the remains of a car near the bow, and the wreck is part of the reef.",
      conservationNote:
        "Anguilla’s marine parks and mooring permits protect its dive sites. Use the moorings, never an anchor on the reef. This is part of Anguilla’s underwater heritage: leave everything where it lies, and note that exporting antiquities is against the law.",
      difficultyLevel: "beginner",
      depthRange: "Up to 18 m (60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Sandy Island is a popular day-trip and snorkeling spot, so listen for engines and come up the mooring line. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the wreck, along the outside of the hull and the reef beside it, and back up the line. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "A shallow, broken wreck on a healthy reef.",
      landmarks: [
        {
          name: "The twisted bow",
          kind: "wreckFeature",
          note: "A storm twisted the bow onto its side. What is left of a car lies off to the right as you face the bow.",
        },
      ],
      creatureSlugs: [
        "queen-angelfish",
        "french-angelfish",
        "spiny-lobster",
        "yellowtail-snapper",
        "spotted-moray",
        "great-barracuda",
      ],
    },
  },
  {
    slug: "oosterdiep-wreck-anguilla",
    version: 1,
    area: "anguilla",
    sources: [
      "https://www.anguilla-vacation.com/activities/diving-snorkeling/",
      "https://www.carimar.com/uploads/documents/SUMMER_DIVESTAY_PACKAGE_-_DIVESITES.pdf",
      "https://www.scubashackaxa.com/diving-and-snorkling-news/a-few-of-our-favorite-dive-sites-z96wz",
      "https://web.archive.org/web/2025/https://www.scubadiving.com/destination-scuba-diving-anguilla",
      "https://www.justgottadive.com/dive_resources/travel_articles/underwater-history-lesson-wreck-dives-anguilla",
    ],
    briefing: {
      name: "Oosterdiep Wreck",
      locationName: "Meads Bay, Anguilla",
      // Approximate pin: ScubaDiving and Just Gotta Dive both put the wreck northwest of Meads Bay. The bay's recorded point is 18.1834, -63.1395 (OpenStreetMap), so the pin sits about 1.7 km north-northwest of it in open water, where a user-placed map spot also lies. Good to about 2 km, and no other defined site lies within 200 m.
      forecastLatitude: 18.1984,
      forecastLongitude: -63.1407,
      description:
        "A Dutch cargo ship sunk upright in 1990 and still well preserved, lying close to a soft coral reef. The skeleton of a Volkswagen sits near the stern, and stingrays, garden eels and turtles share the sand around it. Night dives need staff approval and a briefed plan.",
      marineLife: "Southern stingrays · garden eels · green turtles · barracuda",
      marineLifeDescription:
        "Stingrays, turtles, lobsters, morays, barracuda and bar jacks are commonly seen, with reef sharks and eagle rays sometimes.",
      conservationNote:
        "Anguilla’s marine parks and mooring permits protect its dive sites. Use the moorings, never an anchor on the reef. This is part of Anguilla’s underwater heritage: leave everything where it lies, and note that exporting antiquities is against the law.",
      difficultyLevel: "intermediate",
      depthRange: "15–27 m (50–90 ft)",
      maxDepthMeters: 27,
      currentNote: "Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the wreck, along the outside of the hull to the stern, and back up the line with reserve gas. Stay outside the hull.",
      fitTone: "unknown",
      fitNote: "An upright wreck in moderate depth. Ask the crew about the day’s water.",
      // The tourist board and the Carimar dive list give 80 ft, Scuba Shack's blog gives 90 ft and Just Gotta Dive gives 75 ft; the deepest figure is used. Depth between 19 and 30 m does not gate by itself.
      landmarks: [
        {
          name: "The Volkswagen",
          kind: "wreckFeature",
          note: "The skeleton of a Volkswagen lies near the stern.",
        },
      ],
      creatureSlugs: [
        "southern-stingray",
        "garden-eel",
        "green-sea-turtle",
        "great-barracuda",
        "green-moray",
        "yellowtail-snapper",
      ],
    },
  },
];
