// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Cozumel. Positions are from ScubaTony's site map (divesites.scubatony.com), the one list that publishes coordinates; the operators' pages supply depth and character. */
export const MEXICO_COZUMEL: DiveSiteTemplate[] = [
  // Denominator row: Barracuda (Barracuda Wall)
  {
    slug: "barracuda-wall-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://diveparadise.com/scuba-diving/the-reefs/",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
    ],
    briefing: {
      name: "Barracuda Wall",
      locationName: "North end, Cozumel",
      forecastLatitude: 20.5688,
      forecastLongitude: -86.9154,
      description:
        "The most northerly dive on the island, outside the national park. A flat strip of sand and reef tilts into a wall, and local operators run it as the first tank of the day.",
      marineLife: "Great barracuda · spotted eagle rays · horse-eye jacks · green turtles",
      marineLifeDescription:
        "Barracuda and jacks hold over the reef edge while eagle rays pass along the wall.",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 30,
      currentNote:
        "Strong to very strong, running straight out to sea and hard to predict. A diver who loses the group is carried past the island. Carry an SMB, stay with the guide and expect surface chop when the wind is up.",
      divePlan:
        "Descend together onto the reef edge, drift along it no deeper than 30 m (100 ft), and ascend on the guide's signal with the SMB out and the boat following.",
      fitTone: "demanding",
      fitNote:
        "Fast water over a wall that keeps going, with little time to look around. For divers who drift comfortably behind a guide.",
      // Sources put the wall at 21 to 40 m. The plan floors at 30 m, so the gate is Advanced Open Water without the Deep specialty. Outside the national park.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "great-barracuda",
        "spotted-eagle-ray",
        "horse-eye-jack",
        "green-sea-turtle",
        "nurse-shark",
      ],
    },
  },
  // Denominator row: San Juan
  {
    slug: "san-juan-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://petelepage.com/scuba/sites/san-juan-cozumel/",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
    ],
    briefing: {
      name: "San Juan Reef",
      locationName: "North end, Cozumel",
      forecastLatitude: 20.5477,
      forecastLongitude: -86.9341,
      description:
        "A broad reef top of finger and lettuce coral, sponges, ledges and overhangs on the north coast, outside the national park. Lovely when the sea is calm, and a hard drift when it is not.",
      marineLife: "French grunts · schoolmaster snapper · nurse sharks · lettuce coral",
      marineLifeDescription:
        "Grunts and snapper stack up over the ledges, with nurse sharks resting under the overhangs.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Strong to very strong, running out to sea and unpredictable, so a diver who loses the group can be carried past the island. Carry an SMB, stay with the guide and expect surface chop when the wind is up.",
      divePlan:
        "Drop onto the reef top, drift with the guide along the ledges no deeper than 30 m (100 ft), and ascend with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "A fast drift over a reef that rewards slowing down, which the current will not allow. For divers who are steady in moving water.",
      // Reef top at 12 to 15 m per the operators, deeper toward the drop-off (one source to 33 m). The plan floors at 30 m. Position cross-checked with a dive-log entry 0.3 km away. Outside the national park.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "french-grunt",
        "schoolmaster-snapper",
        "nurse-shark",
        "lettuce-coral",
        "finger-coral",
        "green-moray",
      ],
    },
  },
  // Denominator row: Villa Blanca Wall (Villablanca)
  {
    slug: "villa-blanca-wall-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://en.wikipedia.org/wiki/Villa_Blanca_Reef",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://diveparadise.com/scuba-diving/the-reefs/",
    ],
    briefing: {
      name: "Villa Blanca Wall",
      locationName: "Villa Blanca, Cozumel",
      forecastLatitude: 20.4862,
      forecastLongitude: -86.9736,
      description:
        "A sloping wall just south of town, outside the national park, dressed in barrel and basket sponges and gorgonians. Jacks and angelfish school over it.",
      marineLife: "Barrel sponges · gorgonians · jacks · angelfish",
      marineLifeDescription:
        "The sponges and fans are the show, with schooling fish over the slope.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Ship traffic first: the wall lies off the main port, the cruise-ship berths and the mainland ferry route. Do not dive while a ship is alongside or maneuvering, carry an SMB and listen for engines. Reports of the current range from mild to strong, so plan it as a drift. The wall starts about 400 m offshore, so a shore entry means a swim of roughly 15 minutes; go by boat.",
      divePlan:
        "Down to the top of the slope, along the wall no deeper than 30 m (100 ft), and back up the reef with reserve gas and the SMB out.",
      fitTone: "demanding",
      fitNote:
        "A quiet wall near town with a long boat-traffic list. For divers who plan around ships and drift with a marker.",
      // The wall slopes past 30 m (sources run to 36 m). The plan floors at 30 m, so the gate is Advanced Open Water without the Deep specialty. Outside the national park. Position: ScubaTony, within 0.3 km of the Wikipedia coordinates.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Villa Blanca Wall",
          kind: "reefFormation",
          note: "A sloping wall beginning about 400 m off the shore.",
        },
      ],
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "french-angelfish",
        "nurse-shark",
        "great-barracuda",
      ],
    },
  },
  // Denominator row: Paradise (Paraíso)
  {
    slug: "paradise-reef-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://diveparadise.com/scuba-diving/the-reefs/",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://www.scubaxoc.com/?section=diveSites",
    ],
    briefing: {
      name: "Paradise Reef",
      locationName: "South of town, Cozumel",
      forecastLatitude: 20.4696,
      forecastLongitude: -86.9822,
      description:
        "The first reef inside the national park south of town. Three low parallel coral ridges in shallow water, used for checkouts, second dives and night dives.",
      marineLife: "Splendid toadfish · spiny lobster · octopus · queen angelfish",
      marineLifeDescription:
        "Toadfish and octopus come out at night, and the crevices hold lobster and eels.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 14,
      currentNote:
        "Ship traffic first: the north end lies by the cruise terminal. Do not dive while a ship is maneuvering or alongside, carry an SMB on a drift and listen for engines. Current is light to moderate, usually south to north.",
      divePlan:
        "From the mooring, cross the ridges toward the sand, turn, and return along the next ridge.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, close and forgiving, and a good first look at Cozumel's reef. Check the ship schedule before you go.",
      // Sources run 9 to 14 m; the deepest figure, 45 ft, is used.
      creatureSlugs: [
        "splendid-toadfish",
        "spiny-lobster",
        "atlantic-common-octopus",
        "queen-angelfish",
        "spotted-moray",
      ],
    },
  },
  // Denominator row: C-53 Wreck (Felipe Xicoténcatl)
  {
    slug: "c-53-wreck-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
    ],
    briefing: {
      name: "C-53 Felipe Xicoténcatl",
      locationName: "Chankanaab, Cozumel",
      forecastLatitude: 20.4427,
      forecastLongitude: -86.9983,
      description:
        "A Mexican Navy minesweeper of about 56 m (184 ft), sunk upright as an artificial reef off Chankanaab in 2000. Her sand bottom lies near 24 m (80 ft).",
      marineLife: "Great barracuda · black grouper · glassy sweepers · spiny lobster",
      marineLifeDescription:
        "Grouper and barracuda hold around the hull, and sweepers and lobster take the shade.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 24,
      currentNote:
        "Mild to swift, and it can strengthen during the dive. A tourist submarine also visits the wreck, so expect a second vessel: carry an SMB, listen for engines and leave the ascent line clear.",
      divePlan:
        "Down the line to the deck, once around the outside of the hull and superstructure, and back to the line with reserve gas. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "An upright wreck at 24 m with a current that can pick up. Stay outside the hull, and carry gas for the ascent line.",
      // Gated Advanced Open Water for the current and the 24 m deck. Sources differ on length (154 or 184 ft); 184 ft is used.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "C-53 wreck",
          kind: "wreckFeature",
          note: "Upright on a sand bottom near 24 m. Stay outside the hull.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "black-grouper",
        "glassy-sweeper",
        "spiny-lobster",
        "green-moray",
      ],
    },
  },
  // Denominator row: Chankanaab (Chankanaab Shallows)
  {
    slug: "chankanaab-reef-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://diveparadise.com/scuba-diving/the-reefs/",
    ],
    briefing: {
      name: "Chankanaab Reef",
      locationName: "Chankanaab, Cozumel",
      forecastLatitude: 20.4395,
      forecastLongitude: -87.0047,
      description:
        "Shallow coral heads and sand off Chankanaab Park. A calm dive with lobster, eels and small macro life, and a favorite for night dives.",
      marineLife: "Spiny lobster · nurse sharks · spotted moray · splendid toadfish",
      marineLifeDescription:
        "Lobster and eels tuck into the heads by day, and octopus and reef squid appear after dark.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 17,
      currentNote:
        "Mild, running south to north. Snorkelers crowd the reef by day, so carry an SMB on a boat dive and look up on the way to the surface. Run-off from the lagoon dulls visibility after rain.",
      divePlan:
        "From the mooring, work along the line of coral heads and cross the sand between them, then return on the same heads.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and easy on gas, best after dark when the heads fill with lobster and octopus.",
      // Sources run 9 to 17 m; the deepest figure, 55 ft, is used.
      creatureSlugs: [
        "spiny-lobster",
        "nurse-shark",
        "spotted-moray",
        "splendid-toadfish",
        "caribbean-reef-squid",
        "atlantic-common-octopus",
      ],
    },
  },
  // Denominator row: Tormentos
  {
    slug: "tormentos-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://www.dresseldivers.com/blog/cozumel-dive-sites-spots/",
    ],
    briefing: {
      name: "Tormentos Reef",
      locationName: "Punta Tormentos, Cozumel",
      forecastLatitude: 20.4236,
      forecastLongitude: -87.0146,
      description:
        "Healthy coral heads standing 6 to 9 m tall with sandy valleys between them, in two sections divided by a sand bar. Best for slow looks at small life.",
      marineLife: "Nurse sharks · turtles · groupers · splendid toadfish",
      marineLifeDescription:
        "Nurse sharks and turtles use the heads, and the sand channels hold stingrays and jawfish.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 21,
      currentNote:
        "Mild to swift, and strong at times. The coral heads shelter divers from the flow, but plan it as a drift and carry an SMB.",
      divePlan:
        "Follow the heads from the first section across the sand bar to the second, staying shallower than 21 m (70 ft), and ascend with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "Beautiful heads, but a swift day makes it a hold-on dive. For divers who are comfortable in moving water.",
      // Gated Advanced Open Water for the current (strong at times) and the 21 m figure from the deepest source; others say 18 m.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nurse-shark",
        "green-sea-turtle",
        "spotted-moray",
        "splendid-toadfish",
        "southern-stingray",
        "yellowhead-jawfish",
      ],
    },
  },
  // Denominator row: Yucab
  {
    slug: "yucab-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://diveparadise.com/scuba-diving/the-reefs/",
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
    ],
    briefing: {
      name: "Yucab Reef",
      locationName: "Yucab, Cozumel",
      forecastLatitude: 20.4164,
      forecastLongitude: -87.0182,
      description:
        "A dense, low reef of sponges and overhangs scoured by sand. A busy dive for its depth, and a regular second tank.",
      marineLife: "Spiny lobster · banded coral shrimp · nurse sharks · angelfish",
      marineLifeDescription:
        "Small life fills the overhangs, with turtles and nurse sharks working the edges.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 20,
      currentNote:
        "Reports run from mild to strong, usually south to north and often swift. Carry an SMB and plan it as a drift.",
      divePlan:
        "Drift the length of the reef with the guide, looking under the overhangs, no deeper than 20 m (65 ft), and ascend with the SMB out.",
      fitTone: "demanding",
      fitNote: "Rich in small things that you see for a few seconds as the reef goes by.",
      // Gated Advanced Open Water for the current (swift to strong in three sources) and 20 m figure from the deepest source (65 ft).
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spiny-lobster",
        "banded-coral-shrimp",
        "nurse-shark",
        "queen-angelfish",
        "squirrelfish",
        "green-sea-turtle",
      ],
    },
  },
  // Denominator row: Punta Tunich (Tunich)
  {
    slug: "punta-tunich-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://www.dresseldivers.com/blog/cozumel-dive-sites-spots/",
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
    ],
    briefing: {
      name: "Punta Tunich",
      locationName: "Punta Tunich, Cozumel",
      forecastLatitude: 20.414,
      forecastLongitude: -87.0213,
      description:
        "A wall with long beds of finger coral and elephant ear sponges, cut by caves and crevices, where the water usually flows south to north. The caves and crevices are overhead; stay out.",
      marineLife: "Green turtles · nurse sharks · great barracuda · spotted eagle rays",
      marineLifeDescription:
        "Turtles and nurse sharks work the upper wall, with rays passing over the edge.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote:
        "Moderate to strong, south to north, and a fast drift. Carry an SMB and keep a pre-planned drift path, since the pinnacles need precise buoyancy.",
      divePlan:
        "Along the upper wall with the current at your back, no deeper than 30 m (100 ft), stay out of the caves and crevices, and ascend with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "A fast wall that keeps a diver moving and the buoyancy honest. For divers who handle drift well.",
      // The wall drops past 30 m (sources to 36 to 40 m); the plan floors at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "nurse-shark",
        "great-barracuda",
        "spotted-eagle-ray",
        "finger-coral",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: San Clemente
  {
    slug: "san-clemente-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.dresseldivers.com/blog/cozumel-dive-sites-spots/",
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
    ],
    briefing: {
      name: "San Clemente",
      locationName: "San Clemente, Cozumel",
      forecastLatitude: 20.4096,
      forecastLongitude: -87.0224,
      description:
        "A shallow coral garden with clear water, popular with photographers and used as an easy second tank.",
      marineLife: "Trumpetfish · spotted moray · southern stingray · coral heads",
      marineLifeDescription:
        "Small fish and morays work the coral heads, with the odd ray on the sand.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 15,
      currentNote:
        "Mild to moderate. Carry an SMB on a boat dive, since the boat follows the drift.",
      divePlan:
        "From the mooring, work the coral heads along the reef and return on the same line.",
      fitTone: "welcoming",
      fitNote: "Shallow and bright, with time to look. A relaxed second dive.",
      // Depth from Dressel Divers (20 to 50 ft) and Sand Dollar Sports (35 to 50 ft).
      creatureSlugs: [
        "trumpetfish",
        "spotted-moray",
        "southern-stingray",
        "finger-coral",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: San Francisco (San Francisco Wall)
  {
    slug: "san-francisco-wall-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://diveparadise.com/scuba-diving/the-reefs/",
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
    ],
    briefing: {
      name: "San Francisco Wall",
      locationName: "San Francisco, Cozumel",
      forecastLatitude: 20.3971,
      forecastLongitude: -87.0259,
      description:
        "Cozumel's shallowest wall: a gradual slope of sand and coral rubble over a small drop-off, with pink vase sponges and sea fans, in three sections divided by sand.",
      marineLife: "Turtles · nurse sharks · spotted eagle rays · pink vase sponges",
      marineLifeDescription:
        "Turtles and rays cruise the slope, and sponges and fans line the drop-off.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Mild to moderate in some reports and unpredictable or strong in others, usually south to north. Carry an SMB and plan it as a drift.",
      divePlan:
        "Drop to the top of the slope at 12 m, drift along it no deeper than 30 m (100 ft), and ascend over the shallow reef with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "A friendly wall until the current changes. For divers who can hold a depth on a slope.",
      // The wall slopes to 40 m in sources; the plan floors at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "nurse-shark",
        "spotted-eagle-ray",
        "pink-vase-sponge",
        "common-sea-fan",
        "creole-wrasse",
      ],
    },
  },
  // Denominator row: Santa Rosa Wall (Santa Rosa)
  {
    slug: "santa-rosa-wall-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://www.aguaclaradivingcozumel.com/dive-sites",
    ],
    briefing: {
      name: "Santa Rosa Wall",
      locationName: "Santa Rosa, Cozumel",
      forecastLatitude: 20.3806,
      forecastLongitude: -87.0291,
      description:
        "A classic wall that starts near 15 m and falls away, with towering coral columns, sand canyons and tunnels cut through the reef crest. One of the island's most popular first tanks.",
      marineLife: "Spotted eagle rays · green turtles · groupers · horse-eye jacks",
      marineLifeDescription:
        "Eagle rays and turtles patrol the wall, and groupers hold along the buttresses.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote:
        "Mild in some reports and strong in others, running south to north and carrying divers along the wall. Carry an SMB, watch the depth gauge, and stay out of the tunnels. Overhead; stay out of every swim-through, whoever offers it.",
      divePlan:
        "Drop onto the wall at about 15 m, drift north along it no deeper than 30 m (100 ft), and finish over the reef crest with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "A wall that drops to the abyss with a current that will carry you. Hold your depth and stay clear of the tunnels.",
      // The wall drops past 40 m (sources); the plan floors at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "green-sea-turtle",
        "black-grouper",
        "horse-eye-jack",
        "orange-elephant-ear-sponge",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Paso del Cedral (Cedral Pass)
  {
    slug: "paso-del-cedral-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://diveparadise.com/scuba-diving/the-reefs/",
    ],
    briefing: {
      name: "Paso del Cedral",
      locationName: "Paso del Cedral, Cozumel",
      forecastLatitude: 20.3732,
      forecastLongitude: -87.0291,
      description:
        "Low coral mounds and cuts in a reef strip with good light, usually dived as a second tank.",
      marineLife: "Nurse sharks · turtles · spotted eagle rays · grunts",
      marineLifeDescription:
        "Nurse sharks sleep in the cuts, with turtles and rays passing over the mounds.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      currentNote:
        "Moderate to strong, running south to north. Carry an SMB and plan it as a drift.",
      divePlan:
        "Drift along the reef strip with the guide, no deeper than 18 m (60 ft). The wall below the reef lies beyond this plan, and the low caverns at the start are not part of it.",
      fitTone: "demanding",
      fitNote:
        "A bright reef dive that moves along at speed. Stay on the reef top and out of the caverns.",
      // Gated Advanced Open Water for the current. The Cedral wall below the reef is a separate row; the plan here floors at 18 m.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nurse-shark",
        "green-sea-turtle",
        "spotted-eagle-ray",
        "bluestriped-grunt",
        "rainbow-parrotfish",
      ],
    },
  },
  // Denominator row: Punta Dalila (Dalila)
  {
    slug: "punta-dalila-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://www.dresseldivers.com/blog/cozumel-dive-sites-spots/",
      "https://www.colemanconcierge.com/cozumel-dive-guide-and-map/",
    ],
    briefing: {
      name: "Punta Dalila",
      locationName: "Punta Dalila, Cozumel",
      forecastLatitude: 20.3611,
      forecastLongitude: -87.029,
      description:
        "A shallow reef with a small wall and crevices, popular for nurse sharks and turtles.",
      marineLife: "Nurse sharks · green turtles · spotted eagle rays · spiny lobster",
      marineLifeDescription: "Nurse sharks rest in the crevices and turtles graze the shallows.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 21,
      currentNote:
        "Gentle to moderate, running south to north, and it can pick up at times. Carry an SMB on a boat dive.",
      divePlan:
        "Drift along the reef and the small wall no deeper than 18 m (60 ft), and return over the shallow reef top. The reef deepens past 18 m; the plan turns before it. Watch the current along the small wall, where it can pick up.",
      fitTone: "welcoming",
      fitNote:
        "A gentle reef with big animals at the edges. Check the flow before the second tank.",
      // Most sources give 9 to 17 m; one runs to 21 m (70 ft), so maxDepthMeters is 21. The plan floors at 18 m.
      creatureSlugs: [
        "nurse-shark",
        "green-sea-turtle",
        "spotted-eagle-ray",
        "spiny-lobster",
        "southern-stingray",
      ],
    },
  },
  // Denominator row: La Francesa (Punta Francesa)
  {
    slug: "la-francesa-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
    ],
    briefing: {
      name: "La Francesa",
      locationName: "Punta Francesa, Cozumel",
      forecastLatitude: 20.3448,
      forecastLongitude: -87.0279,
      description:
        "A shallow reef of crests, cuts and small overhangs, usually a second tank and a favorite for photography.",
      marineLife: "Splendid toadfish · nurse sharks · southern stingrays · turtles",
      marineLifeDescription:
        "Toadfish hide in the cuts, with stingrays and nurse sharks on the sand.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 24,
      currentNote: "Mild to moderate, flowing south to north. Carry an SMB on a boat dive.",
      divePlan:
        "Cross the reef crests with the guide, no deeper than 18 m (60 ft), and ascend over the shallow reef. The reef deepens past 18 m; the plan turns before it.",
      fitTone: "welcoming",
      fitNote: "A shallow reef that is best on a slow second tank, with crowds on busy days.",
      // Most sources give 9 to 18 m; one runs to 24 m (80 ft), so maxDepthMeters is 24. The plan floors at 18 m.
      creatureSlugs: [
        "splendid-toadfish",
        "nurse-shark",
        "southern-stingray",
        "green-sea-turtle",
        "spotted-eagle-ray",
      ],
    },
  },
  // Denominator row: Palancar Gardens (Jardines)
  {
    slug: "palancar-gardens-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://www.aguaclaradivingcozumel.com/dive-sites",
      "https://diveparadise.com/scuba-diving/the-reefs/",
    ],
    briefing: {
      name: "Palancar Gardens",
      locationName: "Palancar, Cozumel Reefs National Park",
      forecastLatitude: 20.3394,
      forecastLongitude: -87.0276,
      description:
        "The northern end of Palancar: a coral garden on the lip of the wall with swim-throughs and a sandy floor where rays rest.",
      marineLife: "Green turtles · spotted eagle rays · southern stingrays · jacks",
      marineLifeDescription: "Turtles and rays work the garden, with jacks passing over the edge.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 24,
      currentNote:
        "Mild to moderate, running south to north, and stronger on other days. Carry an SMB and plan it as a drift. Overhead; stay out of every swim-through, whoever offers it.",
      divePlan:
        "From the reef top, drift south to north along the garden no deeper than 24 m (80 ft), stay out of the swim-throughs, and ascend over the shallow reef with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "A coral garden beside a very deep wall. A good first Palancar dive for divers holding the reef top.",
      // The wall below the garden drops far past recreational depth; the plan holds 24 m. Gated Advanced Open Water for the depth and current, and for the drop-off beside the garden.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "spotted-eagle-ray",
        "southern-stingray",
        "blue-tang",
        "great-star-coral",
      ],
    },
  },
  // Denominator row: Palancar Horseshoe (La Herradura, Big Horseshoe)
  {
    slug: "palancar-horseshoe-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://diveparadise.com/scuba-diving/the-reefs/",
      "https://deepbluecozumel.com/cozumel-dive-sites/",
    ],
    briefing: {
      name: "Palancar Horseshoe",
      locationName: "Palancar, Cozumel Reefs National Park",
      forecastLatitude: 20.333,
      forecastLongitude: -87.0273,
      description:
        "A U-shaped amphitheater of massive coral formations and valleys, ending on a reef top at about 8 m. Palancar's busiest dive.",
      marineLife: "Green turtles · spotted eagle rays · spiny lobster · blue tang",
      marineLifeDescription:
        "Turtles and rays cross the valleys, with blue tang and butterflyfish on the reef top.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "intermediate",
      depthMinMeters: 8,
      maxDepthMeters: 27,
      currentNote:
        "Mild to moderate in some reports and strong in others, running south to north. Carry an SMB and plan it as a drift.",
      divePlan:
        "Drop into the valleys, drift along the amphitheater no deeper than 27 m (90 ft), and end on the reef top at 8 m with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "Steep sides and tight coral, so buoyancy comes first. Broken coral shows what a careless fin does.",
      // Sources run to 30 m; the plan floors at 27 m. Gated Advanced Open Water for the depth, the steep wall and the current.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "spotted-eagle-ray",
        "spiny-lobster",
        "blue-tang",
        "foureye-butterflyfish",
      ],
    },
  },
  // Denominator row: Palancar Caves (Cuevones)
  {
    slug: "palancar-caves-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://diveparadise.com/scuba-diving/the-reefs/",
    ],
    briefing: {
      name: "Palancar Caves",
      locationName: "Palancar, Cozumel Reefs National Park",
      forecastLatitude: 20.324,
      forecastLongitude: -87.0271,
      description:
        "Tall pinnacles and buttresses along a sloping wall edge, with tunnels and caverns through the reef and good visibility.",
      marineLife: "Spotted eagle rays · green turtles · groupers · jacks",
      marineLifeDescription:
        "Rays and turtles cruise the buttresses, and jacks and groupers hold along the edge.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Mild to moderate in some reports and moderate to strong in others, usually south to north. Carry an SMB and plan it as a drift. Overhead; stay out of every swim-through, whoever offers it.",
      divePlan:
        "Along the buttresses and the open sand chutes no deeper than 30 m (100 ft), staying out of the tunnels and caverns, and ascend with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "Big buttresses with tunnels you do not enter. For divers who keep to the open water beside them.",
      // The wall drops past 40 m (sources); the plan floors at 30 m, so the gate is Advanced Open Water without the Deep specialty. The tunnels and caverns are out of plan.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "green-sea-turtle",
        "black-grouper",
        "horse-eye-jack",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: Palancar Bricks (Ladrillos)
  {
    slug: "palancar-bricks-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://deepbluecozumel.com/cozumel-dive-sites/",
      "https://www.scubaxoc.com/?section=diveSites",
    ],
    briefing: {
      name: "Palancar Bricks",
      locationName: "Palancar, Cozumel Reefs National Park",
      forecastLatitude: 20.3198,
      forecastLongitude: -87.0265,
      description:
        "Large coral formations on white sand sloping into deep blue water, named for clay bricks from a wreck. Visibility is excellent.",
      marineLife: "Green turtles · spotted eagle rays · nurse sharks · lobster",
      marineLifeDescription:
        "Turtles and rays are common here, and the formations shelter nurse sharks and lobster.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 27,
      currentNote: "Mild to moderate, south to north. Carry an SMB and plan it as a drift.",
      divePlan:
        "Along the formations at the sand edge, no deeper than 27 m (90 ft), and ascend over the reef with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "Sand, coral and open water beyond. A lovely dive for divers watching depth and gas.",
      // Sources run to 40 m; the plan floors at 27 m. Gated Advanced Open Water for the depth and the slope.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "spotted-eagle-ray",
        "nurse-shark",
        "spiny-lobster",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: Colombia Shallows (Colombia bajo)
  {
    slug: "colombia-shallows-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://deepbluecozumel.com/cozumel-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://diveparadise.com/scuba-diving/the-reefs/",
    ],
    briefing: {
      name: "Colombia Shallows",
      locationName: "Colombia, Cozumel Reefs National Park",
      forecastLatitude: 20.3129,
      forecastLongitude: -87.0225,
      description:
        "A clear, shallow garden of dense coral heads in turquoise water, favored by photographers and long bottom times.",
      marineLife: "Green turtles · southern stingrays · spiny lobster · blue tang",
      marineLifeDescription:
        "Turtles, rays and lobster work the garden, with toadfish in the crevices.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 12,
      currentNote: "Light and mild in the reports. Carry an SMB on a boat dive.",
      divePlan:
        "From the mooring, work the coral heads along the garden and return on the same line. The wall of Colombia Deep lies beyond this plan.",
      fitTone: "welcoming",
      fitNote: "Shallow enough for a long, slow dive. The deeper wall is a different dive.",
      // Sources run 5 to 12 m. Deeper diving here is not practical, per Dive Paradise.
      creatureSlugs: [
        "green-sea-turtle",
        "southern-stingray",
        "spiny-lobster",
        "blue-tang",
        "splendid-toadfish",
        "spotted-moray",
      ],
    },
  },
  // Denominator row: Colombia Deep (Colombia profundo)
  {
    slug: "colombia-deep-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://www.colemanconcierge.com/cozumel-dive-guide-and-map/",
    ],
    briefing: {
      name: "Colombia Deep",
      locationName: "Colombia, Cozumel Reefs National Park",
      forecastLatitude: 20.3125,
      forecastLongitude: -87.025,
      description:
        "Towering pinnacles divided by sand chutes that fall into deep blue water, with swim-throughs, soft corals and sponges.",
      marineLife: "Green turtles · groupers · spotted eagle rays · great barracuda",
      marineLifeDescription:
        "Turtles and rays pass along the pinnacles, and groupers hold in the chutes.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "Unpredictable, from mild to strong, drifting along the wall. Carry an SMB, and slow yourself by dropping lower or using the outcrops. Overhead; stay out of every swim-through, whoever offers it.",
      divePlan:
        "Drop to the pinnacles at about 18 m, drift along the wall no deeper than 30 m (100 ft), stay out of the swim-throughs, and ascend with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "A deep drift among big pinnacles, with an edge that keeps dropping. For divers who watch the depth gauge.",
      // The wall drops past 40 m (sources); the plan floors at 30 m, so the gate is Advanced Open Water without the Deep specialty. Swim-throughs are out of plan.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "black-grouper",
        "spotted-eagle-ray",
        "great-barracuda",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: Punta Sur (Cathedral, Catedral)
  {
    slug: "punta-sur-cathedral-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://deepbluecozumel.com/cozumel-dive-sites/",
    ],
    briefing: {
      name: "Punta Sur",
      locationName: "Punta Sur, Cozumel Reefs National Park",
      forecastLatitude: 20.3071,
      forecastLongitude: -87.0243,
      description:
        "The southernmost wall inside the national park, with deep pinnacles and large coral formations. Two overheads lie on the wall, the Devil's Throat tunnel and the Cathedral cavern. Both are hazards: stay out.",
      marineLife: "Spotted eagle rays · green turtles · great barracuda · groupers",
      marineLifeDescription:
        "Rays and turtles pass the wall, with barracuda and groupers along the formations.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "Unpredictable, from mild to strong, with fast midwater flow that can carry a group past the site. Carry an SMB, expect rough water on the surface in the trade winds, and manage gas, since a drift leaves little time.",
      divePlan:
        "Drop onto the wall and drift along it no deeper than 30 m (100 ft). Along the Throat stretch hold no deeper than 21 m (70 ft), 3 m above the mouth at about 24 m; if the current carries you toward it, signal and go up the wall. Stay out of the Devil's Throat, the Cathedral and every swim-through, then ascend with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "A deep, remote wall with a current that decides the day. The tunnel and the cavern are a no-go. Medical care is far; confirm the boat's oxygen and plan.",
      // Sources put the wall at 18 to 40 m; the plan floors at 30 m (21 m along the Throat stretch, above its mouth at about 24 m), so the gate is Advanced Open Water without the Deep specialty. Overhead features (the Cathedral cavern and swim-throughs) are excluded from the plan, hence no cavern specialty is gated.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "green-sea-turtle",
        "great-barracuda",
        "black-grouper",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Maracaibo
  {
    slug: "maracaibo-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://divesites.scubatony.com/map.aspx",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.colemanconcierge.com/cozumel-dive-guide-and-map/",
    ],
    briefing: {
      name: "Maracaibo",
      locationName: "Punta Maracaibo, Cozumel",
      forecastLatitude: 20.2721,
      forecastLongitude: -87.0012,
      description:
        "The southernmost named dive, on the exposed southeast of the island: a sand and rubble terrace with coral heads that leads to a steep wall.",
      marineLife: "Spotted eagle rays · groupers · loggerhead turtles · sharks",
      marineLifeDescription:
        "Rays, turtles and sharks pass the terrace edge, and groupers hold in the heads.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "Strong and unpredictable, with open-ocean swell on the surface that can cancel the trip. Carry an SMB, stay with the guide, and keep bottom time short.",
      divePlan:
        "Drop onto the terrace, drift along the wall edge no deeper than 30 m (100 ft), and ascend with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "Remote and exposed, with a current to match. For divers who manage depth and gas without prompting.",
      // The wall drops to 40 m and beyond (sources, one to 46 m with a top near 30 m); the plan floors at 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "black-grouper",
        "loggerhead-turtle",
        "caribbean-reef-shark",
        "nurse-shark",
      ],
    },
  },
  // Denominator row: Cantarel (Cantarell, Eagle Ray Wall)
  {
    slug: "cantarel-eagle-ray-wall-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://www.scubaxoc.com/?section=diveSites",
    ],
    briefing: {
      name: "Cantarel (Eagle Ray Wall)",
      locationName: "North end, Cozumel",
      forecastLatitude: 20.5341,
      forecastLongitude: -86.9496,
      description:
        "A wall on the north coast entered over a sandbank dotted with sponges and soft coral, outside the national park. Spotted eagle rays gather here in winter.",
      marineLife: "Spotted eagle rays · sponges · soft corals · lobster",
      marineLifeDescription:
        "Eagle rays pass along the wall from mid-January to early March, and can number around twenty at once.",
      difficultyLevel: "advanced",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      currentNote:
        "Strong to very strong and unpredictable, a high-speed drift. Carry an SMB, stay with the guide and expect surface chop when the wind is up.",
      divePlan:
        "Cross the shallow bank to the wall edge, drift along it no deeper than 30 m (100 ft), and ascend with the SMB out and the boat following.",
      fitTone: "demanding",
      fitNote:
        "Eagle rays in season, in water that moves fast. For divers who drift comfortably behind a guide.",
      // Position approximate: the point is an OpenStreetMap node for Cantarell Sand Reef, about 2 km south-west of the San Juan pin, which agrees with the operators placing Cantarel on the north coast between town and San Juan. Treat it as a map center, not a mooring. Sources run 12 to 30 m; the plan floors at 30 m. Outside the national park.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["spotted-eagle-ray", "spiny-lobster", "great-barracuda", "green-sea-turtle"],
    },
  },
  // Denominator row: Las Palmas
  {
    slug: "las-palmas-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://www.mapleleafscuba.com/services/cozumels-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
      "https://simec.conanp.gob.mx/pdf_libro_pm/30_libro_pm.pdf",
    ],
    briefing: {
      name: "Las Palmas",
      locationName: "South of town, Cozumel",
      forecastLatitude: 20.456,
      forecastLongitude: -86.9905,
      description:
        "A steep slope dropping from the reef edge at about 12 m into deeper water, with sponges, small coral heads and soft corals.",
      marineLife: "Spiny lobster · green turtles · eagle rays · splendid toadfish",
      marineLifeDescription:
        "Lobster and toadfish use the heads, and turtles and rays cruise along the slope.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 22,
      currentNote:
        "Ship traffic first: the reef lies between the cruise terminal and Chankanaab. Do not dive while a ship is maneuvering or alongside, carry an SMB and listen for engines. Current is light to moderate, and known to change direction, with stronger flow reported on some days. Carry an SMB and plan it as a drift.",
      divePlan:
        "Along the reef edge and the top of the slope, no deeper than 22 m (70 ft), and ascend with the SMB out. The slope below continues past this plan.",
      fitTone: "demanding",
      fitNote:
        "An easy-looking slope with a current that changes its mind. Hold the edge and watch the depth.",
      // Position approximate: the park programme and the operators' lists place Las Palmas between Paradise and Chankanaab, so the point is interpolated on the coast between the two pins. Treat it as a map center. The slope drops to 40 m (one source); the plan floors at 22 m. Gated Advanced Open Water for the slope and the changing current.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spiny-lobster",
        "green-sea-turtle",
        "spotted-eagle-ray",
        "splendid-toadfish",
        "queen-angelfish",
      ],
    },
  },
  // Denominator row: Chankanaab Bolones (Balones)
  {
    slug: "chankanaab-bolones-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://diveparadise.com/scuba-diving/the-reefs/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
      "https://deepbluecozumel.com/cozumel-dive-sites/",
    ],
    briefing: {
      name: "Chankanaab Bolones",
      locationName: "Chankanaab, Cozumel",
      forecastLatitude: 20.4365,
      forecastLongitude: -87.0062,
      description:
        "A deeper reef of rounded, separated coral heads, offshore and slightly south of the Chankanaab shallows.",
      marineLife: "Spiny lobster · crabs · sponges · reef fish",
      marineLifeDescription: "Lobster and crabs live in the heads, with sponges between them.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 21,
      currentNote:
        "Light to moderate. A tourist submarine can be seen here, so carry an SMB and listen for engines on the ascent.",
      divePlan:
        "From the mooring, work the heads across the flat reef no deeper than 18 m (60 ft), and return on the same line. The reef deepens past 18 m; the plan turns before it.",
      fitTone: "welcoming",
      fitNote: "Flat reef with plenty to look at. A good second dive after the shallows.",
      // Position approximate: Dive Paradise places the reef offshore and slightly south of Chankanaab, so the point is 0.4 km south-south-west of the Chankanaab pin. Sources run 9 to 21 m, so maxDepthMeters is 21; the plan floors at 18 m.
      creatureSlugs: ["spiny-lobster", "spotted-moray", "splendid-toadfish", "blue-tang"],
    },
  },
  // Denominator row: Santa Rosa Shallows
  {
    slug: "santa-rosa-shallows-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
      "https://www.dresseldivers.com/blog/cozumel-dive-sites-spots/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://simec.conanp.gob.mx/pdf_libro_pm/30_libro_pm.pdf",
    ],
    briefing: {
      name: "Santa Rosa Shallows",
      locationName: "Santa Rosa, Cozumel",
      forecastLatitude: 20.3769,
      forecastLongitude: -87.0291,
      description:
        "A ridge and scattered coral heads on white sand, shallower than the wall beside it, with rays on the flats.",
      marineLife: "Southern stingrays · peacock flounder · barracuda · reef fish",
      marineLifeDescription:
        "Stingrays and flounder use the sand flats, with barracuda over the ridge.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 18,
      currentNote:
        "Mild to moderate. Carry an SMB on a boat dive; the flow is stronger over the wall next door.",
      divePlan:
        "Along the ridge and the coral heads, no deeper than 18 m (60 ft), turning before the wall edge.",
      fitTone: "welcoming",
      fitNote: "The calm side of Santa Rosa, for divers who want the reef without the wall.",
      // Position approximate: the operators' lists place the shallows next to Santa Rosa Wall and Cedral Pass, so the point is midway between those two pins. Treat it as a map center. Sources run 6 to 20 m; the plan floors at 18 m.
      creatureSlugs: ["southern-stingray", "peacock-flounder", "great-barracuda", "french-grunt"],
    },
  },
  // Denominator row: Cedral Wall (Paso del Cedral Wall)
  {
    slug: "cedral-wall-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://diveparadise.com/scuba-diving/the-reefs/",
      "https://sanddollarsports.com/activities/cozumel-dive-sites/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://deepbluecozumel.com/cozumel-dive-sites/",
      "https://simec.conanp.gob.mx/pdf_libro_pm/30_libro_pm.pdf",
    ],
    briefing: {
      name: "Cedral Wall",
      locationName: "Paso del Cedral, Cozumel",
      forecastLatitude: 20.369,
      forecastLongitude: -87.029,
      description:
        "A rolling wall below the Cedral reef, full of color with towering sponges, and jutting areas separated by calmer cuts.",
      marineLife: "Nurse sharks · spotted eagle rays · green moray eels · green turtles",
      marineLifeDescription:
        "Nurse sharks and morays sit in the cuts, with rays and turtles along the wall.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "advanced",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      currentNote: "Swift to strong, south to north. Carry an SMB and plan it as a drift.",
      divePlan:
        "Along the wall no deeper than 30 m (100 ft), and ascend onto the reef top with the SMB out.",
      fitTone: "demanding",
      fitNote:
        "A bright wall at speed, with a drop-off that keeps going. For divers steady in strong current.",
      // Position approximate: the wall lies seaward of Paso del Cedral, so the point is 0.5 km south of the Cedral Pass pin, on the line of the reef. Treat it as a map center. The wall drops to 40 m (sources); the plan floors at 30 m.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "nurse-shark",
        "spotted-eagle-ray",
        "green-moray",
        "green-sea-turtle",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  // Denominator row: Chunchakaab (Chun Chacaab)
  {
    slug: "chunchakaab-cozumel",
    version: 1,
    area: "mexico-cozumel",
    sources: [
      "https://www.bluenotescuba.com/cozumel-dive-sites",
      "https://diveparadise.com/scuba-diving/the-reefs/",
      "https://living-underwater.com/cozumel-dive-sites",
      "https://deepbluecozumel.com/cozumel-dive-sites/",
      "https://www.colemanconcierge.com/cozumel-dive-guide-and-map/",
      "https://simec.conanp.gob.mx/pdf_libro_pm/30_libro_pm.pdf",
    ],
    briefing: {
      name: "Chunchakaab",
      locationName: "Chunchakaab, Cozumel Reefs National Park",
      forecastLatitude: 20.2896,
      forecastLongitude: -87.0127,
      description:
        "A deep, little-visited reef of coral heads separated by sand, south of Punta Sur, where rays and flounder lie on the sand.",
      marineLife: "Spotted eagle rays · peacock flounder · groupers",
      marineLifeDescription:
        "Rays and flounder use the sand between the heads, with groupers around the heads.",
      conservationNote:
        "Inside Cozumel Reefs National Park: the park fee is paid before the dive, no gloves, and nothing is touched or taken.",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 36,
      currentNote:
        "Expect current like Punta Sur and Maracaibo, its neighbors; ask the crew on the day. The site is remote and weather-dependent, so carry an SMB.",
      divePlan:
        "Staff confirm the diver's log before boarding. Along the heads and sand channels no deeper than 36 m (118 ft), and ascend with the SMB out. Medical care is far; confirm the boat's oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "Remote and weather-dependent, for divers with Deep training who handle an open-water ascent without prompting.",
      // Position approximate: the reef lies between Punta Sur and Maracaibo in the park programme and in the operators' orders, so the point is midway between those two pins. Treat it as a map center. Sources run 18 to 36 m (120 ft) on a reef of coral heads, not a wall, so the plan takes 36 m and the gate is Advanced Open Water plus Deep.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["spotted-eagle-ray", "peacock-flounder", "black-grouper", "great-barracuda"],
    },
  },
];
