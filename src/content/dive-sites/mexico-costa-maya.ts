// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Costa Maya and Banco Chinchorro. */
export const MEXICO_COSTA_MAYA: DiveSiteTemplate[] = [
  // Denominator row: Escalones (Los Escalones)
  {
    slug: "escalones",
    version: 1,
    area: "mexico-costa-maya",
    sources: [
      "https://pepedivemahahual.com/en/diving/mahahual/",
      "https://takataexperience.com/dive-sites-mahahual/",
      "https://amigosdelmar.net/dive-mahahual-reef/",
    ],
    briefing: {
      name: "Escalones",
      locationName: "Mahahual, Quintana Roo",
      // Approximate pin: the reef wall in front of the Mahahual lighthouse (Amigos del Mar),
      // under five minutes by boat from the town (Amigos del Mar), placed about 500 m off the
      // lighthouse's OpenStreetMap position (18.7244, -87.7014). No source publishes coordinates.
      forecastLatitude: 18.7244,
      forecastLongitude: -87.6965,
      description:
        "A wall dive off the Mahahual lighthouse: reef walls and sandbanks cut by canyons, with natural steps down the reef.",
      marineLife: "Green turtles · eagle rays · schoolmaster snappers · green morays",
      marineLifeDescription:
        "Turtles and eagle rays pass over the sand between terraces. Look into the canyon walls for big groupers and green morays.",
      difficultyLevel: "intermediate",
      depthRange: "12–23 m (40–75 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Cruise ships call at Mahahual: do not dive while a ship is alongside, listen for engines on the way up and carry an SMB. Usually light; it can change, so carry an SMB.",
      divePlan:
        "Down the line to the first terrace, then step along the wall and canyons, turning the dive at half your gas. The plan stays above 23 m (75 ft).",
      fitTone: "unknown",
      fitNote:
        "Clear water, with a current that is usually light but can change. The deepest steps reach 23 m, so it suits a diver with Advanced Open Water depth experience.",
      // Operators' figures run 12–18 m (Takata) and 14–23 m (Pepe Dive); the deeper is taken.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Mahahual lighthouse",
          kind: "navigationMark",
          note: "The reef wall lies in front of it, a short boat ride from the shop.",
        },
      ],
      creatureSlugs: [
        "green-sea-turtle",
        "spotted-eagle-ray",
        "schoolmaster-snapper",
        "green-moray",
        "great-barracuda",
        "black-grouper",
      ],
    },
  },
  // Denominator row: Chinchorrito
  {
    slug: "chinchorrito",
    version: 1,
    area: "mexico-costa-maya",
    sources: [
      "https://amigosdelmar.net/dive-mahahual-reef/",
      "https://www.divessi.com/ko/divecenter/mar-adentro-diving-mahahual-qr-quintana-roo-mexico-mxico-809927",
      "https://pepedivemahahual.com/en/diving/mahahual/",
    ],
    briefing: {
      name: "Chinchorrito",
      locationName: "Mahahual, Quintana Roo",
      // Approximate pin: Chinchorrito is the northernmost dive from Mahahual village (Pepe Dive
      // Mahahual). The point is about 4 km north-east of the lighthouse (18.7244, -87.7014), in the
      // water off the coast. No source publishes coordinates, a distance or a bearing, so distance
      // and direction are assumptions. Good to about 2 km.
      forecastLatitude: 18.7485,
      forecastLongitude: -87.673,
      description:
        'A "little Chinchorro": huge sandbanks dotted with low reef hills, with barrel sponges, fans and soft and hard corals. A large coral formation rises from the deeper part.',
      marineLife: "Green turtles · eagle rays · spotted morays · garden eels",
      marineLifeDescription:
        "Turtles graze on the sand flats, rays pass over the sandbanks and garden eels sway in the open areas. Morays sit in the coral.",
      difficultyLevel: "advanced",
      depthRange: "15–24 m (50–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Cruise ships call at Mahahual: do not dive while a ship is alongside, listen for engines on the way up and carry an SMB. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down to the coral formation, then along the reef hills and sandbanks, no deeper than 24 m (80 ft).",
      fitTone: "demanding",
      fitNote: "Operators rate it for advanced divers. The reef begins near 15 m.",
      // Amigos del Mar calls it better suited to advanced divers; the reef starts at about
      // 15 m (Mar Adentro) or can be held at 18 m (Amigos del Mar), so the gate is Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "spotted-eagle-ray",
        "southern-stingray",
        "spotted-moray",
        "garden-eel",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: La Poza (La Posa, Fosa de los Sábalos)
  {
    slug: "la-poza-xcalak",
    version: 1,
    area: "mexico-costa-maya",
    sources: [
      "https://divingxcalak.com/en_US/dive-sites/",
      "https://web.archive.org/web/2026/https://xtcdivecenter.com/recreational-diving/",
      "https://www.divessi.com/ko/divecenter/mar-adentro-diving-mahahual-qr-quintana-roo-mexico-mxico-809927",
      "https://takataexperience.com/dive-sites-mahahual/",
    ],
    briefing: {
      name: "La Poza",
      locationName: "Xcalak Reef National Park, Quintana Roo",
      // Approximate pin: the trench lies just inside Xcalak's protected reef, a short boat trip from
      // the town's dock (XTC Dive Center, Stingy Nomads), placed on the reef about 1.5 km east of
      // Xcalak (18.2704, -87.8360). No source publishes coordinates.
      forecastLatitude: 18.274,
      forecastLongitude: -87.8185,
      description:
        "A half-mile trench running parallel to the shore, with a coral wall on one side and a sandy slope on the other. Tarpon shelter along the wall, and the dive can end at the Copa del Mundo pinnacle.",
      marineLife: "Tarpon · horse-eye jacks · snappers · rays",
      marineLifeDescription:
        "Schools of large tarpon hold along the coral wall, with jacks, snappers and rays beside them.",
      difficultyLevel: "advanced",
      depthRange: "5–26 m (15–85 ft)",
      maxDepthMeters: 26,
      currentNote:
        "Strong current and nutrient-rich water. Depending on the day it is a relaxed reef dive or a drift, so carry an SMB.",
      divePlan:
        "Through the gap in the reef and down into the trench, along the wall with the tarpon, and up to the Copa del Mundo pinnacle for the safety stop if the current allows. If the current does not allow the pinnacle, make the stop on an SMB in open water. The plan stays above 26 m (85 ft). Any enclosed passage is an overhead; stay out.",
      fitTone: "demanding",
      fitNote:
        "A drift in a trench with current. For divers comfortable with a surface marker and a guide.",
      // Operators' maxima run 22–26 m; the deeper is taken.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Copa del Mundo",
          kind: "reefFormation",
          note: "A pinnacle that rises to about 5 m below the surface, where divers make their safety stop.",
        },
      ],
      creatureSlugs: [
        "tarpon",
        "horse-eye-jack",
        "gray-snapper",
        "spotted-eagle-ray",
        "southern-stingray",
      ],
    },
  },
  // Denominator row: Doña Nica
  {
    slug: "dona-nica",
    version: 1,
    area: "mexico-costa-maya",
    sources: [
      "https://divingxcalak.com/en_US/dive-sites/",
      "https://web.archive.org/web/2026/https://xtcdivecenter.com/recreational-diving/",
    ],
    briefing: {
      name: "Doña Nica",
      locationName: "Xcalak Reef National Park, Quintana Roo",
      // Approximate pin: a site in Xcalak's reef park reached by short boat ride from the town
      // (XTC Dive Center); placed on the reef about 1.4 km south-east of Xcalak (18.2704, -87.8360).
      // No source gives a closer position or coordinates.
      forecastLatitude: 18.265,
      forecastLongitude: -87.819,
      description:
        "Two coral areas facing sand flats: a shallow wall, then, across the sand, tongue-and-groove coral, pinnacles and ledges where big groupers and snappers shelter.",
      marineLife: "Spiny lobsters · octopus · groupers · green turtles",
      marineLifeDescription:
        "Lobsters and octopus tuck into the coral. Groupers and snappers use the ledges in the deeper section.",
      difficultyLevel: "intermediate",
      depthRange: "9–24 m (30–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Current not documented; it can change, so carry an SMB and ask the crew on the day.",
      divePlan:
        "Start on the shallow wall over soft sand, cross the flats toward the deeper coral if the group is comfortable, and stay above 24 m (80 ft). The overhanging ledges are overheads; stay out.",
      fitTone: "unknown",
      fitNote:
        "The shallow wall sits at 9–15 m. The deeper section across the sand reaches 24 m, so the dive is held to Advanced Open Water.",
      // The shallow wall (9–15 m, Diving Xcalak) is an Open Water dive in itself, but the second
      // area runs to 80 ft (24 m, XTC), so the template gates at Advanced Open Water; a shop that
      // dives only the wall can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spiny-lobster",
        "caribbean-reef-octopus",
        "black-grouper",
        "schoolmaster-snapper",
        "green-sea-turtle",
      ],
    },
  },
];
