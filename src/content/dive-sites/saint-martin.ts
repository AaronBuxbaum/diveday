// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Saint-Martin. */
export const SAINT_MARTIN: DiveSiteTemplate[] = [
  {
    slug: "rocher-creole-saint-martin",
    version: 1,
    area: "saint-martin",
    sources: [
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
      "https://reservenaturelle-saint-martin.com/sites/default/files/fiches-pdf/site-rocher-creole.pdf",
      "https://www.dm.guadeloupe.developpement-durable.gouv.fr/IMG/pdf/etude_d_impact_-_projet_bouees_recorea_saint-martin_agrnsm.pdf",
      "https://web.archive.org/web/2024/http://www.thescubashop.net/OldWebsite/thesites.htm",
      "https://www.aircaraibes.com/destinations/saint-martin/top-spots-plongee",
    ],
    briefing: {
      name: "Creole Rock",
      locationName: "Grand Case Bay, Saint-Martin",
      // Position: the nature reserve's dive layer; the reserve's own mooring study puts the Creole Rock moorings within about 100 m of it. Depth: the reserve's 2025 survey of its moorings (3.5 to 6 m) and The Scuba Shop's old site (1 to 6 m).
      forecastLatitude: 18.1174,
      forecastLongitude: -63.0564,
      description:
        "A rocky islet at the entrance to Grand Case Bay and one of the reserve’s best-loved sites. The water is shallow, accessible and well protected, which makes it a first-dive and snorkeling site, with cracks in the rock that shelter lobsters and tropical fish.",
      marineLife: "Tropical reef fish · spiny lobsters · coral",
      marineLifeDescription:
        "Reef fish and lobsters crowd the rocky faults and cracks. The rock itself is a nesting site for brown boobies and tropicbirds.",
      conservationNote:
        "Creole Rock lies inside the Saint-Martin nature reserve. Boats use the reserve’s moorings only, with white buoys marked for diving clubs. Landing on the islet or the beach and climbing the rock are forbidden, because seabirds nest on it, and so is any motorized underwater device within 30 m of the beach.",
      difficultyLevel: "beginner",
      depthRange: "1–6 m (4–20 ft)",
      maxDepthMeters: 6,
      currentNote:
        "Shallow and protected. Boats gather on the reserve’s moorings around the rock, so listen for engines and come up the mooring line. Current is not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A shallow, sheltered site made for first dives, refreshers and snorkeling.",
      creatureSlugs: [
        "spiny-lobster",
        "sergeant-major",
        "french-angelfish",
        "bluehead-wrasse",
        "yellowtail-damselfish",
        "french-grunt",
      ],
    },
  },
  {
    slug: "remorqueur-tintamarre-saint-martin",
    version: 1,
    area: "saint-martin",
    sources: [
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
      "https://www.dm.guadeloupe.developpement-durable.gouv.fr/IMG/pdf/etude_d_impact_-_projet_bouees_recorea_saint-martin_agrnsm.pdf",
      "https://web.archive.org/web/2025/https://www.st-martin.org/us/activity/blue-odyssey-diving/",
      "https://www.antilleslocation.com/blog-voyage/plongee-saint-martin.html",
      "https://www.oovatu.com/voyages/caraibes/saint-martin/guide/plongee-snorkeling",
      "https://www.cityzeum.com/plongee-a-saint-martin",
    ],
    briefing: {
      name: "Remorqueur",
      locationName: "Tintamarre, Saint-Martin",
      // Position: the nature reserve's dive layer; the reserve's mooring study puts the wreck's dive mooring within about 20 m of it.
      forecastLatitude: 18.1216,
      forecastLongitude: -62.987,
      description:
        "A tugboat resting on sand north of Tintamarre, sunk as an artificial reef and now covered in coral and gorgonians. Sergeant majors shelter among the wreckage, and octopus are common.",
      marineLife: "Sergeant majors · octopus · gorgonians · coral",
      marineLifeDescription:
        "Sergeant majors live around the hull, and coral and gorgonians cover the steel. A large octopus population is reported on the wreck.",
      conservationNote:
        "Tintamarre lies inside the Saint-Martin nature reserve. Dive boats use the reserve’s white club moorings, never an anchor on the reef.",
      difficultyLevel: "intermediate",
      depthRange: "15–25 m (50–82 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Open water off Tintamarre. Current is not documented; carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring to the tugboat, once around the outside, and back up the line. Stay outside the hull. Medical care is far; confirm the boat's oxygen and plan.",
      fitTone: "unknown",
      fitNote: "A tugboat wreck in open water off Tintamarre, with a floor near 25 m.",
      // Depth: the tourism board's guide gives about 15 m and two other guides give 15 to 25 m; the deeper figure is used. Gated at Advanced Open Water for the open-water exposure off Tintamarre, which the guides pair with an experienced-diver rating; depth to 25 m alone would not gate it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "sergeant-major",
        "french-grunt",
        "bluestriped-grunt",
        "spiny-lobster",
        "common-sea-fan",
      ],
    },
  },
];
