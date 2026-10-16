// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Utila. */
export const HONDURAS_UTILA: DiveSiteTemplate[] = [
  // Denominator row: West End
  {
    slug: "west-end-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
    ],
    briefing: {
      name: "West End",
      locationName: "West End, Utila",
      forecastLatitude: 16.0866,
      forecastLongitude: -86.9989,
      description:
        "A sloping wall off Utila's west end, with sand patches in the shallows. The slope keeps easing down past the plan, toward 30–40 m (100–130 ft).",
      marineLife: "Nurse sharks · green moray · hawksbill turtles · tarpon",
      marineLifeDescription:
        "Nurse sharks rest around the mooring, and green morays roam the reef. Tarpon and hawksbills have been reported here.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 30 m (100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Practice in the shallow sand patches, follow the wall down no deeper than 30 m (100 ft), and finish up the slope with reserve gas.",
      fitTone: "demanding",
      fitNote: "A slope that keeps falling past the plan. For divers who hold their own depth.",
      // The wall drops past 30 m; the plan holds a hard floor at 30 m (100 ft), so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["nurse-shark", "green-moray", "hawksbill-turtle", "tarpon"],
    },
  },
  // Denominator row: Raggedy Cay
  {
    slug: "raggedy-cay-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
      "https://diveinutila.com/fun-diving/resort-diving/",
    ],
    briefing: {
      name: "Raggedy Cay",
      locationName: "Turtle Harbor Marine Reserve, Utila",
      forecastLatitude: 16.0872,
      forecastLongitude: -86.9974,
      description:
        "Two buoys off Raggedy Cay, the northernmost cay around Utila and a bird sanctuary closed to landing. Sand patches in the shallows lead to an outer wall that lies beyond the plan.",
      marineLife: "Hawksbill turtles · spotted eagle rays · nurse sharks · yellowhead jawfish",
      marineLifeDescription:
        "Hawksbills graze the sponges, eagle rays cruise the outer wall, and the sand patches hold jawfish and flounders.",
      difficultyLevel: "beginner",
      depthRange: "Up to 18 m (60 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Stay on the shallow side of the wall: sand patches first, then the reef edge, and back to the buoy with reserve gas.",
      fitTone: "welcoming",
      fitNote:
        "Shallow sand patches suit skills and slow looking; the wall is there to be watched, not followed.",
      // Ungated: the sources describe sand patches in the shallows used for skills; the outer wall lies beyond the 18 m plan.
      landmarks: [
        {
          name: "Raggedy Cay",
          kind: "pointOfInterest",
          note: "A bird sanctuary cay with no landing allowed. The reef west of it is part of the marine reserve.",
        },
      ],
      creatureSlugs: [
        "hawksbill-turtle",
        "spotted-eagle-ray",
        "nurse-shark",
        "yellowhead-jawfish",
        "peacock-flounder",
      ],
    },
  },
  // Denominator row: Spotted Bay
  {
    slug: "spotted-bay-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
      "https://diveinutila.com/fun-diving/resort-diving/",
    ],
    briefing: {
      name: "Spotted Bay",
      locationName: "Turtle Harbor, Utila",
      forecastLatitude: 16.0948,
      forecastLongitude: -86.9886,
      description:
        "A shallow sand patch under the boat for skills, with a wall beside it. The wall falls to about 27 m (90 ft) and a deeper sand patch slopes away below it, both beyond the plan.",
      marineLife: "Nurse sharks · spotted eagle rays · spotted moray · spotted drum",
      marineLifeDescription:
        "Nurse sharks rest in the sand channels. Eagle rays and spotted fish of several kinds work the wall.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 27 m (90 ft)",
      maxDepthMeters: 27,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Start on the shallow sand patch, follow the sand channels along the top of the wall, and stay above the plan's 18 m (60 ft) floor. The small caverns under the boat are overheads; stay out of them.",
      fitTone: "unknown",
      fitNote:
        "The shallows do most of the work and the plan stays at 18 m, but the wall falls to 27 m beside it, so the site is held to Advanced Open Water.",
      // The operator describes shallow sand patches used for training dives, but the wall falls to about 27 m and the deeper sand patch lies below it, so the site is bounded at 27 m and gated at Advanced Open Water while the plan keeps to 18 m. A shop that dives only the sand patch can lower the gate. The small caverns under the boat are not part of the plan.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["nurse-shark", "spotted-eagle-ray", "spotted-moray", "spotted-drum"],
    },
  },
  // Denominator row: Don Quickset
  {
    slug: "don-quickset",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
    ],
    briefing: {
      name: "Don Quickset",
      locationName: "Utila",
      forecastLatitude: 16.1025,
      forecastLongitude: -86.9782,
      description:
        "A reef shallower than the north-side walls, cut by channels in every direction. The deepest water is about 24 m (80 ft).",
      marineLife: "Nurse sharks · great barracuda · lionfish",
      marineLifeDescription:
        "Nurse sharks sleep in the crevices, and barracuda sometimes keep a diver company.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 24 m (80 ft)",
      maxDepthMeters: 24,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the open channels across the reef. Swim-throughs are overheads; stay out of all of them.",
      fitTone: "welcoming",
      fitNote: "A shallower, more varied reef than the walls. Keep to the open channels.",
      // Gate: the operator gives about 75-80 ft (24 m) as the maximum, past the 18 m Open Water limit, so Advanced Open Water. The swim-throughs are overheads and are not part of the plan.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["nurse-shark", "great-barracuda", "lionfish"],
    },
  },
  // Denominator row: CJ's Drop-Off
  {
    slug: "cjs-drop-off-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
      "https://utiladivecenter.com/news/utila-diving-itinerary",
      "https://diveinutila.com/fun-diving/resort-diving/",
    ],
    briefing: {
      name: "CJ's Drop-Off",
      locationName: "Turtle Harbor, Utila",
      forecastLatitude: 16.1104,
      forecastLongitude: -86.9553,
      description:
        "A steep wall at the west end of Turtle Harbor. The top of the wall sits near 9 m (30 ft) and it falls away past recreational depth, with a sheltered sand patch and elkhorn coral under the buoy.",
      marineLife: "Spotted eagle rays · nurse sharks · reef sharks · elkhorn coral",
      marineLifeDescription:
        "Eagle rays pass along the wall edge, and a nurse shark sometimes sleeps in a narrow channel west of the buoy.",
      difficultyLevel: "advanced",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down the buoy line to the lip at about 9 m (30 ft), along the wall no deeper than 30 m (100 ft), and finish on the sand patch under the buoy with reserve gas.",
      fitTone: "demanding",
      fitNote: "A wall that does not end where you should. Hold your depth, and hold your camera.",
      // The wall drops past 30 m; the plan holds a hard floor at 30 m (100 ft), so the gate is Advanced Open Water without the Deep specialty. Pin: the BICA buoy position; a coastline-polygon check puts it in the water about 140 m off the shore, at the wall.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Sand patch under the buoy",
          kind: "pointOfInterest",
          note: "A small sand patch beneath the mooring with elkhorn coral, used for the safety stop.",
        },
      ],
      creatureSlugs: ["spotted-eagle-ray", "nurse-shark", "elkhorn-coral", "great-barracuda"],
    },
  },
  // Denominator row: The Maze
  {
    slug: "the-maze-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
      "https://www.proscubadiver.net/?p=424153",
    ],
    briefing: {
      name: "The Maze",
      locationName: "Turtle Harbor, Utila",
      forecastLatitude: 16.1118,
      forecastLongitude: -86.95,
      description:
        "Open spur-and-groove channels above a large sand patch that slopes away past the plan, to 30 m (100 ft) and deeper. A cavern known as Willy's Hole lies west of the sand.",
      marineLife: "Southern stingrays · queen triggerfish · glassy sweepers · green moray",
      marineLifeDescription:
        "Stingrays feed in the sand, and sweepers and a green moray hold the crevices of the reef.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 30 m (100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Cross the sand patch no deeper than 30 m (100 ft), then work up through the channels. Willy's Hole is an overhead; stay out.",
      fitTone: "demanding",
      fitNote:
        "A deep sand slope with an overhead beside it. Stay in the open and keep to the plan.",
      // Overhead: Willy's Hole is a cavern, so the prose says to stay out of it and the plan never enters it. The sand slopes past 30 m (100 ft); the floor is the plan's, hence Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Willy's Hole",
          kind: "pointOfInterest",
          note: "A cavern west of the sand patch. An overhead; stay out.",
        },
      ],
      creatureSlugs: ["southern-stingray", "queen-triggerfish", "glassy-sweeper", "green-moray"],
    },
  },
  // Denominator row: The Pinnacle (Pinnacles)
  {
    slug: "the-pinnacle-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
      "https://utiladivecenter.com/news/utila-diving-itinerary",
      "https://www.proscubadiver.net/?p=424153",
    ],
    briefing: {
      name: "The Pinnacle",
      locationName: "Turtle Harbor, Utila",
      forecastLatitude: 16.1128,
      forecastLongitude: -86.9485,
      description:
        "A rock pinnacle west of the buoy that rises from deep water to between 9 and 12 m (30–40 ft) of the surface, with big schools of snapper around its top. A swim-through on the site runs far deeper than the plan.",
      marineLife: "Snappers · midnight parrotfish · spiny lobster · dolphins",
      marineLifeDescription:
        "Snappers school over the top of the pinnacle, and lobsters and banded coral shrimp use its cracks. Dolphins are sometimes seen around the site.",
      difficultyLevel: "intermediate",
      depthRange: "9–30 m (30–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day. Carry an SMB.",
      divePlan:
        "Down the buoy line, around the pinnacle no deeper than 30 m (100 ft), and finish on its shallow top with reserve gas. Hold above 21 m near the swim-through; it is overhead; stay out.",
      fitTone: "demanding",
      fitNote: "A deep pinnacle with a deeper overhead beside it. Circle it in the open.",
      // Overhead and depth: the swim-through starts near 21 m and ends near 40 m, so the plan stays out of it and holds a 30 m floor: Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The swim-through",
          kind: "pointOfInterest",
          note: "Past the plan: it runs from about 21 m to about 40 m, and it is an overhead. Stay out.",
        },
      ],
      creatureSlugs: [
        "yellowtail-snapper",
        "midnight-parrotfish",
        "spiny-lobster",
        "banded-coral-shrimp",
      ],
    },
  },
  // Denominator row: Duppy Waters
  {
    slug: "duppy-waters",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
      "https://diveinutila.com/advanced-open-water/",
    ],
    briefing: {
      name: "Duppy Waters",
      locationName: "Turtle Harbor Marine Reserve, Utila",
      forecastLatitude: 16.116,
      forecastLongitude: -86.9451,
      description:
        "A wall dive on the edge of the Turtle Harbor reserve, where the reef drops out of sight. Giant barrel sponges grow along it, with sand patches either side of the two buoys to guide you back.",
      marineLife: "Giant barrel sponges · spotted eagle rays · nurse sharks · barracuda",
      marineLifeDescription:
        "Barrel sponges, some taller than a diver's arm span, line the wall. A nurse shark rests under the overhangs in the shallows.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 30 m (100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Drop onto the wall, follow it no deeper than 30 m (100 ft), and return over the sand patches to the boat.",
      fitTone: "demanding",
      fitNote:
        "Operators run their deep adventure dive here to 30 m. A wall for divers who can hold that depth.",
      // The wall drops past 30 m; the plan holds a hard floor at 30 m (100 ft), so the gate is Advanced Open Water without the Deep specialty. Pin: the BICA buoy position; a coastline-polygon check puts it in the water about 110 m off the shore, at the reserve edge.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["giant-barrel-sponge", "spotted-eagle-ray", "nurse-shark", "great-barracuda"],
    },
  },
  // Denominator row: Diamond Cay
  {
    slug: "diamond-cay-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
    ],
    briefing: {
      name: "Diamond Cay",
      locationName: "Diamond Cay, Utila",
      forecastLatitude: 16.0614,
      forecastLongitude: -86.9886,
      description:
        "A seamount off a small uninhabited cay, with a wide sand patch in the shallows and a narrow channel leading to the outer wall. The wall falls beyond the plan.",
      marineLife: "Gray angelfish · hawksbill turtles · spotted eagle rays · black coral",
      marineLifeDescription:
        "Gray angelfish come up to look at divers. Pillar coral, black coral and crinoids grow on the wall, and hawksbills feed on the sponges in the shallows.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 30 m (100 ft)",
      maxDepthMeters: 30,
      currentNote: "The wall can be run either way depending on the current. Carry an SMB.",
      divePlan:
        "Follow the channel to the outer wall, go with the current no deeper than 30 m (100 ft), and finish in the shallows with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "A wall with a current that sets the direction. Hold your depth and know where the boat is.",
      // The wall drops past 30 m; the plan holds a hard floor at 30 m (100 ft), so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "gray-angelfish",
        "hawksbill-turtle",
        "spotted-eagle-ray",
        "black-coral",
        "pillar-coral",
      ],
    },
  },
  // Denominator row: Stingray Point
  {
    slug: "stingray-point-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
    ],
    briefing: {
      name: "Stingray Point",
      locationName: "Utila",
      forecastLatitude: 16.068,
      forecastLongitude: -86.9554,
      description:
        "A huge shallow sand patch with garden eels, sloping down between two reef walls that carry on either side. The walls fall beyond the plan, and one passage cuts through the reef to the west.",
      marineLife: "Garden eels · black and white crinoids · balloonfish",
      marineLifeDescription:
        "Brown garden eels fill the sand, and crinoids sit on the reef walls with their feather star shrimp.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 30 m (100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Cross the sand patch, follow the wall to the east no deeper than 30 m (100 ft), and finish in the shallows. Do not go west past the sand patch; the passage through the reef there is an overhead.",
      fitTone: "demanding",
      fitNote:
        "Healthy reef on a wall that keeps falling. Stay in the open, away from the passage to the west.",
      // The wall drops past 30 m; the plan holds a hard floor at 30 m (100 ft), so the gate is Advanced Open Water without the Deep specialty. The swim-through is an overhead: the prose says to stay out of it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["garden-eel", "golden-crinoid", "hawksbill-turtle"],
    },
  },
  // Denominator row: Big Rock
  {
    slug: "big-rock-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
    ],
    briefing: {
      name: "Big Rock",
      locationName: "Utila",
      forecastLatitude: 16.0751,
      forecastLongitude: -86.942,
      description:
        "A reef wall off the big rock formations on the beach, ending in sand near 15 m (50 ft), with a small pinnacle a little farther out that starts near 21 m (70 ft). Black coral grows along the wall.",
      marineLife: "Seahorses · yellowhead jawfish · peacock flounder · black coral",
      marineLifeDescription:
        "Seahorses and sand dwellers live around the pinnacle, and black coral, which is protected in Honduras, hangs from the wall.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 21 m (70 ft)",
      maxDepthMeters: 21,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Follow the wall to the sand at about 15 m (50 ft), visit the pinnacle no deeper than 21 m (70 ft), and come back along the wall.",
      fitTone: "welcoming",
      fitNote: "A popular south-side site with small things to find at every depth.",
      // Gate: the small pinnacle starts near 21 m, past the 18 m Open Water limit, so Advanced Open Water.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "longsnout-seahorse",
        "yellowhead-jawfish",
        "peacock-flounder",
        "black-coral",
      ],
    },
  },
  // Denominator row: Jack Neil Beach
  {
    slug: "jack-neil-beach-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
      "https://utiladivecenter.com/news/utila-diving-itinerary",
      "https://www.proscubadiver.net/?p=424153",
    ],
    briefing: {
      name: "Jack Neil Beach",
      locationName: "Utila",
      forecastLatitude: 16.0753,
      forecastLongitude: -86.9381,
      description:
        "A small sheltered cove on the south side, with a wide shallow sand patch and a wall to either side. Seahorses, garden eels and other small animals live on the sand.",
      marineLife: "Longsnout seahorses · garden eels · gray snapper · reef squid",
      marineLifeDescription:
        "Seahorses, hermit crabs and garden eels share the sand patch, while schools of snappers and creole wrasse gather on the walls.",
      difficultyLevel: "beginner",
      depthRange: "Up to 18 m (60 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Search the sand patch slowly, then follow either wall within the plan's 18 m (60 ft) floor.",
      fitTone: "welcoming",
      fitNote: "Calm and shallow, with something small to find everywhere you look.",
      // Ungated: the sources describe a sheltered cove with a shallow sand patch suited to new divers. The 18 m floor is the plan's, not a published depth.
      creatureSlugs: [
        "longsnout-seahorse",
        "garden-eel",
        "gray-snapper",
        "creole-wrasse",
        "caribbean-reef-squid",
      ],
    },
  },
  // Denominator row: Little Bight
  {
    slug: "little-bight-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
    ],
    briefing: {
      name: "Little Bight",
      locationName: "Utila",
      forecastLatitude: 16.0786,
      forecastLongitude: -86.9302,
      description:
        "A huge sand patch that runs from the buoy to the beach, with a reef wall in either direction. The wall carries on beyond the plan.",
      marineLife: "Southern stingrays · garden eels · spotted eagle rays · upside-down jellyfish",
      marineLifeDescription:
        "Garden eels and upside-down jellyfish live on the sand, and stingrays feed there. Longsnout seahorses turn up in the shallows.",
      difficultyLevel: "beginner",
      depthRange: "Up to 18 m (60 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Follow either wall within the plan's 18 m (60 ft) floor, then spend the last minutes in the shallows looking for seahorses.",
      fitTone: "welcoming",
      fitNote: "An easy sand slope where the small animals are the point.",
      // Ungated: the operator calls it suited to new and experienced divers alike, with a shallow sand patch; the wall lies beyond the 18 m plan.
      creatureSlugs: [
        "southern-stingray",
        "garden-eel",
        "spotted-eagle-ray",
        "upside-down-jellyfish",
        "longsnout-seahorse",
      ],
    },
  },
  // Denominator row: Black Coral Wall
  {
    slug: "black-coral-wall-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
      "https://utiladivecenter.com/news/best-diving-spot-in-caribbean",
    ],
    briefing: {
      name: "Black Coral Wall",
      locationName: "Utila",
      forecastLatitude: 16.0824,
      forecastLongitude: -86.9176,
      description:
        "A shallow plateau under the buoy leads to a wall with black coral along it, east and west. The drop-off ends near 27–30 m (90–100 ft), then a sand slope carries on past the plan.",
      marineLife: "Black coral · great barracuda · dog snapper · seahorses",
      marineLifeDescription:
        "Black coral, a protected species in Honduras, grows along the wall. Barracuda and snappers sit in the crevices, and seahorses live in the shallows.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 30 m (100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Cross the plateau, follow the wall in either direction no deeper than 30 m (100 ft), and finish over the sand patches in the shallows.",
      fitTone: "demanding",
      fitNote: "A wall dive with real depth and real black coral. Keep your gauge in view.",
      // The wall drops past 30 m; the plan holds a hard floor at 30 m (100 ft), so the gate is Advanced Open Water without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["black-coral", "great-barracuda", "dog-snapper", "longsnout-seahorse"],
    },
  },
  // Denominator row: Halliburton (Haliburton)
  {
    slug: "halliburton-wreck-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://web.archive.org/web/20251028065847/https://utilacaysdiving.com/dive-with-us/dive-sites/",
      "https://diveinutila.com/wreck/",
      "https://diveinutila.com/advanced-open-water/",
    ],
    briefing: {
      name: "Halliburton Wreck",
      locationName: "Utila",
      forecastLatitude: 16.0834,
      forecastLongitude: -86.8966,
      description:
        "A supply ship sunk on purpose in 1998 as an artificial reef, upright on sand near 30 m (100 ft), with its upper deck near 20 m (65 ft). There is no shallow reef at this site. Stay outside the hull.",
      marineLife: "Dog snapper · great barracuda · bearded fireworm · thorny oyster",
      marineLifeDescription:
        "Snappers and barracuda hang around the hull, and bearded fireworms crawl over the structure. Do not touch the wreck.",
      difficultyLevel: "advanced",
      depthRange: "20–31 m (65–100 ft)",
      maxDepthMeters: 31,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Down one of the two buoy lines, a slow circuit of the outside of the hull, with the sand floor near 30 m (100 ft) as the limit, and a safety stop on the line, since there is no reef to rise onto. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "A deep wreck with no reef to climb onto. For experienced divers who use the buoy line.",
      // Gate: Utila Cays Diving puts the sand "right at 100ft" (30.5 m) and Alton's says 30 m, so the cap covers the sand at 31 m: past 30 m, hence Advanced Open Water plus Deep.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Buoy lines",
          kind: "pointOfInterest",
          note: "Two buoy lines. With no shallow reef here, use one for the safety stop.",
        },
      ],
      creatureSlugs: ["dog-snapper", "great-barracuda", "bearded-fireworm"],
    },
  },
  // Denominator row: Black Hills
  {
    slug: "black-hills-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://www.google.com/maps/d/viewer?mid=1VAAlEKHNYaqEzG1-mQVxQSmVTYVjdyfA",
      "https://utiladivecenter.com/news/utila-diving-itinerary",
      "https://diveinutila.com/advanced-open-water/",
      "https://www.proscubadiver.net/?p=424153",
    ],
    briefing: {
      name: "Black Hills",
      locationName: "Black Hills, off Utila's south side",
      forecastLatitude: 16.0947,
      forecastLongitude: -86.8693,
      description:
        "An offshore seamount with coral formations, run only on days the sea allows. Currents can be strong, on the surface and below.",
      marineLife: "Horse-eye jacks · groupers · spadefish",
      marineLifeDescription:
        "Jacks, spadefish and groupers gather on the formations, and a silky shark is an occasional visitor in the open water around the seamount.",
      difficultyLevel: "advanced",
      depthRange: "Up to 30 m (100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Strong current, on the surface and down the seamount. Expect a drift; every diver carries an SMB and surfaces with it deployed for pickup.",
      divePlan:
        "Staff confirm the diver’s log before boarding. Down the line to the top of the seamount, along the formations no deeper than 30 m (100 ft), and a slow ascent with reserve gas. The overhangs and swim-throughs on the formations are overheads; stay out.",
      fitTone: "demanding",
      fitNote:
        "Advanced divers only. A current-swept seamount where you check your gas often. Medical care is far; confirm the boat’s oxygen and plan.",
      // Gate: Alton's runs its 30 m deep dives here and the shop that lists it says advanced divers only; the seamount base is deeper than the plan. Approximate pin: the Roatan Marine Park map pin, which plots in open water about 1.3 km east of Utila's southeast corner; the sources say only "off the southeast corner" (SSI MyDiveGuide) and about 1.5 km off the south shore (Frommer's), so treat it as good to about 2 km. The seamount top is about 10 m and some sides fall past 40 m (SSI), hence the plan's 30 m floor. Silky sharks are named by a source for the site as an occasional visitor.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "horse-eye-jack",
        "atlantic-spadefish",
        "black-grouper",
        "great-barracuda",
        "silky-shark",
      ],
    },
  },
  // Denominator row: Moon Hole
  {
    slug: "moon-hole-utila",
    version: 1,
    area: "honduras-utila",
    sources: [
      "https://maps.google.com/maps/ms?msid=106329832108210756578.000479374e5829962b13e&msa=0",
      "https://www.wediveutila.com/utila-dive-sites",
      "https://www.padi.com/dive-site/honduras/moon-hole/",
      "https://lenaonthemove.com/dive-guide-utila/",
      "https://www.oceanatik.com/sites/country/hnd/dive/7030",
    ],
    briefing: {
      name: "Moon Hole",
      locationName: "Moon Hole, Utila",
      // Pin: the BICA buoy position (16.08415, -86.89323). PADI's site page gives 16.08499, -86.89334
      // (about 95 m away); both are in the water off the south-east coast, 346 m from the nearest
      // mapped shore. The Oceanatik page (a peninsula dive off the south-east coast) gives no coordinates.
      forecastLatitude: 16.0842,
      forecastLongitude: -86.8932,
      description:
        "A round sand crater ringed by shallow reef, close to the south shore. Staghorn and elkhorn coral grow on the rim, and seahorses and octopus turn up around the sand.",
      marineLife: "Longsnout seahorses · octopus · nurse sharks · green moray eels · stingrays",
      marineLifeDescription:
        "Look low over the sand and into the coral on the rim. The reef top is shallow and bright, with the light reaching the coral. Keep hands clear of the coral and look, don't reach. Nurse sharks are not promised; if one is near, stay with the group, keep nothing dangling, do not chase or touch, and follow the crew's briefing.",
      difficultyLevel: "beginner",
      depthRange: "4–18 m (13–59 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Current not documented; ask the crew on the day, and carry an SMB. The wall beside the crater has caverns, crevices and swim-throughs. They are overhead; stay out.",
      divePlan:
        "Drop to the reef top at 4 to 7 m, circle the sand crater at its 11 m floor, and follow the rim no deeper than 18 m (60 ft). Turn on your gauge, not the wall: its depth is not documented and it falls away from the rim. The caverns, crevices and swim-throughs along the wall (6 to 12 m) are overheads; stay out. Keep the safety stop on the mooring line or an SMB.",
      fitTone: "welcoming",
      fitNote:
        "A bowl of light and sand that is easy to read, rated for entry-level divers and skills practice.",
      // Ungated: PADI ("ideal for entry level divers"), Lena on the Move (novices and skills work) and
      // Oceanatik (beginner) agree. The reef top is 4 to 7 m; the deepest figures are 18 m (Oceanatik's
      // site maximum; Lena on the Move puts Ron's Wreck, across the western wall, at 18 m; We Dive Utila
      // has it near 18 m, "about 60 ft"), 12 m (PADI) and 10.7 to 11.4 m for the sand. No source gives
      // the wall's own foot, so the plan holds 18 m and leaves the wall.
      // Caverns: Oceanatik names several large caverns, crevices and swim-throughs along the wall (6 to
      // 12 m); the prose says to stay out and the plan never enters them. Staghorn and elkhorn coral
      // are Oceanatik's; the seahorses, octopus and stingrays are PADI's and We Dive Utila's.
      creatureSlugs: [
        "longsnout-seahorse",
        "caribbean-reef-octopus",
        "nurse-shark",
        "green-moray",
        "southern-stingray",
        "staghorn-coral",
        "elkhorn-coral",
      ],
    },
  },
];
