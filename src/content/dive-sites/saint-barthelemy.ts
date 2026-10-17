// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Saint-Barthélemy. */
export const SAINT_BARTHELEMY: DiveSiteTemplate[] = [
  {
    slug: "gros-ilets-saint-barthelemy",
    version: 1,
    area: "saint-barthelemy",
    sources: [
      "https://ouanalaodive.com/nos-spots/",
      "https://www.serialdivers.com/fr/plongee/sites-plongee/",
      "https://www.enezgreen.com/?p=1389",
      "https://www.oovatu.com/voyages/caraibes/st-barth/guide/plongee-snorkeling",
    ],
    briefing: {
      name: "Gros Îlets (Aquarium)",
      locationName: "Gustavia, Saint-Barthélemy",
      // Approximate pin: Les Gros Îlets, from the OpenStreetMap coordinates for the named islet (placed about 100 m off its west side, in the water). Two operator pages tie the site to it. Good to about 2 km; the moorings are in the water around it, and no other defined site lies within 200 m.
      forecastLatitude: 17.9003,
      forecastLongitude: -62.862,
      description:
        "Reefs and rocks around a small islet five minutes by boat from Gustavia, also called the Aquarium. The shallows are full of tropical fish and lobsters, and the outer rocks reach 25 m.",
      marineLife: "Tropical reef fish · spiny lobsters · green turtles · nurse sharks",
      marineLifeDescription:
        "Reef fish and lobsters fill the rocks. Nurse sharks, rays and green turtles are reported on the deeper rocks.",
      conservationNote:
        "Most dive sites around the island lie inside the Saint-Barthélemy nature reserve, which sets mooring and group-size limits. Dive on the reserve’s moorings and within its group-size limit.",
      difficultyLevel: "intermediate",
      // Depth: one operator gives 0 to 15 m and one guide gives 25 m; the deeper figure is used.
      maxDepthMeters: 25,
      currentNote:
        "Gustavia’s harbor is five minutes away, so listen for engines, carry an SMB and come up the mooring line. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring and around the islet in the shallows, no deeper than 25 m on the outer rocks, and back up the line with reserve gas.",
      fitTone: "unknown",
      fitNote:
        "Shallow around the islet and 25 m on the outer rocks. Ask the crew where the dive goes.",
      creatureSlugs: [
        "spiny-lobster",
        "blue-tang",
        "sergeant-major",
        "french-grunt",
        "green-sea-turtle",
        "nurse-shark",
      ],
    },
  },
  {
    slug: "pain-de-sucre-saint-barthelemy",
    version: 1,
    area: "saint-barthelemy",
    sources: [
      "https://ouanalaodive.com/nos-spots/",
      "https://www.serialdivers.com/fr/plongee/sites-plongee/",
      "https://www.enezgreen.com/?p=1389",
      "https://fr.wikipedia.org/wiki/Pain_de_Sucre_(Saint-Barthélemy)",
      "https://www.oovatu.com/voyages/caraibes/st-barth/guide/plongee-snorkeling",
    ],
    briefing: {
      name: "Pain de Sucre",
      locationName: "Gustavia, Saint-Barthélemy",
      // Approximate pin: the rock called Le Pain de Sucre, from the Wikipedia coordinates for the named island (placed about 120 m west of its recorded point, in the water). Two operator pages tie the site to it. Good to about 2 km; the moorings are in the water around it, and no other defined site lies within 200 m.
      forecastLatitude: 17.8971,
      forecastLongitude: -62.8801,
      description:
        "A rock with several dive sites around it, close to Gustavia, among the best known on the island. Lobsters live there by the hundreds, and gray and nurse sharks and eagle rays are reported.",
      marineLife: "Spiny lobsters · nurse sharks · Caribbean reef sharks · spotted eagle rays",
      marineLifeDescription:
        "Tropical fish and lobsters crowd the rocks, and sharks and eagle rays are reported here. Keep your distance, keep nothing dangling and follow the crew’s briefing.",
      conservationNote:
        "Most dive sites around the island lie inside the Saint-Barthélemy nature reserve, which sets mooring and group-size limits. Dive on the reserve’s moorings and within its group-size limit.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 30,
      currentNote:
        "Gustavia’s harbor is close, so listen for engines, carry an SMB and come up the mooring line. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring and around the rock no deeper than 30 m, and back up the line with reserve gas. Staff confirm the diver’s log before boarding.",
      minimumCertificationLevel: "advanced_open_water",
      fitTone: "unknown",
      fitNote: "Several sites around one rock, from shallow to about 30 m.",
      // Depth: one operator gives 0 to 30 m and one guide gives 28 m; the deeper figure is used. Gated at Advanced Open Water because Serial Divers asks for Advanced or PE40 at the rock and the guide pitches it to experienced divers; depth alone (30 m) would not gate it.
      creatureSlugs: [
        "spiny-lobster",
        "nurse-shark",
        "caribbean-reef-shark",
        "spotted-eagle-ray",
        "blue-tang",
        "sergeant-major",
      ],
    },
  },
  {
    slug: "colombier-saint-barthelemy",
    version: 1,
    area: "saint-barthelemy",
    sources: [
      "https://ouanalaodive.com/nos-spots/",
      "https://www.serialdivers.com/fr/plongee/sites-plongee/",
      "https://www.tropicalement-votre.com/articles/a-la-decouverte-de-la-reserve-naturelle-de-saint-barthelemy-8643.php",
      "https://fr.wikipedia.org/wiki/Colombier_(Saint-Barthélemy)",
      "https://www.oovatu.com/voyages/caraibes/st-barth/guide/plongee-snorkeling",
    ],
    briefing: {
      name: "Colombier",
      locationName: "Pointe de Colombier, Saint-Barthélemy",
      // Approximate pin: Anse de Colombier, from the OpenStreetMap coordinates for the named bay (at the bay's recorded point, which lies in the water within about 1 km of the headland the wall faces). Two operator pages tie the site to it. Good to about 2 km; the moorings are in the water around it, and no other defined site lies within 200 m.
      forecastLatitude: 17.9242,
      forecastLongitude: -62.8709,
      description:
        "A wall facing the tip of Colombier, with a pinnacle where barracuda have made their home. Turtles, eagle rays, stingrays, tarpon and lobsters live along the wall, and current can run along it.",
      marineLife: "Great barracuda · hawksbill turtles · spotted eagle rays · tarpon",
      marineLifeDescription:
        "Barracuda hold over the pinnacle, with turtles, rays, tarpon and lobsters along the wall.",
      conservationNote:
        "Most dive sites around the island lie inside the Saint-Barthélemy nature reserve, which sets mooring and group-size limits. Dive on the reserve’s moorings and within its group-size limit.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 25,
      currentNote:
        "Current can run along the wall, and the crew may run it as a drift. Carry an SMB and plan the exit before you go in.",
      divePlan:
        "Down the mooring to the wall, along it with the current no deeper than 25 m, and up an SMB or the mooring line with reserve gas. Staff confirm the diver’s log before boarding.",
      minimumCertificationLevel: "advanced_open_water",
      fitTone: "unknown",
      fitNote: "A wall that can run as a drift. Ask the crew about the day’s water.",
      // Gated at Advanced Open Water: an operator's French page says the wall is often subject to current and a guide pitches it to experienced divers; the 25 m depth (three sources) alone would not gate it.
      creatureSlugs: [
        "great-barracuda",
        "hawksbill-turtle",
        "green-sea-turtle",
        "spotted-eagle-ray",
        "southern-stingray",
        "tarpon",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "fourchue-saint-barthelemy",
    version: 1,
    area: "saint-barthelemy",
    sources: [
      "https://ouanalaodive.com/nos-spots/",
      "https://www.serialdivers.com/fr/plongee/sites-plongee/",
      "https://www.enezgreen.com/?p=1389",
      "https://fr.wikipedia.org/wiki/Île_Fourchue",
      "https://www.tribloo.com/en/dive-sites/845/ile-fourchue.html",
    ],
    briefing: {
      name: "Fourchue",
      locationName: "Île Fourchue, Saint-Barthélemy",
      // Approximate pin: Île Fourchue, from the OpenStreetMap and Wikipedia coordinates for the named island (placed about 150 m off its west side, in the water). Two operator pages tie the site to it. Good to about 2 km; the moorings are in the water around it, and no other defined site lies within 200 m.
      forecastLatitude: 17.956,
      forecastLongitude: -62.912,
      description:
        "An uninhabited island north-west of Saint-Barthélemy and one of the dive sites farthest from Gustavia, run as a drift. Operators call it an aquarium, with rays, barracuda and turtles and sometimes nurse sharks.",
      marineLife: "Great barracuda · turtles · southern stingrays · nurse sharks",
      marineLifeDescription:
        "Rays, barracuda and turtles are the regulars, with nurse sharks for some divers.",
      conservationNote:
        "Most dive sites around the island lie inside the Saint-Barthélemy nature reserve, which sets mooring and group-size limits. Dive on the reserve’s moorings and within its group-size limit.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 20,
      currentNote:
        "Current is moderate and the site is often run as a drift, so carry an SMB and plan the exit before you go in. Yachts moor off the island; listen for engines. Medical care is far; confirm the boat’s oxygen and plan.",
      divePlan:
        "Down the mooring and along the reef no deeper than 20 m, drifting if the crew calls it, then up an SMB or the mooring line with reserve gas. Stop on the mooring line or an SMB in open water.",
      minimumCertificationLevel: "advanced_open_water",
      fitTone: "unknown",
      fitNote:
        "A drift over a reef to 20 m, far from the port. Ask the crew about the day’s water.",
      // Gated at Advanced Open Water because the sources run it as a drift in moderate current off an offshore island; depth (20 m) alone would not gate it.
      creatureSlugs: [
        "great-barracuda",
        "green-sea-turtle",
        "southern-stingray",
        "nurse-shark",
        "common-sea-fan",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "toc-vers-saint-barthelemy",
    version: 1,
    area: "saint-barthelemy",
    sources: [
      "https://ouanalaodive.com/nos-spots/",
      "https://www.serialdivers.com/fr/plongee/sites-plongee/",
      "https://www.tropicalement-votre.com/articles/a-la-decouverte-de-la-reserve-naturelle-de-saint-barthelemy-8643.php",
      "https://fr.wikipedia.org/wiki/Île_Toc_Vers",
      "https://www.oovatu.com/voyages/caraibes/st-barth/guide/plongee-snorkeling",
    ],
    briefing: {
      name: "Toc Vers",
      locationName: "Île Toc Vers, Saint-Barthélemy",
      // Approximate pin: Île Toc Vers, from the OpenStreetMap and Wikipedia coordinates for the named islet (placed about 150 m off its east side, in the water). Two operator pages tie the site to it. Good to about 2 km; the moorings are in the water around it, and no other defined site lies within 200 m.
      forecastLatitude: 17.943,
      forecastLongitude: -62.8156,
      description:
        "An Atlantic-side islet with several dive sites in its rock, where faults and canyons run through it. The arches, tunnels and caves are overhead; stay out. Pelagic fish sometimes pass in the blue.",
      marineLife: "Pelagic visitors · reef fish · lobsters",
      marineLifeDescription:
        "Fish and lobsters crowd the faults and canyons, and larger animals sometimes pass in open water.",
      conservationNote:
        "Most dive sites around the island lie inside the Saint-Barthélemy nature reserve, which sets mooring and group-size limits. Dive on the reserve’s moorings and within its group-size limit.",
      difficultyLevel: "advanced",
      maxDepthMeters: 25,
      currentNote:
        "Atlantic side, where conditions can be rougher, so carry an SMB and ask the crew about the swell. The caves, tunnels and arches are overhead; stay out.",
      divePlan:
        "Down the mooring, along the outside of the rock no deeper than 25 m, and back up the line with reserve gas. The arches, tunnels and caves are overhead; stay out. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "Dramatic terrain on the exposed side. Stay outside every cave and tunnel.",
      // Depth: an operator gives 0 to 25 m and a guide lists "Toc Vert" at 25 m on the north coast, taken as the same site. Gated at Advanced Open Water for Atlantic exposure and the overhead terrain; depth (25 m) alone would not gate it. The caves, tunnels and arches are overhead and not part of the plan, so the site carries no cavern gate.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "spiny-lobster",
        "glassy-sweeper",
        "great-barracuda",
        "hawksbill-turtle",
        "spotted-eagle-ray",
      ],
    },
  },
];
