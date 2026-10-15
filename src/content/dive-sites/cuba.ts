// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Cuba. */
export const CUBA: DiveSiteTemplate[] = [
  // Denominator row: Coral Beach (Playa Coral)
  {
    slug: "coral-beach-varadero",
    version: 1,
    area: "cuba",
    sources: [
      "https://www.scubaatlantisvaradero.com/diving",
      "https://www.varadiving.club/scuba-diving/varadero-cuba/",
      "https://www.wannadive.net/spot/Central_America/Cuba/Varadero/Playa_El_Coral/index.html",
    ],
    briefing: {
      name: "Coral Beach",
      locationName: "Playa Coral, Matanzas",
      // Approximate pin: wannadive lists 23.0880, -81.4497 and OpenStreetMap puts Playa Coral at
      // 23.0887, -81.4547, 0.5 km apart. wannadive's point falls on the shore, so the pin sits 100 m
      // seaward on the reef off the beach, between the entry and the wall 150 m out.
      // Depth: Atlantis Varadero gives 8-15 m, Varadiving 12 m, wannadive 8 m average and 15 m maximum.
      forecastLatitude: 23.0891,
      forecastLongitude: -81.4497,
      description:
        "A shore dive from a beach about 30 minutes west of Varadero, over a long reef that runs for kilometers along the coast. The entry is shallow and the reef begins within a short swim, with a low wall about 150 m out.",
      marineLife: "Reef fish · corals",
      marineLifeDescription:
        "More than a hundred species of fish and coral are reported along this reef.",
      difficultyLevel: "beginner",
      depthRange: "8–15 m (26–49 ft)",
      maxDepthMeters: 15,
      currentNote:
        "Current is reported as low, under 1 knot. The entry is over a rocky beach, so step carefully, check the surf from the beach before you enter, and ask the crew about the day’s entry and exit.",
      divePlan:
        "Enter from the beach, swim out over the shallow reef to the wall about 150 m off the coast, and work along it at 8 to 15 m. Return the same way with reserve gas and exit at the same point you entered.",
      fitTone: "welcoming",
      fitNote:
        "A shallow shore dive with good visibility, run for students and certified divers alike.",
      landmarks: [
        {
          name: "The wall",
          kind: "reefFormation",
          note: "A low wall about 150 m off the coast, dropping from 5 to 15 m.",
        },
      ],
      creatureSlugs: ["french-angelfish", "queen-angelfish", "common-sea-fan", "great-star-coral"],
    },
  },
  // Denominator row: Bay of Pigs wall (Playa Larga, Playa Girón shore dives)
  {
    slug: "bay-of-pigs-wall",
    version: 1,
    area: "cuba",
    sources: [
      "https://www.scubaatlantisvaradero.com/diving",
      "https://www.varadiving.club/scuba-diving/varadero-cuba/",
      "https://www.wannadive.net/spot/Central_America/Cuba/Playa_Giron___Larga/Baie_des_cochons/index.html",
    ],
    briefing: {
      name: "Bay of Pigs Wall",
      locationName: "Playa Larga, Bay of Pigs",
      // Approximate pin: wannadive's Bay of Pigs point (22.2798, -81.1988) and OpenStreetMap's
      // Playa Larga (22.2803, -81.1999), 130 m apart; a shore dive, so the point is the entry.
      // Depth: Atlantis Varadero gives 5-30 m, Varadiving 30 m maximum; wannadive's 40 m maximum
      // is past the plan. The drop-off continues past the plan; the plan holds a 30 m floor and
      // wannadive reports a medium current (1 to 2 knots), which gates the site at Advanced Open Water.
      forecastLatitude: 22.2798,
      forecastLongitude: -81.1988,
      description:
        "A shore dive on the Bay of Pigs where a coral reef runs out to a drop-off. You choose the depth from the shore, between about 5 and 30 m. The drop-off continues far past the plan.",
      marineLife: "Coral reef · reef fish",
      marineLifeDescription:
        "A coral reef and a drop-off within one entry. The wildlife is not documented in detail; ask the crew what has been showing.",
      difficultyLevel: "advanced",
      depthRange: "5–30 m (16–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current is reported as medium, 1 to 2 knots. Carry an SMB. Do not enter if you cannot make headway against the current at the surface; with more than a gentle current, dive it from a boat. Entry surface not documented; ask the crew about the entry and plan the exit before you enter.",
      divePlan:
        "Enter from the shore, cross the reef to the wall, and follow it; the plan stops at 30 m. The drop-off keeps going past the plan. Return along the reef with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "A shore entry, a current and a wall. The trip is a two-hour drive from Varadero, so the day is long, and medical care is far from the entry; confirm the crew’s oxygen and plan.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The drop-off",
          kind: "reefFormation",
          note: "The edge of the reef where the shelf falls away, past the plan’s floor.",
        },
      ],
      creatureSlugs: ["queen-angelfish", "french-angelfish", "common-sea-fan", "great-star-coral"],
    },
  },
];
