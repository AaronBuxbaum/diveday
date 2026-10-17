// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Cat Island, Rum Cay, San Salvador, Long Island and Conception Island. */
export const BAHAMAS_OUT_ISLANDS: DiveSiteTemplate[] = [
  // Denominator row: Telephone Pole
  {
    slug: "telephone-pole-san-salvador",
    version: 1,
    area: "bahamas-out-islands",
    sources: [
      "https://ridingrock.com/dive-site/telephone-pole/",
      "https://www.zentacle.com/Beach/8451/telephone-pole",
      "https://sailabacos.com/bahamas/dive-sites/telephone-pole-reef",
    ],
    briefing: {
      name: "Telephone Pole",
      locationName: "Cockburn Town, San Salvador",
      // Two listings give 24.0430, -74.5326 and 24.0417, -74.5333, about 150 m apart (the second is
      // on the Sail Abacos page), and the operator places the site directly off a drainage sluice
      // five minutes from its marina. Pin: the first, on the sand flat off the wall.
      forecastLatitude: 24.043,
      forecastLongitude: -74.5326,
      description:
        "A wall dive off San Salvador’s lee coast, named for a telephone pole that once lay across a crevice in the wall. A sand flat at the top leads to a strip of coral on the lip of the wall, with a large purple gorgonian that photographers have shot since 1974.",
      marineLife: "Southern stingrays · Nassau grouper · mutton snapper · goatfish",
      marineLifeDescription:
        "Groupers come in close and stingrays work the sand flat. Goatfish hover over the edge of the reef and turtles are common.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. The boat anchors on a sand flat close to the lip of the wall, so keep track of the wall edge and your depth.",
      divePlan:
        "Land on the sand flat and follow the coral strip along the wall to the north, where the wall breaks into coral heads. Return along the edge of the flat, hold no deeper than 30 m (100 ft) and keep reserve gas for the swim back to the boat. A crevice cuts the wall. Look into it from above; do not enter. The wall keeps falling past the plan. Medical care is far from the water on San Salvador, so confirm the boat’s oxygen and the emergency plan before boarding.",
      fitTone: "demanding",
      fitNote:
        "A sand flat at the top gives a gentle start, then the wall edge asks you to watch your depth. For a diver at ease beside a drop-off.",
      // The wall drops well past recreational depth and the plan floor is 30 m, so the gate is
      // Advanced Open Water (an operator rates the site intermediate to advanced), without the
      // Deep specialty. The sand flat and coral strip are an Open Water dive a shop can open.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Purple gorgonian",
          kind: "reefFormation",
          note: "A large purple sea fan at the north edge of the crevice, a well-photographed marker for the site.",
        },
      ],
      creatureSlugs: [
        "southern-stingray",
        "nassau-grouper",
        "mutton-snapper",
        "green-sea-turtle",
        "ocean-triggerfish",
      ],
    },
  },
  // Denominator row: Vicky's Reef
  {
    slug: "vickys-reef-san-salvador",
    version: 1,
    area: "bahamas-out-islands",
    sources: [
      "https://ridingrock.com/dive-site/vickys-reef/",
      "https://www.onlyblue-diving.com/san-salvador-diving-guide/",
      "https://www.zentacle.com/Beach/3753/vickys-reef",
    ],
    briefing: {
      name: "Vicky’s Reef",
      locationName: "Cockburn Town, San Salvador",
      // Approximate pin: the operator places the site offshore about a mile from Cockburn Town
      // (24.0516, -74.5282), seven minutes from its marina, and one listing gives 24.0280, -74.5343,
      // in the water off the west coast and 1.5 km from the Telephone Pole pin. Good to about 2 km.
      forecastLatitude: 24.028,
      forecastLongitude: -74.5343,
      description:
        "A strip of coral on the edge of the wall, off a wide sand plain, that doubles as a reef-monitoring site for the local field station. Colored markers sit along the top of the wall, and black coral and sponges grow on its face.",
      marineLife: "Green turtles · stingrays · Nassau grouper · mutton snapper",
      marineLifeDescription:
        "Turtles are a common sight here. Stingrays rest on the sand and groupers stay close to the reef.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. The wall drops vertically from the reef top.",
      divePlan:
        "The boat anchors on a sand plain. Stay on the lip of the wall at 11–18 m (35–60 ft), swim about 60 m (200 ft) each way, and come back where the sand meets the reef to the anchor line with reserve gas. Do not follow the wall down; it falls past the plan floor of 30 m (100 ft). Leave the survey markers on the wall untouched. Medical care is far from the water on San Salvador, so confirm the boat’s oxygen and the emergency plan before boarding.",
      fitTone: "demanding",
      fitNote:
        "A shallow reef top beside a vertical drop, with markers from a field station along the lip. For a diver who keeps to the plan beside an edge.",
      // The wall falls past recreational depth, with a narrow plateau and then more wall below it.
      // The plan floor is 30 m, so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "green-sea-turtle",
        "southern-stingray",
        "nassau-grouper",
        "mutton-snapper",
        "black-coral",
      ],
    },
  },
  // Denominator row: Runway 10 (The Runway)
  {
    slug: "runway-10-san-salvador",
    version: 1,
    area: "bahamas-out-islands",
    sources: [
      "https://ridingrock.com/dive-site/runway-10/",
      "https://www.onlyblue-diving.com/san-salvador-diving-guide/",
      "https://www.zentacle.com/Beach/8556/runaway-10",
      "https://sailabacos.com/bahamas/dive-sites/runway-10",
    ],
    briefing: {
      name: "Runway 10",
      locationName: "Cockburn Town, San Salvador",
      // Approximate pin: the operator puts the site directly offshore of the island’s airport
      // runway, three minutes from its marina. One listing gives 24.0646, -74.5442, in the water
      // west of the runway. The Sail Abacos point (24.0650, -74.4750) is on land and is not used.
      // Good to about 1 km.
      forecastLatitude: 24.0646,
      forecastLongitude: -74.5442,
      description:
        "A reef of big coral heads on the lip of a wall, off the airport runway and three minutes from the marina. The heads sit in 12–18 m (40–60 ft), with sand patches between them, and the wall drops away just beyond.",
      marineLife: "Grunts · groupers · mutton snapper · yellow stingrays",
      marineLifeDescription:
        "Grunts hang over the reef top and groupers and snappers come close. Sand patches hold conch and yellowhead jawfish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      currentNote:
        "Current not documented; ask the crew on the day. The mooring is a fixed line with a float ball to pick up, beside the edge of the wall.",
      divePlan:
        "Stay on the coral heads between 12 and 18 m (40 and 60 ft), about 30 m (100 ft) in from the edge; do not follow the edge. Swim about 60 m (200 ft) along the reef top in one direction, then back and the same distance the other way. The wall drops away well past the plan. Medical care is far from the water on San Salvador, so confirm the boat’s oxygen and the emergency plan before boarding.",
      fitTone: "welcoming",
      fitNote:
        "Shallow coral heads with room to choose your depth, and a short boat ride out. Good for a mixed group that stays on the reef top.",
      // Operators run the reef top as an all-levels dive, so the site is ungated with an 18 m floor.
      // The drop-off lies beyond the plan; the prose says so.
      creatureSlugs: [
        "french-grunt",
        "nassau-grouper",
        "mutton-snapper",
        "yellow-stingray",
        "queen-conch",
        "yellowhead-jawfish",
      ],
    },
  },
  // Denominator row: Hole in the Wall (San Salvador)
  {
    slug: "hole-in-the-wall-san-salvador",
    version: 1,
    area: "bahamas-out-islands",
    sources: [
      "https://ridingrock.com/dive-site/hole-in-the-wall/",
      "https://sailabacos.com/bahamas/dive-sites/hole-in-the-wall",
      "https://www.zentacle.com/Beach/8560/hole-in-the-wall",
    ],
    briefing: {
      name: "Hole in the Wall",
      locationName: "Long Bay, San Salvador",
      // Approximate pin: the operator places the site offshore of the settlement of Long Bay. Two
      // listings give 24.0065, -74.5541 and 24.0250, -74.5450, 2.1 km apart, so the pin is the
      // midpoint, in the water and within about 1.1 km of each. Good to about 2 km.
      forecastLatitude: 24.01575,
      forecastLongitude: -74.54955,
      description:
        "A wall with a large bite out of it: an indentation about 30 m (100 ft) across that runs back about 45 m (150 ft) into the reef. A shallow ridge parallel to the wall holds one of the island’s largest gorgonians and a pillar coral.",
      marineLife: "Schoolmaster snapper · gorgonians · pillar coral · sponges",
      marineLifeDescription:
        "Schoolmasters crowd the north end of the ridge. The outer face of the ridge is thick with sponges and soft corals.",
      difficultyLevel: "advanced",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      currentNote:
        "Current is frequent, from the tide running over nearby Gardeners Reef, so carry an SMB and ask the crew how it is running before you enter. The boat may sit over the shallow reef or over the site as the wind shifts. In a strong flow stay on the mooring line and end the dive there; do not enter the notch to escape current.",
      divePlan:
        "Swim along the top of the wall to the indentation. With little current you can go out along the wall no deeper than 30 m (100 ft) and around the outer ridge, then return over the reef top. The wall drops away well past the plan, and the floor of the indentation lies below the plan floor too: stay above 30 m (100 ft). One listing mentions a tunnel on this wall in about 27 m (90 ft). It is overhead; stay out. Medical care is far from the water on San Salvador, so confirm the boat’s oxygen and the emergency plan before boarding.",
      fitTone: "demanding",
      fitNote:
        "A varied wall with a current that comes and goes. For divers who read moving water and hold a depth beside a drop-off.",
      // A wall that falls past recreational depth with frequent current: Advanced Open Water, with
      // the 30 m plan floor and an SMB. The shallow ridge alone is an Open Water dive a shop can open.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Pillar coral",
          kind: "reefFormation",
          note: "A pillar coral on the shallow ridge north of the mooring, in about 15 m (50 ft).",
        },
      ],
      creatureSlugs: ["schoolmaster-snapper", "pillar-coral", "common-sea-fan", "sea-plume"],
    },
  },
  // Denominator row: Dean's Blue Hole
  {
    slug: "deans-blue-hole",
    version: 1,
    area: "bahamas-out-islands",
    sources: [
      "https://web.archive.org/web/20110105055304/http://www.stellamarisresort.com/bahamas-diving-locations.asp",
      "https://sailabacos.com/bahamas/dive-sites/deans-blue-hole",
      "https://en.wikipedia.org/wiki/Dean%27s_Blue_Hole",
      "https://www.zentacle.com/Beach/2872/deans-blue-hole",
    ],
    briefing: {
      name: "Dean’s Blue Hole",
      locationName: "Clarence Town, Long Island",
      // The mouth of the hole: 23.1064, -75.0087 on one listing, 23.1063, -75.0087 in
      // OpenStreetMap and 23.1064, -75.0086 on a second listing, west of Clarence Town.
      forecastLatitude: 23.1064,
      forecastLongitude: -75.0087,
      description:
        "A circular sinkhole in a sheltered bay, about 30 m wide at the surface and widening below into a bell-shaped cavern. The hole is 202 m deep in all, far past recreational limits, and it is among the deepest known blue holes and a freediving venue, with a white-sand beach beside it. The plan stops at 10 m (33 ft), well above the halocline. The bell-shaped cavern below the rim is overhead; stay out.",
      marineLife: "Groupers · turtles · southern stingrays · juvenile reef fish",
      marineLifeDescription:
        "The shallow rim and sand around it hold young reef fish, stingrays and the odd turtle. Look along the limestone walls for sponges and small corals.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 40,
      currentNote:
        "The bay is sheltered and calm, and no current is documented. Entry is from a sand beach, and the bottom drops away within a few kicks of the shore. The halocline is reported between 15 and 20 m and its depth varies with rain; the water below it holds little oxygen. Do not dive while a freediving event or training session is running; ask the guide first.",
      divePlan:
        "Enter from the beach and swim to the edge of the hole. Descend along the wall. The floor is 10 m (33 ft), shallower if the guide reports the layer higher; ask the guide where the layer is today before you enter. Ascend along the wall, not up the middle. The hole is far deeper than any recreational plan, so never follow it down. Dive with a guide who knows the site. There is no dive center on the beach, so rentals, fills and a guide come from an operator elsewhere on the island. Medical care is far from this bay, so confirm the guide’s oxygen and the emergency plan before you go.",
      fitTone: "demanding",
      fitNote:
        "The depth below you is far beyond recreational limits and the water changes with depth. For confident divers with a guide, holding a plan well above the bottom.",
      // Gate: Advanced Open Water and Deep. The hole falls about 200 m with nothing to stop a diver
      // on the way, so maxDepthMeters is capped at the 40 m recreational limit (as the catalog caps
      // any structure that passes it) and the gate covers it. The plan itself stops at 10 m, 5 m
      // above the shallowest halocline reported (15 to 20 m), and the dive is guide-only.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["nassau-grouper", "hawksbill-turtle", "southern-stingray", "sergeant-major"],
    },
  },
  // Denominator row: Shark Reef (Stella Maris)
  {
    slug: "shark-reef-stella-maris",
    version: 1,
    area: "bahamas-out-islands",
    sources: [
      "https://web.archive.org/web/20110105055304/http://www.stellamarisresort.com/bahamas-diving-locations.asp",
      "https://sailabacos.com/bahamas/dive-sites/shark-reef-long-island",
    ],
    briefing: {
      name: "Shark Reef",
      locationName: "Stella Maris, Long Island",
      // Approximate pin: both pages tie the site to Stella Maris, on Long Island’s calm west
      // (lee) side. The pin is in the water about 1.5 km off the Stella Maris shore (OpenStreetMap
      // shows water). The Sail Abacos point (23.5450, -75.2800) is 2.6 km south, so the two do not
      // agree. Good to about 2 km. A shop edits it.
      forecastLatitude: 23.568,
      forecastLongitude: -75.28,
      description:
        "A shark dive in about 9 m (30 ft) of calm lee-side water, run by a resort on the island since the 1970s. Divers settle in a sandy arena ringed by coral heads while Caribbean reef sharks, a dozen or two at a time, gather around them. The sharks come for prepared food that only the crew handles.",
      marineLife: "Caribbean reef sharks · jacks · barracuda · stingrays",
      marineLifeDescription:
        "Reef sharks circle the arena at close range. Groupers, jacks, barracuda and stingrays share the sand around the coral heads.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 9,
      currentNote:
        "Current not documented; ask the crew on the day. The site is on the lee side and the sand bottom can cloud when the sharks stir it up. Shark numbers vary with the season and the day, and the west-facing site can turn choppy during strong fronts.",
      divePlan:
        "Settle where the guide positions the group at the edge of the reef and stay put through the feed. Do not carry or handle food. Keep nothing dangling from your gear, never chase, touch or reach for a shark, stay together as one group and follow the crew’s briefing at every step. Sharks gather most from November to May; in summer they spread out and the dive is quieter, and a sighting is never a promise. Staff confirm the diver’s log before boarding. Medical care is far from the water on Long Island, so confirm the boat’s oxygen and the emergency plan before boarding.",
      // Feeding: the sources disagree. The resort's own page describes sharks competing for prepared
      // food; Sail Abacos says most dives rely on natural behavior. The conservative reading is a
      // provisioned dive run to the crew's protocol. Season (November to May peak) is from the
      // Sail Abacos page.
      fitTone: "unknown",
      fitNote:
        "A shallow, controlled shark dive for divers comfortable in open water. The guide sets the rules and the group keeps to them.",
      creatureSlugs: ["caribbean-reef-shark", "bar-jack", "great-barracuda", "southern-stingray"],
    },
  },
  // Denominator row: Conception Island Wall
  {
    slug: "conception-island-wall",
    version: 1,
    area: "bahamas-out-islands",
    sources: [
      "https://web.archive.org/web/20110105055304/http://www.stellamarisresort.com/bahamas-diving-locations.asp",
      "https://www.capesantamaria.com/activities",
      "https://sailabacos.com/bahamas/dive-sites/conception-island-wall",
    ],
    briefing: {
      name: "Conception Island Wall",
      locationName: "Conception Island National Park",
      // Approximate pin: three pages tie the wall to Conception Island, and one places it along
      // the island’s western edge. The pin is in the water about 600 m off the west shore
      // (OpenStreetMap shows water), good to about 2 km. A shop edits it to its mooring.
      forecastLatitude: 23.8335,
      forecastLongitude: -75.134,
      description:
        "A coral wall about 2.4 km (1.5 mi) long on the west side of an uninhabited national park island. The wall begins around 14 m (45 ft) with big coral heads and elkhorn coral, and falls away from there to depths far beyond recreational limits.",
      marineLife: "Reef sharks · green turtles · stingrays · blue parrotfish",
      marineLifeDescription:
        "Reef sharks and turtles patrol the wall. Look for angelfish and stingrays on the top of the reef.",
      difficultyLevel: "advanced",
      depthMinMeters: 14,
      maxDepthMeters: 30,
      currentNote:
        "Current is generally mild by one account, but the wall faces open water, so carry an SMB and ask the crew how it is running. One mooring sits by a cave system and tunnel: overhead; stay out.",
      divePlan:
        "Moorings are provided; the island is a national park, so no anchoring and nothing is collected, and it is an hour or more by boat from Long Island. Go down the mooring to the wall edge, drift along the wall no deeper than 30 m (100 ft), and come back up over the reef top to the mooring line with reserve gas. The wall falls away far beyond the plan. Medical care is far away at this remote island, so confirm the boat’s oxygen and the emergency plan before boarding.",
      fitTone: "demanding",
      fitNote:
        "A remote wall on a long boat ride, with open water beside it. For divers comfortable holding a depth on a wall.",
      // The wall drops past recreational depth and the plan floor is 30 m, so the gate is Advanced
      // Open Water without the Deep specialty. The site is remote: long boat ride, far from care.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "green-sea-turtle",
        "southern-stingray",
        "blue-parrotfish",
        "elkhorn-coral",
        "queen-angelfish",
      ],
    },
  },
];
