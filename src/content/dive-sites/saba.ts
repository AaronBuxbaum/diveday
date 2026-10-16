// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Saba. */
export const SABA: DiveSiteTemplate[] = [
  {
    slug: "third-encounter-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-2-third-encounter",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Third Encounter",
      locationName: "The Pinnacles, Saba",
      // Position: mooring 1 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6317,
      forecastLongitude: -63.2746,
      description:
        "The eastern end of a horseshoe-shaped seamount. The mooring sits on a coral plateau at about 30 m, and a short swim into the blue reaches the Eye of the Needle, a spire that tops out near 27 m.",
      marineLife: "Caribbean reef sharks · yellowtail snapper · creole wrasse · nurse sharks",
      marineLifeDescription:
        "Reef sharks and snappers work the plateau edge, where plankton-rich water arrives, and creole wrasse school around the Needle. Sleeping nurse sharks turn up on the way back across the seamount.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "27–35 m (90–110 ft)",
      maxDepthMeters: 35,
      currentNote:
        "Open ocean, washed by the deep currents that feed the pinnacles. The strength changes by the day, so carry an SMB and keep the group together.",
      divePlan:
        "Down the mooring to the plateau at about 30 m, along the outcrops, and out to the Needle only with gas and the guide’s say-so, no deeper than 35 m. Stop on the mooring line or an SMB in open water. Staff confirm the diver’s log before boarding. The site is well offshore; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "Deep, open-water and remote. For divers with the cards and the recent dives for it.",
      // Mooring and maximum depth are past 30 m, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Eye of the Needle",
          kind: "reefFormation",
          note: "A spire rising from deep water just off the plateau, topping out near 27 m. Reached by a short swim across open water.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-shark",
        "yellowtail-snapper",
        "creole-wrasse",
        "nurse-shark",
        "nassau-grouper",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "twilight-zone-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-3-twiwlight-zone",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Twilight Zone",
      locationName: "The Pinnacles, Saba",
      // Position: mooring 2 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6328,
      forecastLongitude: -63.273,
      description:
        "A seamount reef that plunges away at its edge. Rocky outcrops with tops near 24 m give the dive its bottom time, and nurse sharks rest in the sand under the overhangs. Do not go under the overhangs, and watch the sharks without approaching them.",
      marineLife: "Tiger grouper · Caribbean reef sharks · nurse sharks · sea slugs",
      marineLifeDescription:
        "Groupers and circling reef sharks hold along the outcrops, with smaller animals such as sea slugs in the cracks.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "24–35 m (80–110 ft)",
      maxDepthMeters: 35,
      currentNote:
        "Open ocean, washed by the deep currents that feed the pinnacles. The strength changes by the day, so carry an SMB and keep the group together.",
      divePlan:
        "Down the mooring to the outcrops, along their tops, and back to the mooring, never over the drop-off and no deeper than 35 m. Stop on the mooring line or an SMB in open water. Staff confirm the diver’s log before boarding. The site is well offshore; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "A deep seamount dive where the reef edge falls away. Hold the plan depth; the drop does not forgive drift.",
      // The reef falls away below the plan, whose floor is 35 m, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Rocky outcrops",
          kind: "reefFormation",
          note: "Shallower peaks near 24 m that give extra bottom time before the drop-off.",
        },
      ],
      creatureSlugs: [
        "tiger-grouper",
        "yellowfin-grouper",
        "caribbean-reef-shark",
        "nurse-shark",
        "creole-wrasse",
        "orange-elephant-ear-sponge",
      ],
    },
  },
  {
    slug: "outer-limits-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-4-outer-limits",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Outer Limits",
      locationName: "The Pinnacles, Saba",
      // Position: mooring 3 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6332,
      forecastLongitude: -63.273,
      description:
        "A narrow ridge on the seamount. Swim toward its northeast tip and the ridge ends in a vertical drop-off into deep water.",
      marineLife: "Creole wrasse · chromis · black jacks · green moray eels",
      marineLifeDescription:
        "Chromis and creole wrasse school over the ridge, with black jacks hunting and green morays in the crevices. In the right season, juvenile trunkfish and spotted drums turn up.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "29–35 m (95–110 ft)",
      maxDepthMeters: 35,
      currentNote:
        "Open ocean, washed by the deep currents that feed the pinnacles. The strength changes by the day, so carry an SMB and keep the group together.",
      divePlan:
        "Down the mooring to the ridge, out along it to the tip, and back with reserve gas, no deeper than 35 m and never over the drop-off. Stop on the mooring line or an SMB in open water. Staff confirm the diver’s log before boarding. The site is well offshore; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "A deep ridge that ends in open water. For divers with the cards and a steady depth hold.",
      // The ridge ends in a vertical drop past the plan, whose floor is 35 m, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "creole-wrasse",
        "brown-chromis",
        "bar-jack",
        "green-moray",
        "smooth-trunkfish",
        "spotted-drum",
      ],
    },
  },
  // Sea Saba's heading gives 35 m, but its text puts the lower pinnacle top at 120 ft; the deeper figure is used.
  {
    slug: "mt-michel-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-1-mt-michel",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Mt. Michel",
      locationName: "The Pinnacles, Saba",
      // Position: mooring 27 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6281,
      forecastLongitude: -63.2738,
      description:
        "Two pinnacles south of the main plateau, found in 1999. The shallower peak has a steep wall on one side and a gentler slope down to the deeper peak at 37 m, with large ledges built by star and plate corals.",
      marineLife: "Hawksbill turtles · sunshinefish · star corals · passing game fish",
      marineLifeDescription:
        "A resident hawksbill favors the ledges. Sunshinefish, usually a deeper-water species, are regularly seen here.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "30–37 m (100–120 ft)",
      maxDepthMeters: 37,
      currentNote:
        "Open ocean, washed by the deep currents that feed the pinnacles. The strength changes by the day, so carry an SMB and keep the group together.",
      divePlan:
        "Down the mooring to the higher peak, along its ledges and across the slope toward the second peak, no deeper than 37 m, then back to the mooring. Stop on the mooring line or an SMB in open water. Staff confirm the diver’s log before boarding. The site is well offshore; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "Two deep peaks in open water. For divers with the cards and the recent dives for it.",
      // Depth: Sea Saba's heading gives 35 m but its text puts the second pinnacle top at 120 ft (37 m), and the park's mooring list gives 100 ft; the deepest figure is used. Maximum depth is past 30 m, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "hawksbill-turtle",
        "sunshinefish",
        "great-star-coral",
        "giant-barrel-sponge",
        "yellowtail-snapper",
        "bar-jack",
      ],
    },
  },
  {
    slug: "shark-shoals-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-5-oshark-shoals",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Shark Shoals",
      locationName: "The Pinnacles, Saba",
      // Position: mooring 4 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6458,
      forecastLongitude: -63.265,
      description:
        "An isolated pinnacle about half a mile east of Wells Bay. The main peak tops out near 27 m and a second set of outcrops sits near 37 m, rising from very deep water.",
      marineLife: "Caribbean reef sharks · jacks · sponges · wahoo",
      marineLifeDescription:
        "Sharks, big sponge formations and plenty of reef fish crowd the peaks, and wahoo and mahi-mahi pass near the surface at the safety stop.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "27–40 m (90–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Open ocean, washed by the deep currents that feed the pinnacles. The strength changes by the day, so carry an SMB and keep the group together.",
      divePlan:
        "Down the mooring to the main peak near 27 m. The outcrops near 37 m are optional, reached only with gas and the guide’s say-so, and the plan’s floor at the outcrop tops is 37 m. Make a long stop on the mooring line or an SMB. Sharks: stay put, keep nothing dangling, do not chase or touch, and follow the crew’s briefing. Sightings are never guaranteed. Staff confirm the diver’s log before boarding. The site is well offshore; confirm the boat’s oxygen and plan.",
      fitTone: "demanding",
      fitNote:
        "Deep, open-water and remote, with sharks close by. For divers with the cards and the recent dives for it.",
      // Mooring and maximum depth are past 30 m, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "caribbean-reef-shark",
        "giant-barrel-sponge",
        "horse-eye-jack",
        "bar-jack",
        "yellowtail-snapper",
        "creole-wrasse",
      ],
    },
  },
  {
    slug: "diamond-rock-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-6-diamond-rock",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Diamond Rock",
      locationName: "Wells Bay, Saba",
      // Position: mooring 6 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6472,
      forecastLongitude: -63.2567,
      description:
        "Saba’s best-known landmark rock, standing on a flat sandy floor at 24 m. A canyon on the northeast side lets the dive spiral upward, with stingrays and furry sea cucumbers in the sand below.",
      marineLife: "Southern stingrays · horse-eye jacks · chain morays · octopus",
      marineLifeDescription:
        "Stingrays hover over the gray sand, jacks school around the rock, and chain morays and juvenile angelfish live in its cracks.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 24 m (80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Strong currents are reported around the rock. Carry an SMB, plan to drift, and keep the boat’s position in mind on the way up.",
      divePlan:
        "Down the mooring, around the base of the rock, then up the northeast canyon in a slow spiral. The plan is a drift: send up an SMB and ascend for pickup by the boat, with reserve gas in hand. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A shallow dive in water that can run hard. For divers comfortable with current and an SMB.",
      // Gated at Advanced Open Water for current: the marine park warns of strong currents at this rock. Depth alone (24 m) would not gate it.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Diamond Rock",
          kind: "reefFormation",
          note: "A semi-submerged rock that stands on the sand at 24 m, circled low and then spiraled.",
        },
      ],
      creatureSlugs: [
        "southern-stingray",
        "horse-eye-jack",
        "chain-moray",
        "atlantic-common-octopus",
        "caribbean-reef-shark",
        "black-durgon",
      ],
    },
  },
  {
    slug: "man-o-war-shoals-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-7-man-owar-shoals",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Man o’ War Shoals",
      locationName: "Wells Bay, Saba",
      // Position: mooring 7 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6467,
      forecastLongitude: -63.2553,
      description:
        "A steep rock structure just east of Diamond Rock, standing on sand at 22 m with twin peaks that rise to within about 5 m of the surface. A slow spiral between the peaks fills the dive.",
      marineLife: "Black coral · sergeant majors · sand tilefish · Atlantic spadefish",
      marineLifeDescription:
        "Dense, varied reef life covers the rock, from black coral to schools of sergeant majors. Spadefish, rarely seen on reefs, are reported here.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "intermediate",
      depthRange: "5–22 m (15–70 ft)",
      maxDepthMeters: 22,
      currentNote:
        "Current is not documented for the Shoals, but the marine park warns of strong currents at Diamond Rock next door. Carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring, around the base of the rock, then upward between the two peaks in a figure eight, and back up the line. Stop on the mooring line or an SMB, not on the rock. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A shallow dive in water that shares Diamond Rock’s reputation for current. For divers comfortable with an SMB.",
      // Gated at Advanced Open Water for current, the conservative reading: the park warns of strong currents at Diamond Rock, whose water this shoal shares. Depth alone (22 m) would not gate it.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Twin peaks",
          kind: "reefFormation",
          note: "Two peaks rising to within about 5 m of the surface, with the sand at the foot of the rock far below.",
        },
      ],
      creatureSlugs: [
        "black-coral",
        "sergeant-major",
        "sand-tilefish",
        "atlantic-spadefish",
        "caribbean-reef-shark",
        "great-barracuda",
      ],
    },
  },
  {
    slug: "ottos-limits-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-8-otto-limits",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Otto’s Limits",
      locationName: "Wells Bay, Saba",
      // Position: mooring 8 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6455,
      forecastLongitude: -63.2534,
      description:
        "A shallow rock site that came into use with the park’s first moorings, named for a new divemaster who was not yet ready for the deeper pinnacle. Rock faces shelter small animals, and turtles live here.",
      marineLife: "Hawksbill turtles · green turtles · roughhead blennies · bearded fireworms",
      marineLifeDescription:
        "Blennies and fireworms sit in the rock faces, with resident hawksbill and green turtles around the site.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "beginner",
      depthRange: "10–18 m (30–55 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "One of Saba’s shallowest boat dives, made for divers still building experience.",
      creatureSlugs: [
        "hawksbill-turtle",
        "green-sea-turtle",
        "roughhead-blenny",
        "bearded-fireworm",
        "spotted-moray",
        "great-barracuda",
      ],
    },
  },
  {
    slug: "torrens-point-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-9-torrens-point",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Torrens Point",
      locationName: "Wells Bay, Saba",
      // Position: mooring 9 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6433,
      forecastLongitude: -63.2533,
      description:
        "A calm, protected site in the lee of the point. Boulders just north of the point hold small caves; they are overhead, so stay out. The whole dive can stay in shallow water.",
      marineLife: "Spiny lobsters · flatworms · great barracuda · blue tang",
      marineLifeDescription:
        "Lobsters and flatworms fill the boulder gaps, with barracuda that come in close and schools of blue tang and goatfish over the area.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "beginner",
      depthRange: "7–16 m (25–50 ft)",
      maxDepthMeters: 16,
      currentNote:
        "Calm and protected in the lee of the point. Surge is not documented; ask the crew on the day. The small caves and the tunnel through the rock are overhead; stay out.",
      fitTone: "welcoming",
      fitNote: "A sheltered, shallow dive that suits snorkelers and new divers.",
      // The caves and the tunnel here are overhead. They are described as something to avoid, never as part of the plan, so the site carries no cavern gate.
      creatureSlugs: [
        "spiny-lobster",
        "great-barracuda",
        "blue-tang",
        "spotted-goatfish",
        "queen-parrotfish",
        "sergeant-major",
      ],
    },
  },
  {
    slug: "customs-house-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-11-customs-house",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Customs House",
      locationName: "Ladder Bay, Saba",
      // Position: mooring 11 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6319,
      forecastLongitude: -63.2582,
      description:
        "A reef shaped like a loaf of bread, starting on a sandy slope and tapering into deeper water, with drooping sponges and gorgonians on the way down. Black coral grows on the deeper reef, and the old anchors of cargo boats lie coral-encrusted nearby.",
      marineLife: "Garden eels · southern stingrays · Caribbean reef sharks · black coral",
      marineLifeDescription:
        "Garden eels and stingrays work the sand, with stingray cleaning stations on the reef and reef sharks passing in the blue.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "22–38 m (70–120 ft)",
      maxDepthMeters: 38,
      currentNote: "Current not documented; carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring to the sand, along the reef in multiple levels, no deeper than 38 m, and back up the slope with reserve gas. Dive the anchors and cleaning stations in the shallower part. Stop on the mooring line or an SMB in open water. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "A slope that keeps falling away; the plan stops at 38 m.",
      // Mooring and maximum depth are past 30 m, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The loaf",
          kind: "reefFormation",
          note: "A rectangular reef that slopes from the sand into deeper water.",
        },
      ],
      creatureSlugs: [
        "garden-eel",
        "southern-stingray",
        "caribbean-reef-shark",
        "black-coral",
        "common-sea-fan",
        "lavender-rope-sponge",
      ],
    },
  },
  {
    slug: "porites-point-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-12-porites-point",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Porites Point",
      locationName: "Ladder Bay, Saba",
      // Position: mooring 12 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6293,
      forecastLongitude: -63.2589,
      description:
        "Porites coral boulders have grown into a continuous reef with sandy alleys, also known as Lou’s Ladder. Deeper along the site a drop-off turns almost wall-like.",
      marineLife: "Spiny lobsters · spotted morays · burrfish · yellowhead jawfish",
      marineLifeDescription:
        "Ledges and crevices shelter lobsters, morays and burrfish, and the sand alleys hold jawfish, flounders and sea cucumbers.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "12–35 m (40–110 ft)",
      maxDepthMeters: 35,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the porites reef, along the alleys, and out to the top of the drop-off only if gas allows, no deeper than 35 m. Back to the mooring with reserve gas. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "Easy at the mooring, serious at the wall. Dive it to the plan depth.",
      // The drop-off is wall-like and the plan holds 35 m, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The drop-off",
          kind: "reefFormation",
          note: "A wall-like drop-off in the deeper part of the site; the plan stops at 35 m.",
        },
      ],
      creatureSlugs: [
        "spiny-lobster",
        "spotted-moray",
        "yellowhead-jawfish",
        "peacock-flounder",
        "mustard-hill-coral",
        "porcupinefish",
      ],
    },
  },
  {
    slug: "babylon-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-13-babylon",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Babylon",
      locationName: "Ladder Bay, Saba",
      // Position: mooring 13 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6285,
      forecastLongitude: -63.2596,
      description:
        "Overhangs and lava flows cut by sand chutes (do not go under the overhangs), with deepwater sea fans on the ledges as the dive heads seaward. Toward shore the coral-encrusted boulders grow larger, and patches of warm sand are a feature of Saba’s volcano.",
      marineLife: "Caribbean reef sharks · hawksbill turtles · glassy sweepers · horse-eye jacks",
      marineLifeDescription:
        "Sweepers and clinging crabs shelter under the overhangs, while turtles, jacks and nurse sharks pass through the site.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "intermediate",
      depthRange: "15–30 m (45–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Current not documented; ask the crew on the day. The cave under the overhangs is overhead; stay out.",
      divePlan:
        "Down the mooring to the boulders and ledges, along them no deeper than 30 m, and back up the line with reserve gas. The cave under the overhangs is overhead; stay out. If sharks come by: stay put, keep nothing dangling, do not chase or touch, stay together and follow the crew's briefing. Sightings are not promised. Staff confirm the diver's log before boarding.",
      fitTone: "unknown",
      fitNote:
        "A moderate-depth dive with overhangs to look at from outside. Ask the crew about the day’s water.",
      // The overhangs hide a cave, which is overhead and not part of the dive, so the site carries no cavern gate.
      creatureSlugs: [
        "caribbean-reef-shark",
        "hawksbill-turtle",
        "glassy-sweeper",
        "horse-eye-jack",
        "nurse-shark",
        "channel-clinging-crab",
      ],
    },
  },
  {
    slug: "ladder-labyrinth-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-14-ladder-labyrinth",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Ladder Labyrinth",
      locationName: "Ladder Bay, Saba",
      // Position: mooring 14 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6262,
      forecastLongitude: -63.2601,
      description:
        "Ridges of coral and rock about 3 m high lie just seaward of the mooring and give the site its name. Farther east they open into lava flows and sand chutes, and sulfur-colored sand near the mooring is warm to the touch.",
      marineLife: "Filefish · chromis · schoolmaster snapper · tarpon",
      marineLifeDescription:
        "Shrimp, crabs and lobsters fill the ridges, and the sand alleys hold jawfish, blennies and lancer dragonets. Tarpon share the safety stop.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "intermediate",
      depthRange: "12–24 m (40–80 ft)",
      maxDepthMeters: 24,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote:
        "A maze of ridges at moderate depth, steady for a diver who watches the way back to the mooring.",
      creatureSlugs: [
        "schoolmaster-snapper",
        "yellowhead-jawfish",
        "tarpon",
        "spiny-lobster",
        "banded-coral-shrimp",
        "brown-chromis",
        "lancer-dragonet",
      ],
    },
  },
  {
    slug: "hot-springs-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-16-hot-springs",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Hot Springs",
      locationName: "Ladder Bay, Saba",
      // Position: mooring 15 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6246,
      forecastLongitude: -63.2596,
      description:
        "Hot water seeps through vents in the seabed here, a reminder that Saba’s volcano is dormant, not extinct. Coral heads on sand lie south of the mooring and coral-covered boulders to the north, with a large old anchor on the southern route.",
      marineLife: "Nurse sharks · southern stingrays · garden eels · green turtles",
      marineLifeDescription:
        "A resident nurse shark, stingrays and garden eels share the site with turtles grazing in the seagrass. Watch the shark from a distance; do not chase or touch. Night dives need staff approval and a briefed plan.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "intermediate",
      depthRange: "12–24 m (40–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Current not documented; ask the crew on the day. Hot water seeps from vents in the seabed, so keep hands out of the sand.",
      divePlan:
        "Down the mooring, then south over the coral heads to the anchor and back inshore, or north through the boulders for a shallower dive.",
      fitTone: "welcoming",
      fitNote:
        "Two routes from one mooring, so the dive can be set shallower or deeper to the diver.",
      landmarks: [
        {
          name: "The old anchor",
          kind: "reefHistory",
          note: "A huge anchor, one of several at the site, that marks the turn for home on the southern route.",
        },
      ],
      creatureSlugs: [
        "nurse-shark",
        "southern-stingray",
        "garden-eel",
        "green-sea-turtle",
        "peacock-flounder",
        "atlantic-common-octopus",
      ],
    },
  },
  {
    slug: "rays-n-anchors-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-17-rays-n-anchors",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Rays ’n’ Anchors",
      locationName: "Ladder Bay, Saba",
      // Position: mooring 16 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.623,
      forecastLongitude: -63.2596,
      description:
        "Old anchors left behind long ago are now grown into the reef; the way to find them is to look for unusually straight lines on the boulders. Stingrays roam the sand between the boulders.",
      marineLife: "Southern stingrays · spotted morays · lobsters · angelfish",
      marineLifeDescription:
        "Southern stingrays and their roughtail cousins cruise the site, with morays and lobsters in the reef.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "beginner",
      depthRange: "11–18 m (35–60 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A shallow, slow dive that rewards looking closely at the boulders.",
      landmarks: [
        {
          name: "The anchors",
          kind: "reefHistory",
          note: "Several anchors from past cargo boats, fully grown into the boulders.",
        },
      ],
      creatureSlugs: [
        "southern-stingray",
        "spotted-moray",
        "spiny-lobster",
        "queen-angelfish",
        "french-angelfish",
        "blue-tang",
        "roughtail-stingray",
      ],
    },
  },
  {
    slug: "tent-reef-wall-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-19-tent-reef-wall",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Tent Reef Wall",
      locationName: "Tent Reef, Saba",
      // Position: mooring 17 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6173,
      forecastLongitude: -63.2587,
      description:
        "A multilevel wall with rich color and looming overhangs (do not go under them), reached from a shallow mooring. The route runs out along the wall at 30 m and back along an overhanging ledge at about 18 m, among encrusting sponges.",
      marineLife: "Elephant ear sponges · black coral · snappers · tubular sponges",
      marineLifeDescription:
        "Tube and elephant ear sponges and black coral dominate the steep wall, with large snappers sheltering under the ledge.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "7–30 m (20–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Fort Bay harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring, out along the wall no deeper than 30 m, and back along the overhanging ledge, then up the mooring with reserve gas. The pinnacles a short swim off the wall are outside this plan.",
      fitTone: "demanding",
      fitNote: "A deep wall beside a busy harbor. For divers who hold a plan depth.",
      // Gated at Advanced Open Water for the wall: it is a drop-off held at the plan's 30 m floor, and the pinnacles beyond it are not part of the plan.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "black-coral",
        "yellowtail-snapper",
        "branching-tube-sponge",
        "caribbean-reef-shark",
        "common-sea-fan",
      ],
    },
  },
  {
    slug: "tent-reef-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-20-tent-reef",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Tent Reef",
      locationName: "Tent Reef, Saba",
      // Position: mooring 18 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6163,
      forecastLongitude: -63.2585,
      description:
        "A mini-wall, huge boulders and a coral garden, with sponges and soft coral along the drop-off and a sand slope beyond it. It is one of Saba’s most popular dives. Night dives need staff approval and a briefed plan.",
      marineLife: "Black jacks · green turtles · garden eels · southern stingrays",
      marineLifeDescription:
        "Garden eels and stingrays sit on the sand slope, with black jacks or barracuda around the boulders, and scorpionfish, frogfish and seahorses for those who look.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "intermediate",
      depthRange: "12–30 m (40–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Fort Bay harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current is not documented; ask the crew on the day. The archway at the base of the mini-wall is overhead; stay out.",
      divePlan:
        "Down the mooring, south to the drop-off in the coral garden, then east to the sand slope and back along the boulders, no deeper than 30 m. Stay out of the archway. Staff confirm the diver's log before boarding.",
      fitTone: "unknown",
      fitNote:
        "A varied dive with plenty to see above the arch. Ask the crew about the day’s water.",
      // The mini-wall base has an archway, which is overhead. It is not part of the plan, so the site carries no cavern gate.
      creatureSlugs: [
        "bar-jack",
        "green-sea-turtle",
        "garden-eel",
        "southern-stingray",
        "longsnout-seahorse",
        "spotted-scorpionfish",
      ],
    },
  },
  {
    slug: "tent-reef-deep-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-22-tent-reef-deep",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Tent Reef Deep",
      locationName: "Tent Reef, Saba",
      // Position: mooring 19 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6165,
      forecastLongitude: -63.2559,
      description:
        "A small, steep-sided patch reef at the end of the Tent Reef system, often combined with a visit to Tent Reef. The deeper reef holds black coral, snappers and creole wrasse, with garden eels and stingrays on the shallower sand.",
      marineLife: "Black coral · yellowtail snapper · creole wrasse · garden eels",
      marineLifeDescription:
        "Snappers and wrasse school over the deeper reef, and the shallower sand is home to garden eels, stingrays and jawfish.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "23–38 m (70–120 ft)",
      maxDepthMeters: 38,
      currentNote:
        "Fort Bay harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring, around the patch reef in levels, no deeper than 38 m, and back up the shallower coral garden with reserve gas. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "A deep patch reef that suits a diver with the depth card and good gas management.",
      // Mooring and maximum depth are past 30 m, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "black-coral",
        "yellowtail-snapper",
        "creole-wrasse",
        "garden-eel",
        "yellowhead-jawfish",
        "giant-anemone",
      ],
    },
  },
  {
    slug: "big-rock-market-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-25-big-rock-market",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Big Rock Market",
      locationName: "Windwardside, Saba",
      // Position: mooring 22 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6125,
      forecastLongitude: -63.2362,
      description:
        "Named for the island’s supermarket, which has a big rock outside, this Atlantic-side site has big rocks in the shallows. Uncommon highhats live around them, and barracuda and reef sharks are regular visitors.",
      marineLife: "Highhats · barracuda · Caribbean reef sharks · nurse sharks",
      marineLifeDescription:
        "Highhats, barracuda and a few reef sharks pass through, and the occasional nurse shark egg case turns up.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "intermediate",
      depthRange: "10–18 m (35–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Atlantic side: the marine park says diving here depends on the weather, and surf can close the site. Current is not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote: "Shallow, on the exposed Atlantic side. The weather and the crew pick the day.",
      // Gated at Advanced Open Water for Atlantic exposure, consistent with the other windward sites; depth (18 m) alone would not gate it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "highhat",
        "great-barracuda",
        "caribbean-reef-shark",
        "nurse-shark",
        "elkhorn-coral",
        "spotted-moray",
      ],
    },
  },
  {
    slug: "hole-in-the-corner-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-27-hole-in-the-corner",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Hole in the Corner",
      locationName: "Windwardside, Saba",
      // Position: mooring 24 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6177,
      forecastLongitude: -63.2264,
      description:
        "Large coral-encrusted boulders lead to a sand bottom at about 23 m, with hard and soft corals behind schools of blue tang and chubs. Elkhorn coral near the end of the dive shelters crabs and blennies.",
      marineLife: "Blue tang · Bermuda chub · spotted eagle rays · bearded fireworms",
      marineLifeDescription:
        "Tang and chubs school over the boulders. A spotted eagle ray sometimes passes in the blue.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "intermediate",
      depthRange: "12–26 m (40–85 ft)",
      maxDepthMeters: 26,
      currentNote:
        "Atlantic side: the marine park says diving here depends on the weather. Current is not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote: "A moderate-depth dive on the exposed side. The weather and the crew pick the day.",
      // Gated at Advanced Open Water for Atlantic exposure, consistent with the other windward sites; depth (26 m) alone would not gate it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "blue-tang",
        "bermuda-chub",
        "spotted-eagle-ray",
        "bearded-fireworm",
        "elkhorn-coral",
        "roughhead-blenny",
      ],
    },
  },
  {
    slug: "core-gut-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-29-core-gut",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Core Gut",
      locationName: "Windwardside, Saba",
      // Position: mooring 25 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6311,
      forecastLongitude: -63.2176,
      description:
        "Mushroom-shaped plate corals and lettuce corals shape the seascape. A northern route runs along a deeper wall, a southern route crosses a steep slope, and elkhorn coral heads sit under the boat at the end.",
      marineLife: "Great barracuda · cero · queen angelfish · hawksbill turtles",
      marineLifeDescription:
        "Barracuda and cero pass along the wall, with queen angelfish, stingrays and hawksbills on the slope.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "advanced",
      depthRange: "12–35 m (40–120 ft)",
      maxDepthMeters: 35,
      currentNote:
        "Atlantic side: the marine park says diving here depends on the weather, and surf can break against the wall above the site. Current is not documented; carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring, then the shallower southern slope, or north along the wall no deeper than 35 m, and back to the elkhorn heads under the boat. Stop on the mooring line or an SMB in open water. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A wall on the exposed side of the island. For divers with the depth card and a calm day.",
      // The northern route follows a wall deeper than 30 m, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "great-barracuda",
        "cero",
        "queen-angelfish",
        "southern-stingray",
        "hawksbill-turtle",
        "elkhorn-coral",
      ],
    },
  },
  {
    slug: "green-island-saba",
    version: 1,
    area: "saba",
    sources: [
      "https://sabapark.org/maps/dive_moorings.kml",
      "https://web.archive.org/web/2024/https://www.seasaba.com/saba-31-green-island",
      "https://www.seasaba.com/sabas-dive-sites",
      "https://sabapark.org/saba-national-marine-park/dive-sites-dive-operators/",
    ],
    briefing: {
      name: "Green Island",
      locationName: "Windwardside, Saba",
      // Position: mooring 26 on the Saba Conservation Foundation's mooring list (sabapark.org KML).
      forecastLatitude: 17.6484,
      forecastLongitude: -63.2308,
      description:
        "A small island pinnacle dived counterclockwise, with a grove of gorgonians and a small colony of black coral. A large anchor from the days of sulfur mining lies in the sand near the end of the dive.",
      marineLife: "Bermuda chub · queen angelfish · nurse sharks · parrotfish",
      marineLifeDescription:
        "Chubs school in numbers, parrotfish and queen angels graze the back of the island, and shy nurse sharks tuck among the barrel sponges.",
      conservationNote:
        "Saba National Marine Park circles the island, and dives are made on its numbered moorings. Visitor fees pay for the moorings and the park’s upkeep.",
      difficultyLevel: "intermediate",
      depthRange: "9–24 m (30–80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Dived only on a calm day or with wind from the south. Current is not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote:
        "A seldom-dived island pinnacle that needs a calm day. Ask the crew about the water.",
      // Gated at Advanced Open Water for Atlantic exposure on the windward side, consistent with the other windward sites; depth (24 m) alone would not gate it.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The sulfur-mining anchor",
          kind: "reefHistory",
          note: "A large anchor lying in the sand, left from the days of active sulfur mining.",
        },
      ],
      creatureSlugs: [
        "bermuda-chub",
        "queen-angelfish",
        "nurse-shark",
        "giant-barrel-sponge",
        "black-coral",
        "elkhorn-coral",
      ],
    },
  },
];
