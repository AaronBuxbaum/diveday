// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/**
 * St Kitts and Nevis. No agency publishes coordinates for these sites. River Taw and The Rock take
 * their pins from PADI Travel's site pages, each checked against a named landmark the
 * operators tie the site to; the rest are approximate pins placed in the water from the shore
 * landmark two operators tie each site to (OpenStreetMap names Fort Tyson, Frigate Bay, South Friars
 * Bay and Green Point), each says so in a comment.
 */
export const ST_KITTS_NEVIS: DiveSiteTemplate[] = [
  {
    slug: "river-taw",
    version: 1,
    area: "st-kitts-nevis",
    sources: [
      "https://prodiversstkitts.com/st-kitts-dive-sites/",
      "https://www.divekdc.com/dive-sites",
      "https://divenevis.com/wreck-dives/",
      "https://www.padi.com/dive-site/saint-kitts-nevis/river-taw/",
    ],
    briefing: {
      name: "MV River Taw",
      locationName: "Basseterre, St Kitts",
      // Approximate pin: PADI Travel's position for the wreck (17.28103, -62.69739), which agrees
      // with the operators placing it close to Fort Tyson (OpenStreetMap, 17.2862, -62.6960) and
      // the Basseterre harbor; the point is about 600 m from the fort, in the water. Depth: 8 m to
      // 14 m (KDC 25 ft to 45 ft; Pro Divers 40 ft; Dive Nevis 42 ft).
      forecastLatitude: 17.281,
      forecastLongitude: -62.6974,
      description:
        "A 44 m inter-island freighter that went down in 1981 and was broken in two by a hurricane in 1989. She lies on flat sand and sea grass near the harbor, with coral growth on her plates and a van and a bulldozer off to one side.",
      marineLife: "Yellowtail snapper · sergeant majors · barracuda · stingrays · lobster",
      marineLifeDescription:
        "Schools of snapper hang over the wreck, rays work the sand around it, and turtles and octopus use the gaps in the plating.",
      difficultyLevel: "beginner",
      depthRange: "8–14 m (25–45 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Basseterre harbor is close, so ships move nearby: no diving while a ship is under way, carry an SMB and listen for engines. Operators report no current. Stay outside the hull.",
      divePlan:
        "Down the line to the wreck, along the outside of the hull, and out to the bulldozer in the grass.",
      fitTone: "welcoming",
      fitNote: "Shallow, open and photogenic, with traffic in the harbor beside it.",
      creatureSlugs: [
        "yellowtail-snapper",
        "sergeant-major",
        "great-barracuda",
        "southern-stingray",
        "green-sea-turtle",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "talata-wreck",
    version: 1,
    area: "st-kitts-nevis",
    sources: [
      "https://prodiversstkitts.com/st-kitts-dive-sites/",
      "https://www.divekdc.com/dive-sites",
      "https://divenevis.com/wreck-dives/",
    ],
    briefing: {
      name: "MV Talata",
      locationName: "Basseterre, St Kitts",
      // Approximate pin: the operators put the wreck on a reef close to the harbor, where she sank
      // waiting outside Basseterre harbor; placed in the water about 1 km southeast of Port
      // Zante (OpenStreetMap, 17.2935, -62.7227), good to about 2 km. Depth: 35 ft to 55 ft (KDC),
      // 40 ft to 60 ft (Pro Divers), 55 ft (Dive Nevis); the deepest is used.
      forecastLatitude: 17.286,
      forecastLongitude: -62.716,
      description:
        "An old freighter that took on water while waiting outside Basseterre harbor, now broken up by storms and strung out in a long line across a reef. Parts of the bow and stern hold together, with engine blocks and steel plating between them.",
      marineLife: "Speckled moray · green moray · squirrelfish · barracuda · lobster",
      marineLifeDescription:
        "Morays look out from the plating everywhere, and squirrelfish crowd the shadows.",
      difficultyLevel: "beginner",
      depthRange: "11–18 m (35–60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "The wreck lies near the harbor anchorage, so ships move nearby: no diving while a ship is under way, carry an SMB and listen for engines. Current is minimal. Stay outside the hull; the plating is broken and sharp.",
      divePlan:
        "Down the line to the best-preserved section, along the line of wreckage, and finish over the reef.",
      fitTone: "welcoming",
      fitNote:
        "A shallow, broken wreck on a reef, close enough to the harbor to share it with ships.",
      creatureSlugs: [
        "spotted-moray",
        "green-moray",
        "squirrelfish",
        "great-barracuda",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "brimstone-shallows",
    version: 1,
    area: "st-kitts-nevis",
    sources: [
      "https://prodiversstkitts.com/st-kitts-dive-sites/",
      "https://www.divekdc.com/dive-sites",
      "https://mystkittsdivebuddy.com/reef-diving-sites-of-st-kitts/",
    ],
    briefing: {
      name: "Brimstone Shallows",
      locationName: "Basseterre, St Kitts",
      // Approximate pin: the operators place the reef system about 2 miles (3 km) offshore and
      // minutes from the harbor; placed about 500 m north of The Rock, which is part of it and takes
      // PADI Travel's position. The operators give 45 ft to 130 ft (15 m to 40 m). The Rock is the
      // canonical entry (the mooring and the sourced position); this row is the wider reef system
      // and carries the same depth and gate.
      forecastLatitude: 17.2685,
      forecastLongitude: -62.7175,
      description:
        "A large offshore reef system of soft and hard coral, flanked by sloping walls with deep water on both sides. Caribbean reef sharks are often seen, and schools of Creole wrasse and jacks work the edges.",
      marineLife: "Caribbean reef sharks · Creole wrasse · barracuda · turtles · lobster",
      marineLifeDescription:
        "Reef sharks are often seen; sightings vary. Wrasse and barracuda fill the water above the reef.",
      difficultyLevel: "advanced",
      depthRange: "15–40 m (50–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Open water about 3 km out, with mild current reported. Carry an SMB. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Down the mooring to the reef top at 15 m, across the reef and along the slope, and back up with reserve gas. The slope reaches 40 m; the plan holds 30 m unless the crew briefs a deeper profile for divers carrying the Deep specialty. If sharks come by: stay put, keep nothing dangling, do not chase or touch, stay together and follow the crew's briefing. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A reef two miles out, with a slope that reaches 40 m. For divers who hold depth well.",
      // The reef slopes to 40 m by the operators' numbers (RULE 1: a stated foot at 40 m), so
      // maxDepthMeters is 40 and the gate is Advanced Open Water with the Deep specialty; the open-water,
      // offshore setting also takes Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "caribbean-reef-shark",
        "creole-wrasse",
        "great-barracuda",
        "green-sea-turtle",
        "spiny-lobster",
        "horse-eye-jack",
      ],
    },
  },
  {
    slug: "the-rock-st-kitts",
    version: 1,
    area: "st-kitts-nevis",
    sources: [
      "https://prodiversstkitts.com/st-kitts-dive-sites/",
      "https://www.divekdc.com/dive-sites",
      "https://mystkittsdivebuddy.com/reef-diving-sites-of-st-kitts/",
      "https://www.padi.com/dive-site/saint-kitts-nevis/the-rock-2/",
    ],
    briefing: {
      name: "The Rock",
      locationName: "Basseterre, St Kitts",
      // Approximate pin: PADI Travel's position (17.26394, -62.71932), which agrees with the
      // operators placing it about 2 miles offshore and ten minutes from the harbor (about 3 km
      // from Port Zante, OpenStreetMap 17.2935, -62.7227). The Rock is the canonical entry for the
      // reef system (Brimstone Shallows is the wider row with the same depth and gate).
      forecastLatitude: 17.2639,
      forecastLongitude: -62.7193,
      description:
        "Part of Brimstone Shallows, named for the big volcanic boulder the mooring is tied to. Gently sloping walls fall away into deep water on both sides, with jacks and Creole wrasse around the top. Caribbean reef sharks are often seen.",
      marineLife: "Caribbean reef sharks · horse-eye jacks · Creole wrasse · eels · lobster",
      marineLifeDescription:
        "Schools of jacks and wrasse cover the reef top. Reef sharks are often seen on the slope below; sightings vary.",
      difficultyLevel: "advanced",
      depthRange: "15–40 m (50–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Open water about 3 km out, with mild current reported. Carry an SMB. Medical care is far; confirm the boat's oxygen and plan.",
      divePlan:
        "Down the mooring to the boulder and the reef top at 15 m, then down the slope, and back up with reserve gas. The slope reaches 40 m; the plan holds 30 m unless the crew briefs a deeper profile for divers carrying the Deep specialty. If sharks come by: stay put, keep nothing dangling, do not chase or touch, stay together and follow the crew's briefing. Staff confirm the diver's log before boarding.",
      fitTone: "demanding",
      fitNote:
        "A reef top at 15 m that invites you down a slope to 40 m. Watch the gauge and stay with the group.",
      // The slope drops to 40 m by the operators' numbers (RULE 1), so maxDepthMeters is 40 with
      // Advanced Open Water and the Deep specialty; the open-water, offshore setting also takes
      // Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "caribbean-reef-shark",
        "horse-eye-jack",
        "creole-wrasse",
        "green-moray",
        "spiny-lobster",
      ],
    },
  },
  {
    slug: "friars-bay-reef",
    version: 1,
    area: "st-kitts-nevis",
    sources: [
      "https://prodiversstkitts.com/st-kitts-dive-sites/",
      "https://www.divekdc.com/dive-sites",
      "https://mystkittsdivebuddy.com/reef-diving-sites-of-st-kitts/",
    ],
    briefing: {
      name: "Friars Bay Reef",
      locationName: "Friars Bay, St Kitts",
      // Approximate pin: the operators place the reef about a mile off South Friars beach (South
      // Friars Bay, OpenStreetMap 17.2705, -62.6706); placed in the water 1.5 km south-southwest of
      // it.
      forecastLatitude: 17.257,
      forecastLongitude: -62.674,
      description:
        "An easy reef about a mile off South Friars beach. Juvenile angelfish, big lobsters and spotted morays live on it, and stingrays lie in the sand along its edges.",
      marineLife: "Spotted morays · lobster · stingrays · turtles",
      marineLifeDescription:
        "Rays lie buried at the edge of the reef and turtles are common. The reef rewards a slow pass.",
      difficultyLevel: "beginner",
      depthRange: "11–18 m (35–60 ft)",
      maxDepthMeters: 18,
      currentNote: "Usually light; it can change, so carry an SMB.",
      divePlan:
        "Circle the reef once wide for the shape and once close for the lobsters and morays.",
      fitTone: "welcoming",
      fitNote: "A reef floor of 18 m at most, shallow enough for a second dive of the morning.",
      creatureSlugs: ["spotted-moray", "spiny-lobster", "southern-stingray", "green-sea-turtle"],
    },
  },
  {
    slug: "frigate-bay-reef",
    version: 1,
    area: "st-kitts-nevis",
    sources: [
      "https://prodiversstkitts.com/st-kitts-dive-sites/",
      "https://www.divekdc.com/dive-sites",
      "https://mystkittsdivebuddy.com/reef-diving-sites-of-st-kitts/",
    ],
    briefing: {
      name: "Frigate Bay Reef",
      locationName: "Frigate Bay, St Kitts",
      // Approximate pin: one operator puts the reef about 3/4 mile off Frigate Bay beach and another
      // minutes from it (Frigate Bay, OpenStreetMap 17.2788, -62.6885); placed in the water 1.2 km
      // south-southwest of the beach. Depth: 35 ft to 55 ft (KDC), 40 ft to 70 ft (Pro Divers); the
      // deepest is used.
      forecastLatitude: 17.27,
      forecastLongitude: -62.695,
      description:
        "Two narrow reefs split by a strip of sand, a short run off Frigate Bay beach. Rays and garden eels work the sand, and lobsters, eels and turtles shelter on the reef.",
      marineLife: "Turtles · lobster · eels · rays · garden eels",
      marineLifeDescription:
        "The sand strip is the place to look for garden eels, and the reef edges hold turtles and lobster.",
      difficultyLevel: "intermediate",
      depthRange: "11–21 m (35–70 ft)",
      maxDepthMeters: 21,
      currentNote: "Usually light; it can change, so carry an SMB.",
      divePlan: "Work along one reef, cross the sand strip, and return along the other.",
      fitTone: "unknown",
      fitNote: "Narrow reefs down to 21 m; stay with your computer.",
      creatureSlugs: [
        "green-sea-turtle",
        "spiny-lobster",
        "garden-eel",
        "southern-stingray",
        "spotted-moray",
      ],
    },
  },
  {
    slug: "green-point-reef",
    version: 1,
    area: "st-kitts-nevis",
    sources: [
      "https://prodiversstkitts.com/st-kitts-dive-sites/",
      "https://www.divekdc.com/dive-sites",
    ],
    briefing: {
      name: "Green Point Reef",
      locationName: "Green Point, St Kitts",
      // Approximate pin: both operators name the reef for Green Point, and KDC puts it a stone's
      // throw off the point (OpenStreetMap, 17.2298, -62.6619); placed in the water 400 m west of
      // the point. Depth: 20 ft to 60 ft (KDC), 45 ft to 80 ft (Pro Divers); the range spans both.
      forecastLatitude: 17.229,
      forecastLongitude: -62.666,
      description:
        "A volcanic reef with tube sponges, barrel sponges, large sea fans and black coral trees, cut by cracks and crevices where lobsters sit. Southern stingrays and spotted eagle rays are common.",
      marineLife: "Lobster · southern stingrays · spotted eagle rays · small grouper",
      marineLifeDescription:
        "Lobsters fill the cracks and rays glide through clear water. There is little hard coral, so the fans and sponges do the work.",
      difficultyLevel: "intermediate",
      depthRange: "6–25 m (20–80 ft)",
      maxDepthMeters: 25,
      currentNote: "Usually light; it can change, so carry an SMB.",
      divePlan:
        "Start in the shallows, work down the reef to about 18 m, and return along the sponges.",
      fitTone: "unknown",
      fitNote: "A volcanic reef that runs to 25 m, with room for a slow dive.",
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "black-coral",
        "spiny-lobster",
        "southern-stingray",
        "spotted-eagle-ray",
      ],
    },
  },
];
