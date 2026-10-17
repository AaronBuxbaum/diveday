// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Sint Eustatius (Statia). */
export const SINT_EUSTATIUS: DiveSiteTemplate[] = [
  {
    slug: "gibraltar-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "Gibraltar",
      locationName: "North Point, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 29). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.5251,
      forecastLongitude: -62.9996,
      description:
        "A large rock off the island’s northern tip, where the Atlantic meets the Caribbean. Sea fans that usually grow in deep water cover its shallow top, barracuda school around it, and nurse sharks nap on the boulders you cross on the way.",
      marineLife: "Great barracuda · nurse sharks · sea fans · jackknifefish",
      marineLifeDescription:
        "Barracuda guard the rock and nurse sharks rest among the boulders on the approach. Gaudy clown crabs live in the shallows.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 20,
      currentNote:
        "Open water where two seas meet. Current and surge are not documented; carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring to the rock, around it no deeper than 20 m, and back up the mooring line or an SMB in open water. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote:
        "An exposed rock off the island’s tip. Best for divers comfortable sending up an SMB in open water.",
      // Gated at Advanced Open Water for open water: the sources give 18 to 20 m and call the site an open-ocean rock, so depth alone would not gate it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "nurse-shark",
        "common-sea-fan",
        "spotted-moray",
        "queen-angelfish",
        "jackknife-fish",
      ],
    },
  },
  {
    slug: "charles-l-brown-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://www.goldenrockdive.com/dive-sites",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "Charles L. Brown",
      locationName: "Southern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 30, midway between its north and south moorings). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring. PADI and Scubago list the wreck within about 400 m of this point.
      forecastLatitude: 17.4657,
      forecastLongitude: -62.9938,
      description:
        "A 100 m former AT&T cable-laying ship, sunk as an artificial reef in 2003. Deepwater sea fans and sponges cover her deck and cable reels, with the top of the wreck near 18 m and the hull resting on sand at 31 m.",
      marineLife: "Horse-eye jacks · great barracuda · yellowhead jawfish · Caribbean reef sharks",
      marineLifeDescription:
        "Jacks school above the wreck, a large barracuda lives on it, and jawfish and turtles use the bottom. Reef sharks patrol, and a spotted eagle ray passes now and then.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 31,
      currentNote: "Current not documented; carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring to the top of the wreck near 18 m, along the deck and the cable reels, and back up the line with reserve gas. Stop on the mooring line or an SMB in open water. Stay outside the hull; the wreck has a swim-through, so stay out of it. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "Gated for the 31 m sand; the top near 18 m is not a separate dive.",
      // The hull rests at 31 m, so the catalog gate is Advanced Open Water and the Deep specialty even though the operators run the top as a shallower dive.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Cable reels",
          kind: "wreckFeature",
          note: "Large cable drums on the deck, covered in sea fans and sponges.",
        },
      ],
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "yellowhead-jawfish",
        "caribbean-reef-shark",
        "spotted-eagle-ray",
        "green-sea-turtle",
      ],
    },
  },
  {
    slug: "aquarium-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://www.goldenrockdive.com/dive-sites",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "Aquarium",
      locationName: "Northern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 32). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.5066,
      forecastLongitude: -63.0059,
      description:
        "An isolated rock in a wide field of sand and seagrass, drawing fish like an oasis. Sponges, coral and anemones cover the rock, sergeant majors feed over its top, and garden eels and southern stingrays share the sand around it.",
      marineLife: "Sergeant majors · southern stingrays · garden eels · green turtles",
      marineLifeDescription:
        "Small fish crowd the rock, turtles graze and rest nearby, and scorpionfish and morays sit in the cracks. Nudibranchs are common.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 18,
      currentNote:
        "The site is dived from a mooring when sea conditions allow, and it lies a 20-minute boat ride out, so carry an SMB. Current is not documented; ask the crew on the day. Medical care is far; confirm the boat’s oxygen and plan.",
      fitTone: "unknown",
      fitNote:
        "A rock in a wide field of sand, 20 minutes out by boat. Ask the crew about the day’s water.",
      creatureSlugs: [
        "sergeant-major",
        "southern-stingray",
        "garden-eel",
        "green-sea-turtle",
        "spotted-moray",
        "hawksbill-turtle",
      ],
    },
  },
  {
    slug: "double-wreck-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://www.goldenrockdive.com/dive-sites",
      "https://mass.cultureelerfgoed.nl/se-501",
      "https://statiapark.org/wp-content/uploads/2018/05/2015-annual-report-STENAPA-2015.pdf",
    ],
    briefing: {
      name: "Double Wreck",
      locationName: "Oranje Bay, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 23). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.481,
      forecastLongitude: -62.9939,
      description:
        "Despite the name, there is no hull to see. Two trading ships were lost here some 300 years ago, and what is left is a handful of ballast piles on sand, grown over with sponges and coral, plus two big anchors. The site is compact, so you can take your time with the small stuff.",
      marineLife: "Southern stingrays · blennies · green turtles · seahorses",
      marineLifeDescription:
        "Big, calm southern stingrays guard the site, a family of tiny blennies lives in one anchor, and cleaning stations, seahorses and frogfish reward a slow look.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. This is a historic wreck site: leave the ballast stones and artifacts where they lie.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 20,
      currentNote:
        "Oil tankers anchor close to the island, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote: "A compact historic site at 18 to 20 m, best for looking closely.",
      landmarks: [
        {
          name: "The anchors",
          kind: "reefHistory",
          note: "Two huge anchors among the ballast piles. Blennies live in the nooks of one of them.",
        },
      ],
      creatureSlugs: [
        "southern-stingray",
        "green-sea-turtle",
        "longsnout-seahorse",
        "longlure-frogfish",
        "pederson-cleaner-shrimp",
        "spotted-cleaner-shrimp",
      ],
    },
  },
  {
    slug: "triple-wreck-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://mass.cultureelerfgoed.nl/se-504",
      "https://statiapark.org/diving/",
      "https://statiapark.org/wp-content/uploads/2018/05/2015-annual-report-STENAPA-2015.pdf",
    ],
    briefing: {
      name: "Triple Wreck",
      locationName: "Oranje Bay, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 22). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring. Moved about 30 m from the dot; the two pins are about 120 m apart.
      forecastLatitude: 17.4803,
      forecastLongitude: -62.9948,
      description:
        "A historic site that reads like an underwater museum. Coral and sponges cover the ballast stones, and the sand around them holds pottery, bottles, barrel hoops, an anchor or two and a cannon, along with yellow Dutch bricks.",
      marineLife: "Octopus · seahorses · frogfish · scorpionfish",
      marineLifeDescription:
        "Small, strange animals use the wreckage: fingerprint cyphoma, octopus, squid, scorpionfish, seahorses and frogfish, and sailfin blennies in the old bottles.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. This is a historic wreck site: leave the ballast stones and artifacts where they lie.",
      difficultyLevel: "intermediate",
      depthMinMeters: 17,
      maxDepthMeters: 19,
      currentNote:
        "Oil tankers anchor close to the island, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A slow dive at 17 to 19 m for a diver who likes to look at small things.",
      creatureSlugs: [
        "atlantic-common-octopus",
        "longsnout-seahorse",
        "longlure-frogfish",
        "spotted-scorpionfish",
        "sailfin-blenny",
        "caribbean-reef-squid",
        "fingerprint-cyphoma",
      ],
    },
  },
  {
    slug: "chien-tong-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://www.goldenrockdive.com/dive-sites",
      "https://statiapark.org/diving/",
      "https://statiapark.org/wp-content/uploads/2018/05/2015-annual-report-STENAPA-2015.pdf",
    ],
    briefing: {
      name: "Chien Tong",
      locationName: "Oranje Bay, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 25A). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring. SSI's listing places the wreck within about 100 m.
      forecastLatitude: 17.4845,
      forecastLongitude: -62.9979,
      description:
        "A Taiwanese long-line fishing vessel sunk as an artificial reef in 2004, sitting upright on the sand of Oranje Bay with its top near 15 m. Orange cup coral covers the wreck. Night dives need staff approval and a briefed plan.",
      marineLife: "Horse-eye jacks · great barracuda · southern stingrays · sea turtles",
      marineLifeDescription:
        "Jacks, barracuda and stingrays are the day’s regulars, spotted eagle rays sometimes sail over the top in current, and sea turtles bed down here at night.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 27,
      currentNote:
        "Oil tankers anchor close to the island, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current sometimes runs over the wreck.",
      divePlan:
        "Down the mooring to the top of the wreck, along the hull’s outside, and back up the line with reserve gas. Stay outside the hull.",
      fitTone: "unknown",
      fitNote: "An upright wreck at 15 to 27 m. Ask the crew about the day’s water.",
      // The sources give 24 m (Scubaqua) and 27 m (Golden Rock); the deeper figure is used. Gated at Advanced Open Water because Golden Rock lists it for the depth; Scubaqua lists Open Water, so the stricter reading wins.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wreck",
          kind: "wreckFeature",
          note: "An upright fishing vessel, with orange cup coral covering her at night.",
        },
      ],
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "southern-stingray",
        "spotted-eagle-ray",
        "green-sea-turtle",
        "hawksbill-turtle",
      ],
    },
  },
  {
    slug: "blairs-reef-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://statiapark.org/diving/",
      "https://statiapark.org/wp-content/uploads/2018/05/2015-annual-report-STENAPA-2015.pdf",
    ],
    briefing: {
      name: "Blair’s Reef",
      locationName: "Oranje Bay, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 20). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4718,
      forecastLongitude: -62.9915,
      description:
        "A small coral island named for a local fisherman, and a good place for macro. The north side is a vertical wall with juvenile trunkfish and spotted drums in its cracks, and lobsters are everywhere.",
      marineLife: "Spiny lobsters · spotted drums · smooth trunkfish · great barracuda",
      marineLifeDescription:
        "Lobsters are uncountable, snappers and grunts hang in tight schools, barracuda are constant and hawksbill turtles visit.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 19,
      currentNote:
        "Oil tankers anchor close to the island, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A small, shallow reef where the interest is in the cracks.",
      creatureSlugs: [
        "spiny-lobster",
        "spotted-drum",
        "smooth-trunkfish",
        "great-barracuda",
        "hawksbill-turtle",
        "french-grunt",
      ],
    },
  },
  {
    slug: "barracuda-reef-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://www.goldenrockdive.com/dive-sites",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "Barracuda Reef",
      locationName: "Southern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 18, Barracuda Reef West). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4681,
      forecastLongitude: -62.9909,
      description:
        "A long, small-wall reef with vertical faces and cracks covered in coral and sponges. Barracuda are the famous residents, and every crack holds a lobster. Nurse sharks sleep under the overhangs; do not go under the overhangs, and watch the sharks without approaching them.",
      marineLife: "Great barracuda · nurse sharks · queen angelfish · Caribbean reef sharks",
      marineLifeDescription:
        "Large numbers of barracuda, the island’s richest queen angelfish and schools of grunts and snappers share the reef, with reef sharks circling in the blue and big green morays in the crevices.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "advanced",
      depthMinMeters: 19,
      maxDepthMeters: 23,
      currentNote:
        "The reef is long and has three moorings, and the crew runs it as a moored dive that turns into a drift when the current runs. The strength of that drift is not documented. Carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring, along the wall no deeper than 23 m, and back up the line with reserve gas. Do not go under the overhangs; watch the sharks, don’t approach.",
      fitTone: "unknown",
      fitNote: "A wall to 23 m that can become a drift. Ask the crew about the day’s water.",
      // The sources give 19 m (Golden Rock), 22 m (Scubaqua) and 23 m (the map's west mooring); the deepest is used. Gate: the sources say the dive turns into a drift but never say how strong, and none says it is safe for Open Water, so the conservative reading takes Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "nurse-shark",
        "queen-angelfish",
        "caribbean-reef-shark",
        "green-moray",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "hangover-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://www.goldenrockdive.com/dive-sites",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "Hangover",
      locationName: "Southern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 14). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4659,
      forecastLongitude: -62.9857,
      description:
        "Old lava grown over with coral and sponges, with coral gardens, sandy patches and overhangs. Do not go under the overhangs. Yellowtail damselfish live on a pillar coral here, and a small Caribbean reef shark often patrols; watch it without approaching.",
      marineLife: "Spiny lobsters · spotted drums · four angelfish species · queen conch",
      marineLifeDescription:
        "Jawfish, flounders and conch live on the sandy patch, lobsters share the lava with drums and morays, and a single dive can show four species of angelfish.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 17,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A shallow lava reef that suits every diver and has plenty to see.",
      creatureSlugs: [
        "spiny-lobster",
        "spotted-drum",
        "queen-angelfish",
        "queen-conch",
        "yellowhead-jawfish",
        "pillar-coral",
      ],
    },
  },
  {
    slug: "the-humps-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "The Humps",
      locationName: "Southern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 7). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4648,
      forecastLongitude: -62.9778,
      description:
        "Huge lava bombs and lava fingers thrown out by the Quill, now covered in coral and standing against fields of white sand. The reef is shallow, and groupers lurk in the hideouts along its top and sides.",
      marineLife: "Pike blennies · orange-sided gobies · groupers · decorator crabs",
      marineLifeDescription:
        "Small animals reward macro divers, and several grouper species wait in the hideouts.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "beginner",
      depthMinMeters: 13,
      maxDepthMeters: 16,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote:
        "One of the shallowest sites in the southern reserve, and a good finish for a deeper dive.",
      creatureSlugs: [
        "nassau-grouper",
        "red-hind",
        "coney",
        "peacock-flounder",
        "yellowhead-jawfish",
        "bluethroat-pikeblenny",
        "orangesided-goby",
      ],
    },
  },
  {
    slug: "drop-off-east-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.goldenrockdive.com/dive-sites",
      "https://www.scubaqua.com/divesites/",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "Drop Off East",
      locationName: "Southern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 1). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4625,
      forecastLongitude: -62.9739,
      description:
        "A wall dive in the far southern marine reserve. The top reef begins near 20 m, with large groupers including Nassau grouper, and the reef edge falls away into deep water where reef sharks and blacktip sharks patrol.",
      marineLife: "Groupers · Nassau grouper · Caribbean reef sharks · blacktip sharks",
      marineLifeDescription:
        "Large groupers, among them a recovering Nassau grouper, hold the top reef, and sharks patrol the open water beyond the edge.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "advanced",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      currentNote:
        "A 20-minute boat ride to open water. Current is not documented; carry an SMB and ask the crew on the day. Medical care is far; confirm the boat’s oxygen and plan.",
      divePlan:
        "Down the mooring to the top reef, along the edge no deeper than 30 m, and back up the reef with reserve gas. Stop on the mooring line or an SMB. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "A wall that falls past recreational depth, dived to a floor of 30 m.",
      // The wall drops past 30 m; the plan holds a 30 m floor, so the gate is Advanced Open Water without the Deep specialty. Golden Rock puts the shallowest point at 20 m and requires Advanced.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nassau-grouper",
        "black-grouper",
        "caribbean-reef-shark",
        "blacktip-shark",
        "common-sea-fan",
        "great-barracuda",
      ],
    },
  },
  {
    slug: "blue-bead-hole-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://statiapark.org/diving/",
      "https://statiapark.org/wp-content/uploads/2018/05/2015-annual-report-STENAPA-2015.pdf",
    ],
    briefing: {
      name: "Blue Bead Hole",
      locationName: "Oranje Bay, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 31). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4788,
      forecastLongitude: -62.9916,
      description:
        "A muck-and-history dive between the old harbor and the reefs on the island’s southern corner. Coral heads, sand and seagrass hide pike and sailfin blennies, scorpionfish and mantis shrimp, and legend says the blue trade beads find you.",
      marineLife: "Flying gurnards · sailfin blennies · scorpionfish · mantis shrimp",
      marineLifeDescription:
        "The sought-after residents are the flying gurnards, whose fins match the blue of the beads, with blennies, scorpionfish and mantis shrimp in the rubble.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "beginner",
      maxDepthMeters: 17,
      currentNote:
        "Oil tankers anchor close to the island, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote:
        "A shallow macro dive over sand and seagrass. Stay together and well off the bottom.",
      creatureSlugs: [
        "sailfin-blenny",
        "spotted-scorpionfish",
        "peacock-flounder",
        "yellowhead-jawfish",
        "queen-conch",
        "flying-gurnard",
        "bluethroat-pikeblenny",
      ],
    },
  },
  {
    slug: "nursing-station-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.goldenrockdive.com/dive-sites",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "Nursing Station",
      locationName: "Southern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 19). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4695,
      forecastLongitude: -62.9916,
      description:
        "A lava-flow reef with several anchors from the 18th and 19th centuries lying around it. Nurse sharks nap under deep overhangs; do not go under them, and watch the sharks without approaching. The sandy patch is full of lettuce sea slugs in several colors.",
      marineLife: "Nurse sharks · lettuce sea slugs · old anchors",
      marineLifeDescription:
        "Nurse sharks nap under the overhangs, and the sand holds a good number of sea slugs.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 19,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring, along the lava reef and the anchors no deeper than 19 m, and back up the line. Do not go under the overhangs; watch the sharks, don’t approach.",
      fitTone: "welcoming",
      fitNote: "A lava reef down to 19 m with history lying in it.",
      landmarks: [
        {
          name: "Old anchors",
          kind: "reefHistory",
          note: "Several anchors from the 18th and 19th centuries lie around the site.",
        },
      ],
      creatureSlugs: [
        "nurse-shark",
        "lettuce-sea-slug",
        "spiny-lobster",
        "spotted-moray",
        "queen-angelfish",
        "yellowhead-jawfish",
      ],
    },
  },
  {
    slug: "stenapa-reef-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://www.goldenrockdive.com/dive-sites",
      "https://statiapark.org/diving/",
      "https://statiapark.org/wp-content/uploads/2018/05/2015-annual-report-STENAPA-2015.pdf",
    ],
    briefing: {
      name: "STENAPA Reef",
      locationName: "Oranje Bay, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 25). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4853,
      forecastLongitude: -62.9971,
      description:
        "An artificial reef the park made for fishermen, built from a sunken barge, a long pipe from the oil terminal, the bow and stern of the Dundalk and a small tugboat at the southern end. Sponges are taking over the barge’s deck, and juvenile fish use all of it.",
      marineLife: "Garden eels · southern stingrays · octopus · juvenile reef fish",
      marineLifeDescription:
        "Fields of garden eels and plenty of southern stingrays cover the sand between the structures, with octopus dens and pipefish.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "intermediate",
      depthMinMeters: 17,
      maxDepthMeters: 20,
      currentNote:
        "Oil tankers anchor close to the island, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the barge, along the pipe and the Dundalk sections, and on to the tugboat at the southern end. Stay outside every hull, including the tug’s wheelhouse.",
      fitTone: "unknown",
      fitNote: "A set of small wrecks at 17 to 20 m. Stay outside every hull.",
      creatureSlugs: [
        "garden-eel",
        "southern-stingray",
        "atlantic-common-octopus",
        "yellow-pencil-coral",
        "queen-angelfish",
        "french-angelfish",
      ],
    },
  },
  {
    slug: "anchor-point-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "Anchor Point",
      locationName: "Southern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 15, the south mooring of three). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4652,
      forecastLongitude: -62.9865,
      description:
        "Named for a large coral-covered French anchor from about 1750 to 1775 that hooked into the reef. A cleaning station with Spanish hogfish sits above a swim-through, which is overhead, so stay out of it. Cracks and overhangs lie farther along, and the reef top is covered in barrel sponges.",
      marineLife: "Spanish hogfish · Caribbean reef sharks · moray eels · sharptail eels",
      marineLifeDescription:
        "Reef sharks patrol the top, several species of moray live in the cracks, and the sharptail eel turns up for those who look.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 19,
      currentNote:
        "Current not documented; ask the crew on the day. The swim-through is overhead; stay out of it.",
      fitTone: "unknown",
      fitNote: "A shallow reef with an anchor to find. Ask the crew about the day’s water.",
      // The swim-through before the anchor is overhead and not part of the plan, so the site carries no cavern gate.
      landmarks: [
        {
          name: "The French anchor",
          kind: "reefHistory",
          note: "A large coral-covered French anchor from about 1750 to 1775, hooked into the reef.",
        },
      ],
      creatureSlugs: [
        "spanish-hogfish",
        "caribbean-reef-shark",
        "green-moray",
        "goldentail-moray",
        "sharptail-eel",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "the-cliffs-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "The Cliffs",
      locationName: "Southern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 4). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.4635,
      forecastLongitude: -62.9793,
      description:
        "A reef top with schools of creole wrasse leads to a vertical cliff covered in deepwater sea fans and wire coral. Hamlets and lettuce sea slugs live on the reef top, and reef sharks, eagle rays and oceanic triggerfish pass in the blue.",
      marineLife: "Creole wrasse · hamlets · lettuce sea slugs · Caribbean reef sharks",
      marineLifeDescription:
        "The reef top has wrasse and hamlets, and big animals cruise along the cliff.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "advanced",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      currentNote:
        "Open water along the cliff. Current is not documented; carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring to the reef top, to the lip of the cliff, then along the edge no deeper than 30 m, and back across the reef top with reserve gas. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "A cliff that falls past recreational depth. The floor is the plan’s.",
      // The cliff drops past 30 m; the plan holds a 30 m floor, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "creole-wrasse",
        "lettuce-sea-slug",
        "caribbean-reef-shark",
        "spotted-eagle-ray",
        "common-sea-fan",
        "ocean-triggerfish",
      ],
    },
  },
  {
    slug: "grand-canyon-statia",
    version: 1,
    area: "sint-eustatius",
    sources: [
      "https://web.archive.org/web/2024/https://statia-tourism.com/wp-content/uploads/2021/03/StEustatius_DiveMap2016.pdf",
      "https://www.scubaqua.com/divesites/",
      "https://statiapark.org/diving/",
    ],
    briefing: {
      name: "Grand Canyon",
      locationName: "Southern Marine Park, Sint Eustatius",
      // Approximate pin: measured off the park's published dive map (mooring 3). The map's island outline was fitted to the coastline and the mooring dot read off, good to about 150 m, not a surveyed mooring.
      forecastLatitude: 17.463,
      forecastLongitude: -62.9775,
      description:
        "Ancient lava flows from the Quill plunge here into deep water as steep walls and canyons. The walls are covered in deepwater sea fans and wire coral, with spotted eagle rays and reef sharks patrolling and lobsters packed into the cracks.",
      marineLife: "Spotted eagle rays · Caribbean reef sharks · spiny lobsters · wire coral",
      marineLifeDescription:
        "Pelagic animals patrol the walls and packs of lobsters live in the cracks.",
      conservationNote:
        "Statia National Marine Park requires every dive to be supervised by a dive center and charges a marine park fee that pays for the moorings and staff. No gloves, no touching or removing coral or other sea life, and no feeding.",
      difficultyLevel: "advanced",
      depthMinMeters: 26,
      maxDepthMeters: 30,
      currentNote:
        "Open water along the walls. Current is not documented; carry an SMB and ask the crew on the day. Stay out of the narrow cracks.",
      divePlan:
        "Down the mooring to the lava flows, along the walls no deeper than 30 m, and back up the mooring line with reserve gas. Stay out of the narrow cracks. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "Lava walls that keep going past recreational depth. The floor is the plan’s.",
      // The walls fall past 30 m; the plan holds a 30 m floor, so the gate is Advanced Open Water without the Deep specialty. The mooring is at 26 m.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "caribbean-reef-shark",
        "spiny-lobster",
        "common-sea-fan",
        "black-coral",
        "orange-elephant-ear-sponge",
      ],
    },
  },
];
