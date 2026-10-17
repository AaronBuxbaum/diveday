// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Grand Cayman. */
export const CAYMAN_GRAND_CAYMAN: DiveSiteTemplate[] = [
  // Denominator row: Hepp's Pipeline
  // Depth: SSI gives the miniwall as 60 ft up to 30 ft; DoE moors at 25 ft.
  {
    slug: "hepps-pipeline",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divessi.com/en/mydiveguide/divesite/hepps-pipeline-3195",
    ],
    briefing: {
      name: "Hepp's Pipeline",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3854,
      forecastLongitude: -81.4164,
      description:
        "A sand patch and a miniwall that steps from 18 m up to 9 m, with a leftover pipe from an old waste system that gives it its name. A good site for juveniles and small animals.",
      marineLife: "Blue chromis · black durgons · juvenile reef fish",
      marineLifeDescription:
        "Chromis and durgons cover the top of the reef, with cleaning stations and crustaceans to find.",
      difficultyLevel: "beginner",
      depthMinMeters: 8,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote: "Shallow and easy, good for slow macro hunting.",
      creatureSlugs: ["blue-chromis", "black-durgon", "spotted-cleaner-shrimp", "queen-parrotfish"],
    },
  },
  // Denominator row: Ghost Mountain
  // Gate: Red Sail describes the deep profile and occasional strong current as suited to experienced divers, and Divetech gives 18 to 27 m, so Advanced Open Water without the Deep specialty. The bottom depth is not published; the plan stays at 27 m.
  {
    slug: "ghost-mountain-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://redsailcayman.com/exploring-grand-caymans-hidden-dive-sites-a-divers-paradise/",
      "https://www.divetech.com/post/best-dive-sites-grand-cayman",
    ],
    briefing: {
      name: "Ghost Mountain",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.4023,
      forecastLongitude: -81.3857,
      description:
        "A free-standing coral pinnacle off the north-west whose top lies at about 18 m. You can swim all the way round it.",
      marineLife: "Horse-eye jacks · reef sharks · soft corals · cleaner shrimp",
      marineLifeDescription:
        "Soft corals wave on the pinnacle and small animals shelter in its shadows. Jacks and the odd reef shark pass.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 27,
      currentNote: "Occasional strong current. Carry an SMB.",
      fitTone: "demanding",
      fitNote: "A deep pinnacle with current at times. For experienced divers.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "horse-eye-jack",
        "caribbean-reef-shark",
        "sea-plume",
        "spotted-cleaner-shrimp",
      ],
    },
  },
  // Denominator row: Stingray City
  // Depth: DoE mooring 12 ft; Indigo calls it a 12 ft dive.
  // Pin: matches the DoE mooring position in src/content/coverage/cayman-grand-cayman.json (19.38482, -81.34373).
  {
    slug: "stingray-city-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.indigodivers.com/dive-sites",
      "https://www.livingthedreamdivers.com/cayman-diving/cayman-diving-sites/",
      "https://diveredsailcayman.com/dive-sites/",
    ],
    briefing: {
      name: "Stingray City",
      locationName: "North Sound, Grand Cayman",
      forecastLatitude: 19.3848,
      forecastLongitude: -81.3437,
      description:
        "A sand flat in the sheltered North Sound where southern stingrays gather around boats, a habit that began when fishermen cleaned their catch here. Divers settle on the sand in about 4 m of water.",
      marineLife: "Southern stingrays · spotted goatfish · sand tilefish",
      marineLifeDescription: "Rays glide over the sand around the boats.",
      conservationNote:
        "No handling, no feeding, no lifting. These are wild animals; follow the crew's briefing.",
      difficultyLevel: "beginner",
      maxDepthMeters: 4,
      currentNote:
        "Tour boats and snorkelers crowd the surface above. Surface at the mooring line and carry an SMB. The North Sound is sheltered.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, sandy and sheltered. Stay low, keep your hands to yourself and let the rays pass.",
      creatureSlugs: ["southern-stingray", "spotted-goatfish", "sand-tilefish", "peacock-flounder"],
    },
  },
  // Denominator row: Princess Penny's Wall (Princess Penny's Pinnacle)
  // Gate: the north wall drops past recreational depth; the plan floor is 30 m (Red Sail's maximum), so Advanced Open Water without the Deep specialty.
  {
    slug: "princess-pennys-pinnacle",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
      "https://www.divetech.com/post/why-experienced-divers-choose-divetech-for-best-deep-wall-dives",
    ],
    briefing: {
      name: "Princess Penny's Pinnacle",
      locationName: "North Wall, Grand Cayman",
      forecastLatitude: 19.3843,
      forecastLongitude: -81.3315,
      description:
        "A pinnacle set slightly apart from the main wall, circled by big fans and whip corals. The top of the reef is a good place to spot eagle rays and lobsters.",
      marineLife: "Fans · whip corals · moray eels · eagle rays · lobsters",
      marineLifeDescription:
        "Look inside the reef for morays and crabs, and out into the blue for eagle rays.",
      difficultyLevel: "intermediate",
      depthMinMeters: 14,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 14 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A pinnacle on the north wall. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "common-sea-fan",
        "black-sea-rod",
        "green-moray",
        "spotted-eagle-ray",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: Eagle Ray Pass
  // Gate: the north wall drops past recreational depth; the plan floor is 30 m (Red Sail's maximum), so Advanced Open Water without the Deep specialty.
  {
    slug: "eagle-ray-pass",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
      "https://www.indigodivers.com/dive-sites",
    ],
    briefing: {
      name: "Eagle Ray Pass",
      locationName: "North Wall, Grand Cayman",
      forecastLatitude: 19.3838,
      forecastLongitude: -81.3249,
      description:
        "A deep coral chasm leading to the wall, with towering heads, arches and narrow crevices full of sponges, fans and black coral. Eagle rays often cruise the wall face.",
      marineLife: "Eagle rays · black coral · sponges · gorgonians",
      marineLifeDescription:
        "Eagle rays gather along the wall, and the chasm is crowded with black coral and sponge.",
      difficultyLevel: "intermediate",
      depthMinMeters: 16,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 16 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A chasm and wall on the north side. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["spotted-eagle-ray", "black-coral", "common-sea-fan", "giant-barrel-sponge"],
    },
  },
  // Denominator row: Gail's Mountain
  // Gate: the formation sits on the drop-off; the plan floor is 30 m (Red Sail's maximum), so Advanced Open Water without the Deep specialty.
  {
    slug: "gails-mountain",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
    ],
    briefing: {
      name: "Gail's Mountain",
      locationName: "North Wall, Grand Cayman",
      forecastLatitude: 19.3806,
      forecastLongitude: -81.2961,
      description:
        "A flat-topped coral mass, about 75 m across at the base, perched on the edge of the drop-off and rising to within 12 m of the surface. Two coral canyons spill over the wall on either side.",
      marineLife: "Corals · sponges",
      marineLifeDescription: "Hard corals and sponges cover the flat top and the two canyons.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 12 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A coral mass on the edge of the wall. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "mountainous-star-coral",
        "boulder-star-coral",
        "common-sea-fan",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: White Stroke Canyon
  // Gate: the North Wall drops past recreational depth; the plan floor is 30 m, so Advanced Open Water without the Deep specialty. Depth: Frommer's gives 15 to 30 m; the DoE mooring (60 ft) is the reef top.
  {
    slug: "white-stroke-canyon",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.caymanturtledivers.com/grand-cayman-dive-sites",
      "https://www.caymanturtledivers.com/grand-cayman-wall-diving-sites",
      "https://www.frommers.com/destinations/cayman-islands/the-best-scuba-diving",
    ],
    briefing: {
      name: "White Stroke Canyon",
      locationName: "North Wall, Grand Cayman",
      forecastLatitude: 19.3814,
      forecastLongitude: -81.2883,
      description:
        "An undersea canyon on the North Wall, also called Grand Canyon, where two big coral buttresses form a wide recess full of sponges and soft corals. Visibility is often around 30 m.",
      marineLife: "Bermuda chub · creole wrasse · eagle rays · green turtles",
      marineLifeDescription:
        "Chub and wrasse school in the recess, with eagle rays and turtles passing.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 15 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A North Wall canyon. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["spotted-eagle-ray", "green-sea-turtle", "bermuda-chub", "creole-wrasse"],
    },
  },
  // Denominator row: Julie's Wall
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "julies-wall",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/julies-wall-dive-site-in-grand-cayman",
      "https://redsailcayman.com/exploring-grand-caymans-hidden-dive-sites-a-divers-paradise/",
    ],
    briefing: {
      name: "Julie's Wall",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3527,
      forecastLongitude: -81.166,
      description:
        "The last dive before the protected zone on the northern end of the East End. A miniwall sits beside the main wall, and part of the wall overhangs, with large sponges in its shade.",
      marineLife: "Porcupinefish · sea fans · large sponges",
      marineLifeDescription:
        "Sponges that normally live much deeper grow in the overhang's twilight. Porcupinefish hold just above the reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 15 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "A wall with an overhang. Stay out from under it and hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["porcupinefish", "common-sea-fan", "giant-barrel-sponge", "queen-parrotfish"],
    },
  },
  // Denominator row: Babylon
  // Ungated: Ocean Frontiers describes the shallow top as an all-levels dive in its own right, with an 18 m (60 ft) floor; the drop-off lies beyond the plan.
  {
    slug: "babylon-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/babylon-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Babylon",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3533,
      forecastLongitude: -81.1643,
      description:
        "A freestanding pinnacle that rises from over 30 m to within 14 m of the surface, a short swim from the wall. Do not circle the pinnacle; its sides fall past 30 m. Spend the dive on the bright, sandy top.",
      marineLife: "Sponges · sea fans · parrotfish · reef fish",
      marineLifeDescription: "Corals and sponges grow across the pinnacle and the reef top.",
      difficultyLevel: "beginner",
      depthMinMeters: 14,
      maxDepthMeters: 18,
      divePlan:
        "Stay on the reef top. The plan's floor is 18 m (60 ft). The drop-off beyond is a separate, deeper dive.",
      fitTone: "welcoming",
      fitNote:
        "A bright sandy top, dived in its own right. The wall beyond falls away past the plan.",
      creatureSlugs: ["common-sea-fan", "giant-barrel-sponge", "queen-parrotfish", "blue-tang"],
    },
  },
  // Denominator row: McCurley's Wall
  // Ungated: Ocean Frontiers describes the shallow top as an all-levels dive in its own right, with an 18 m (60 ft) floor; the drop-off lies beyond the plan.
  {
    slug: "mccurleys-wall",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/mccurleys-wall-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "McCurley's Wall",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3537,
      forecastLongitude: -81.1636,
      description:
        "A wall that is shallow on top, about 12 m in places, yet drops steeply. The wall beyond is a separate, deeper dive.",
      marineLife: "Sea fans · decorator crabs · barrel sponges",
      marineLifeDescription: "Look closely in the fans for decorator crabs wearing bits of reef.",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      divePlan:
        "Stay on the reef top. The plan's floor is 18 m (60 ft). The drop-off beyond is a separate, deeper dive.",
      fitTone: "welcoming",
      fitNote: "Shallow on top. The wall continues far below the plan; the floor is 18 m.",
      creatureSlugs: [
        "common-sea-fan",
        "giant-barrel-sponge",
        "french-angelfish",
        "queen-parrotfish",
      ],
    },
  },
  // Denominator row: Northern Lights
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "northern-lights-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/northern-lights-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Northern Lights",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3549,
      forecastLongitude: -81.162,
      description:
        "A gentle slope of sand channels and sponge-covered coral fingers that ends at a drop-off near 17 m. Rope sponges crowd the narrow channels along the wall.",
      marineLife: "Green morays · rope sponges · sponges",
      marineLifeDescription:
        "A free-swimming green moray is a regular. A light brings back the color the water absorbs.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "Slope down, wall below. Carry a light for the sponges.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["green-moray", "lavender-rope-sponge", "red-rope-sponge", "common-sea-fan"],
    },
  },
  // Denominator row: Top Secret
  {
    slug: "top-secret-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/top-secret-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Top Secret",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3571,
      forecastLongitude: -81.1504,
      description:
        "A shallow reef named for the days before it had a mooring. A large pillar coral, over 3 m tall, stands near where you land, with smaller colonies around it.",
      marineLife: "Pillar coral · sharptail eels · reef fish",
      marineLifeDescription:
        "The pillar coral is rare in the Cayman Islands and brittle. Look, never touch.",
      conservationNote: "Pillar coral is rare and fragile. Keep fins and hands clear.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote: "Shallow and relaxed, with a coral worth hovering beside.",
      creatureSlugs: ["pillar-coral", "sharptail-eel", "queen-parrotfish", "french-angelfish"],
    },
  },
  // Denominator row: Omega Reef
  {
    slug: "omega-reef",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/omega-reef-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Omega Reef",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3563,
      forecastLongitude: -81.1426,
      description:
        "A sheltered miniwall packed with coral and sponge in water shallow enough to show every color. The main wall to the north is a separate, deeper dive.",
      marineLife: "Cero · sponges · reef fish",
      marineLifeDescription:
        "Color survives at 8 m, and the miniwall is crowded with sponges and coral.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      divePlan:
        "Stay on the reef top and hold 18 m (60 ft). The drop-off beyond is a separate, deeper dive.",
      fitTone: "welcoming",
      fitNote: "Shallow and colorful. Stay on the miniwall and hold 18 m.",
      creatureSlugs: ["cero", "common-sea-fan", "queen-parrotfish", "french-angelfish"],
    },
  },
  // Denominator row: Little Bluff Reef
  {
    slug: "little-bluff-reef",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/little-bluff-reef-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Little Bluff Reef",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3564,
      forecastLongitude: -81.1387,
      description:
        "Rolling coral meadows with low ridges that run north to south, so you can follow one out and return along the next. It rarely has current or surge, and it is a fine place to hunt for hamlets.",
      marineLife: "Hamlets · parrotfish · reef fish",
      marineLifeDescription:
        "Barred, masked and indigo hamlets share the reef, all the same shape in different colors.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      currentNote: "Rarely any current or surge.",
      fitTone: "welcoming",
      fitNote: "Calm and easy to navigate. A good first East End dive.",
      creatureSlugs: ["barred-hamlet", "masked-hamlet", "indigo-hamlet", "queen-parrotfish"],
    },
  },
  // Denominator row: Anchor Point
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  // Overhead: The swim-through is short and lit from above by a crack in the roof. No cavern gate.
  {
    slug: "anchor-point-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/anchor-point-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Anchor Point",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3582,
      forecastLongitude: -81.1319,
      description:
        "A wall dive that starts beside a short swim-through. The swim-through is overhead; stay out of it and go around. The headlands to the west hold ledges thick with chromis.",
      marineLife: "Hawksbill turtles · green turtles · chromis",
      marineLifeDescription:
        "This stretch of north wall is one of the better places on the East End to see turtles.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A wall that drops away below the plan. Skip the swim-through and hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "hawksbill-turtle",
        "green-sea-turtle",
        "blue-chromis",
        "brown-chromis",
        "sea-plume",
      ],
    },
  },
  // Denominator row: Old #12 (Old Number 12)
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "old-number-12",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/old-number-12-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Old Number 12",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3583,
      forecastLongitude: -81.1308,
      description:
        "A vertical wall at the western end gives way to a long, gradual slope of sea fans and soft corals as you work east. The sand-and-reef edge at the top is worth a slow look.",
      marineLife: "Soapfish · sea fans · soft corals",
      marineLifeDescription: "Soapfish lie on their sides on the bottom and watch you back.",
      difficultyLevel: "intermediate",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 20 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Wall to start, slope to finish, with time left at the top.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["greater-soapfish", "common-sea-fan", "sea-plume", "french-angelfish"],
    },
  },
  // Denominator row: Kathleen's Reef
  {
    slug: "kathleens-reef",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/kathleens-reef-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Kathleen's Reef",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3585,
      forecastLongitude: -81.1235,
      description:
        "Spur and groove reef beyond the barrier reef off Barefoot Beach, with large barrel sponges, feather plumes and an overhang east of the pin. The remains of a 1930 schooner lie in shallow water inshore.",
      marineLife: "Spotted drums · spiny lobsters · bluehead wrasse",
      marineLifeDescription:
        "Lobsters sit in the barrel sponges, and juvenile bluehead wrasse school round the yellow tube sponges.",
      difficultyLevel: "beginner",
      depthMinMeters: 11,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote: "Classic north-side reef, shallow and easy.",
      creatureSlugs: [
        "spotted-drum",
        "spiny-lobster",
        "bluehead-wrasse",
        "yellow-tube-sponge",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Delwin's Delight
  {
    slug: "delwins-delight",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/delwins-delight-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Delwin's Delight",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3578,
      forecastLongitude: -81.115,
      description:
        "Spur and groove reef with big sponges, sea plumes and fans, named by the diver who set the island's moorings. The coral head in front of the pin draws a crowd of fish.",
      marineLife: "Angelfish · sea plumes · turtles",
      marineLifeDescription: "Angelfish pair up beside sponges that a turtle has just opened.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote: "Shallow spur and groove, easy to follow.",
      creatureSlugs: [
        "french-angelfish",
        "gray-angelfish",
        "queen-angelfish",
        "sea-plume",
        "hawksbill-turtle",
      ],
    },
  },
  // Denominator row: Split Rock
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "split-rock-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/split-rock-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Split Rock",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3587,
      forecastLongitude: -81.1125,
      description:
        "A narrow canyon splits the reef, and you drop through it to reach a ledge of black coral to the east. Headlands to the west carry more black coral. The swim-throughs in the wall are overhead; stay out of them.",
      marineLife: "Black coral · brittle stars · sponges",
      marineLifeDescription:
        "Black coral glows when the sun shines through it. Brittle stars sit in the deep sponges.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      currentNote:
        "A little current is normal as you round each headland. Carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A canyon and black coral on a wall that falls below the plan. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "black-coral",
        "sponge-brittle-star",
        "common-sea-fan",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Fish Tank
  {
    slug: "fish-tank-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/fish-tank-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Fish Tank",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3568,
      forecastLongitude: -81.107,
      description:
        "The edge of a miniwall that is busy with fish, and a large pillar coral formation just east of the pin. Grunts school in the grooves beyond.",
      marineLife: "Pillar coral · grunts · lettuce sea slugs",
      marineLifeDescription:
        "French and bluestriped grunts hang in the grooves. Look in the hardpan for lettuce sea slugs.",
      conservationNote: "Pillar coral grows slowly and should never be touched.",
      difficultyLevel: "beginner",
      depthMinMeters: 11,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote: "Shallow and full of life.",
      creatureSlugs: ["pillar-coral", "french-grunt", "bluestriped-grunt", "lettuce-sea-slug"],
    },
  },
  // Denominator row: Black Rock Canyon (Black Rock Reef)
  {
    slug: "black-rock-reef",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/black-rock-reef-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Black Rock Reef",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3576,
      forecastLongitude: -81.1054,
      description:
        "Sandy channels, rolling coral gardens and freestanding heads, closer inshore than Black Rock Drop-Off. Chub, snapper and barracuda mill right below the boat.",
      marineLife: "Bermuda chub · yellowtail snapper · reef squid",
      marineLifeDescription:
        "A school of reef squid often holds north of the boat and turns white if you press in.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "welcoming",
      fitNote: "Easy coral gardens with plenty of action under the boat.",
      creatureSlugs: [
        "bermuda-chub",
        "yellowtail-snapper",
        "great-barracuda",
        "caribbean-reef-squid",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Black Rock Dropoff
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "black-rock-drop-off",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/black-rock-drop-off-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Black Rock Drop Off",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3563,
      forecastLongitude: -81.105,
      description:
        "A steep ridge between a sand patch and the deep, with a sand channel that spills over the wall at the east end and winds past a sponge-hung overhang. The wall twists and folds, so there is no straight swim.",
      marineLife: "Caribbean reef sharks · green morays",
      marineLifeDescription:
        "Caribbean reef sharks are seen along the ridge at times. Keep your distance and let them pass.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "Sculpted wall with reef sharks in the area. The floor is yours to hold.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["caribbean-reef-shark", "green-moray", "common-sea-fan", "black-coral"],
    },
  },
  // Denominator row: Valley of the Dolls
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "valley-of-the-dolls",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/valley-of-the-dolls-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Valley of the Dolls",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3571,
      forecastLongitude: -81.1008,
      description:
        "A canyon splits a coral buttress and serves as the way onto the wall, with tall soft corals and a good spread of sponges. The exit lip tips you upward over the open blue.",
      marineLife: "Sponges · feather plumes · soft corals",
      marineLifeDescription: "A feather plume stands about 2.5 m tall north of the pin.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A canyon onto the wall, with tall soft corals. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["sea-plume", "giant-barrel-sponge", "common-sea-fan", "french-angelfish"],
    },
  },
  // Denominator row: Barrel Sponge Wall
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "barrel-sponge-wall-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/barrel-sponge-wall-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Barrel Sponge Wall",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.357,
      forecastLongitude: -81.0995,
      description:
        "Seventeen giant barrel sponges more than 15 years old stand on sloped buttresses that run down to the drop-off. Clarity along this wall is very good.",
      marineLife: "Giant barrel sponges · sea fans",
      marineLifeDescription:
        "Watch a barrel sponge filter and you can see it vent through its top. Never climb into one.",
      conservationNote: "Do not climb into the barrel sponges.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A wall dive for sponge lovers, with the floor yours to hold.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["giant-barrel-sponge", "common-sea-fan", "black-coral", "queen-parrotfish"],
    },
  },
  // Denominator row: Roger's Reef
  {
    slug: "rogers-reef",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/rogers-reef-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Roger's Reef",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3555,
      forecastLongitude: -81.0984,
      description:
        "A miniwall edge at the corner where the north coast turns south, crowded with color. Sailfin blennies burrow in the flat ledge on top.",
      marineLife: "Sailfin blennies · turtles · cleaner shrimp",
      marineLifeDescription:
        "Males rise from their burrows and display. Check old conch shells for corkscrew anemones and cleaner shrimp.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 18,
      currentNote:
        "In a lively spot on the coast, so the sea can be rough and the site is dived less often. Current not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote:
        "Check conditions with the guide before entering. A busy miniwall for divers comfortable with a rough surface, when the sea allows it.",
      creatureSlugs: [
        "sailfin-blenny",
        "pederson-cleaner-shrimp",
        "corkscrew-anemone",
        "hawksbill-turtle",
      ],
    },
  },
  // Denominator row: Turtle Pass
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "turtle-pass-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/turtle-pass-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Turtle Pass",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3562,
      forecastLongitude: -81.0955,
      description:
        "The first site west of Collier's Channel, good for loggerhead turtles. The reef sits at 18 m and slopes into white sand. A low swim-through sits directly under the boat; it is overhead, so stay out of it.",
      marineLife: "Loggerhead turtles · reef fish",
      marineLifeDescription: "Loggerheads cruise the blue, especially in the spring mating season.",
      difficultyLevel: "intermediate",
      depthMinMeters: 19,
      maxDepthMeters: 30,
      currentNote:
        "On the northeast corner, so it is not always sheltered enough to dive. Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to about 19 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote:
        "Turtles on a wall that falls below the plan, on a corner that needs decent weather. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["loggerhead-turtle", "hawksbill-turtle", "common-sea-fan", "green-moray"],
    },
  },
  // Denominator row: Chub Hole
  // Overhead: Ocean Frontiers describes a miniwall of tunnels, canyons and archways, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "chub-hole-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/chub-hole-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Chub Hole",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3505,
      forecastLongitude: -81.0843,
      description:
        "A miniwall cut by tunnels, canyons and archways, with Bermuda chub packed over the reef and open overhangs and coral fingers to the north. Stay out of the tunnels; dive the open reef.",
      marineLife: "Bermuda chub · slipper lobsters · loggerhead turtles",
      marineLifeDescription:
        "Slipper lobsters shelter in the reef's crevices. Watch the blue for loggerheads.",
      difficultyLevel: "intermediate",
      depthMinMeters: 7,
      maxDepthMeters: 18,
      fitTone: "unknown",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. The open reef lies to the north.",
      creatureSlugs: ["bermuda-chub", "slipper-lobster", "loggerhead-turtle", "queen-parrotfish"],
    },
  },
  // Denominator row: Cinderella's Castle
  // Overhead: Ocean Frontiers calls it a shallow open cavern network of interconnected rooms, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "cinderellas-castle",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/cinderellas-castle-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Cinderella's Castle",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3494,
      forecastLongitude: -81.0828,
      description:
        "A shallow reef cut by passages, pillars and windows in the rock, with elkhorn coral guarding the top. The passages are overhead; stay out of them and dive the open reef.",
      marineLife: "Juvenile yellowtail damselfish · elkhorn coral · reef fish",
      marineLifeDescription:
        "Juvenile yellowtail damselfish glow with blue spots beneath the elkhorn.",
      difficultyLevel: "intermediate",
      depthMinMeters: 7,
      maxDepthMeters: 18,
      fitTone: "unknown",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. Passages cut the rock here, so keep to the open reef.",
      creatureSlugs: [
        "yellowtail-damselfish",
        "elkhorn-coral",
        "queen-parrotfish",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Snapper Hole
  // Overhead: the source describes a cavern route past direct daylight, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "snapper-hole-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/snapper-hole-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Snapper Hole",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3441,
      forecastLongitude: -81.0778,
      description:
        "A labyrinth of swim-throughs, tunnels, crevasses and arches in the rock, all overhead; stay out of them and dive the open reef. An 1872 anchor leans on a coral head outside.",
      marineLife: "Schoolmaster snapper · bluestriped grunts · porkfish · green morays",
      marineLifeDescription:
        "Snapper and grunts school over the reef, and porkfish sit under the ledges.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      minimumCertificationLevel: "advanced_open_water",
      fitTone: "demanding",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. The tunnels and cavern are overhead too.",
      landmarks: [
        {
          name: "Spanish-style anchor",
          kind: "pointOfInterest",
          note: "An 1872 anchor leaning on a freestanding coral head outside the tunnels.",
        },
      ],
      creatureSlugs: ["schoolmaster-snapper", "bluestriped-grunt", "porkfish", "green-moray"],
    },
  },
  // Denominator row: Dragon's Lair
  // Overhead: Ocean Frontiers describes the dive winding through tunnels, nooks and alcoves, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "dragons-lair",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/dragons-lair-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Dragon's Lair",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3429,
      forecastLongitude: -81.078,
      description:
        "A ridge with a drop on either side, cut by tunnels, nooks and alcoves, and named for a coral outcrop shaped like a dragon's head. Stay out of the tunnels. Depending on the wind, the boat can sit over a reef top no deeper than 6 m.",
      marineLife: "French angelfish · queen parrotfish · bluestriped grunts · star coral",
      marineLifeDescription:
        "Angelfish and parrotfish work the ridge, with grunts in the shade of the coral.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      fitTone: "unknown",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. Stay on the open ridge, which drops away on either side.",
      creatureSlugs: [
        "french-angelfish",
        "queen-parrotfish",
        "bluestriped-grunt",
        "great-star-coral",
      ],
    },
  },
  // Denominator row: Gigglin' Marlin
  // Overhead: the source describes a cavern route past direct daylight, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "gigglin-marlin-legacy",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/gigglin-marlin-legacy-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Gigglin' Marlin Legacy",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.3041,
      forecastLongitude: -81.0728,
      description:
        "Known locally as Parrot Fish Caves, with a wide, low cavern like a letterbox. The cavern is overhead; stay out of it and dive the open reef around it.",
      marineLife: "Parrotfish · midnight parrotfish · rainbow parrotfish",
      marineLifeDescription:
        "Big parrotfish crunch the rock you can hear before you see them. Smaller species spawn in the afternoon.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 17,
      fitTone: "welcoming",
      fitNote: "The cavern is wide, low and overhead. Stay out of it.",
      creatureSlugs: [
        "midnight-parrotfish",
        "rainbow-parrotfish",
        "queen-parrotfish",
        "stoplight-parrotfish",
      ],
    },
  },
  // Denominator row: Grouper Grotto
  // Overhead: Ocean Frontiers describes narrow passages joined by low-ceilinged tunnels throughout the site, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "grouper-grotto",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/grouper-grotto-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Grouper Grotto",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2963,
      forecastLongitude: -81.086,
      description:
        "A protected grouper spawning zone on the windswept southeast corner. Narrow rocky passages join low tunnels; stay out of them. The deeper reef to the south opens into soft corals and sponges.",
      marineLife: "Groupers · eagle rays · reef fish",
      marineLifeDescription: "Coney, graysby, Nassau, black and tiger groupers live here.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote:
        "A windswept corner where conditions vary and the sea can be rough. Current not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote:
        "The passages and low tunnels are overhead; stay out of them. A windswept corner that needs decent weather.",
      creatureSlugs: [
        "nassau-grouper",
        "black-grouper",
        "coney",
        "tiger-grouper",
        "spotted-eagle-ray",
      ],
    },
  },
  // Denominator row: Scuba Bowl
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "scuba-bowl-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/scuba-bowl-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Scuba Bowl",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2923,
      forecastLongitude: -81.088,
      description:
        "A winding wall face with two big pinnacles and a mushroom formation like a church spire. It is the most exposed of The Corner sites and a little deeper than most, and it drifts well.",
      marineLife: "Cubera snapper · schooling fish",
      marineLifeDescription:
        "Cubera snapper up to a meter long patrol the edge and move off if you crowd them.",
      difficultyLevel: "intermediate",
      depthMinMeters: 24,
      maxDepthMeters: 30,
      currentNote:
        "The most exposed of The Corner sites, with upwellings and currents. Best as a drift dive and can be hard to get on. Carry an SMB.",
      divePlan:
        "Down the mooring to about 24 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Deep, exposed and rewarding for experienced divers.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["cubera-snapper", "common-sea-fan", "giant-barrel-sponge", "black-coral"],
    },
  },
  // Denominator row: Pat's Wall
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "pats-wall",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/pats-wall-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Pat's Wall",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2929,
      forecastLongitude: -81.089,
      description:
        "A canyon east of the pin leads to a long, narrow swim-through along the wall; it is overhead, so stay out of it. A big buttress to the west holds heavy schools of fish. Hammerheads are reported here, but rarely.",
      marineLife: "Reef sharks · schooling fish",
      marineLifeDescription:
        "Heavy schools of fish gather at the big buttress, with reef sharks along the wall.",
      difficultyLevel: "intermediate",
      depthMinMeters: 19,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 19 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "A deep wall. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "common-sea-fan",
        "giant-barrel-sponge",
        "horse-eye-jack",
      ],
    },
  },
  // Denominator row: Old Isaac's
  {
    slug: "old-isaacs",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/old-isaacs-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Old Isaac's",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2953,
      forecastLongitude: -81.0891,
      description:
        "A ledge that falls from 8 m to 15 m, with a rubble bottom full of small creatures and a line of coral heads near 18 m. At the eastern edge, coral outplanting trees stand in the water.",
      marineLife: "Yellowhead jawfish · pike blennies · reef fish",
      marineLifeDescription: "Approach low and slow and the jawfish stay out of their burrows.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote: "A relaxed ledge for macro lovers.",
      creatureSlugs: ["yellowhead-jawfish", "peacock-flounder", "spinyhead-blenny", "bar-jack"],
    },
  },
  // Denominator row: McKenney's Canyon
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "jack-mckenneys-canyons",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/jack-mckenneys-canyons-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Jack McKenney's Canyons",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2934,
      forecastLongitude: -81.0904,
      description:
        "A sandy arena under the boat, then a canyon at the west edge that leads to the wall. A tag receiver at 6 m collects data for the government's shark program.",
      marineLife: "Caribbean reef sharks · sea fans · sponges",
      marineLifeDescription:
        "Caribbean reef sharks are seen over the sand at times. Keep your distance.",
      difficultyLevel: "intermediate",
      depthMinMeters: 19,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 19 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "A canyon to the wall, with reef sharks sometimes over the sand.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "caribbean-reef-shark",
        "common-sea-fan",
        "black-coral",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: The Maze
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "the-maze-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/the-maze-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "The Maze",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.294,
      forecastLongitude: -81.0923,
      description:
        "A shallow shelf at 12 to 14 m above the wall, cut by narrow canyons, buttresses and pinnacles. A bright sand bowl beside the pin gives easy extra time.",
      marineLife: "Sharks · scorpionfish · reef fish",
      marineLifeDescription: "Scorpionfish blend into the reef. Look, don't touch.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 12 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "Shallow shelf and a wall below it. The floor is yours to hold.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-scorpionfish",
        "caribbean-reef-shark",
        "common-sea-fan",
        "queen-parrotfish",
      ],
    },
  },
  // Denominator row: Lighthouse Wall
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "lighthouse-wall-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/lighthouse-wall-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Lighthouse Wall",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2936,
      forecastLongitude: -81.094,
      description:
        "Rocky points jut from the wall with sand channels pouring between them. A rope hangs, covered in sponge, over the void in the deeper part of the dive.",
      marineLife: "Longsnout butterflyfish · star coral",
      marineLifeDescription: "Plates of star coral spread out from the wall.",
      difficultyLevel: "intermediate",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 20 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "Dramatic and deep; the lighthouse onshore helps you keep your bearings.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "longsnout-butterflyfish",
        "mountainous-star-coral",
        "common-sea-fan",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: Playing Field
  {
    slug: "playing-fields-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/playing-field-reef-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Playing Fields",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2928,
      forecastLongitude: -81.105,
      description:
        "Three freestanding coral heads sit in a row under the boat, joined by a figure-eight route. It is a good site for star coral spawning each autumn and for yellow stingrays on the rubble.",
      marineLife: "Yellow stingrays · jacks · chub",
      marineLifeDescription: "Chub, bar jacks and creole wrasse make the safety stop a show.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote: "Easy figure-eight route and a fine safety stop.",
      creatureSlugs: [
        "yellow-stingray",
        "bar-jack",
        "bermuda-chub",
        "creole-wrasse",
        "mountainous-star-coral",
      ],
    },
  },
  // Denominator row: Lodge Anchor
  {
    slug: "lodge-anchor-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/lodge-anchor-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Lodge Anchor",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2905,
      forecastLongitude: -81.1126,
      description:
        "An anchor from the 1794 Wreck of the Ten Sails stands against the reef a short swim east of the pin. The deeper reef has fans, plumes and big hard coral colonies.",
      marineLife: "Peacock flounders · sea plumes · fans",
      marineLifeDescription: "Peacock flounders flash white and blue if disturbed.",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote: "Quiet, shallow and easy to navigate.",
      landmarks: [
        {
          name: "1794 anchor",
          kind: "reefHistory",
          note: "An anchor from the Wreck of the Ten Sails, standing against the reef east of the pin.",
        },
      ],
      creatureSlugs: ["peacock-flounder", "sea-plume", "common-sea-fan", "mountainous-star-coral"],
    },
  },
  // Denominator row: The Arch
  {
    slug: "the-arch-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/the-arch-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "The Arch",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2905,
      forecastLongitude: -81.1144,
      description:
        "A natural arch on a compact reef, ten minutes from the dock. The swim-through is overhead; stay out of it. Narrow cuts and channels join the pin to the arch.",
      marineLife: "Banded coral shrimp · brain coral · reef fish",
      marineLifeDescription:
        "Purple lace coral and red algae grow beneath the arch, and shrimp wave from the cracks.",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote:
        "A compact reef with an arch to look at. The swim-through is optional and overhead; going around is the plan.",
      creatureSlugs: [
        "banded-coral-shrimp",
        "grooved-brain-coral",
        "queen-parrotfish",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Dumbo's Lookout (Dumbo's Drop-Off)
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "dumbos-drop-off",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/dumbos-dropoff-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Dumbo's Drop-Off",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2888,
      forecastLongitude: -81.1167,
      description:
        "The pin sits at the foot of a sloped miniwall, with a few ledges and the main wall just south. An elephant statue, now grown over, perches about 24 m down.",
      marineLife: "Surgeonfish · butterflyfish · damselfish",
      marineLifeDescription: "Ledges give small fish somewhere to hide above the drop.",
      difficultyLevel: "intermediate",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 20 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "A good story, and a wall below it.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Dumbo",
          kind: "pointOfInterest",
          note: "An elephant statue chained to the reef long ago, now overgrown on a perch near 24 m.",
        },
      ],
      creatureSlugs: ["ocean-surgeonfish", "banded-butterflyfish", "dusky-damselfish", "blue-tang"],
    },
  },
  // Denominator row: Three Sisters
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "three-sisters-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/three-sisters-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Three Sisters",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2885,
      forecastLongitude: -81.1177,
      description:
        "Three tall pinnacles named Agatha, Bertha and Cleo, reached through a long canyon that starts near the pin. The third leans, and is at its best seen from 21 m.",
      marineLife: "Wall life · pinnacles",
      marineLifeDescription: "The pinnacles are covered in coral and sponge.",
      difficultyLevel: "intermediate",
      depthMinMeters: 21,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 21 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "Pinnacles and a canyon, with a wall below.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["common-sea-fan", "giant-barrel-sponge", "black-coral", "bar-jack"],
    },
  },
  // Denominator row: Lost Valley
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "lost-valley-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/lost-valley-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Lost Valley",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.289,
      forecastLongitude: -81.1195,
      description:
        "Pinnacles and wall that sat lost for ten years before a drift rediscovered them. The deeper High Rock walls see more current, so it is usually drifted.",
      marineLife: "Blue tang · groupers",
      marineLifeDescription:
        "Blue tangs stream along the reef. Big groupers hold at the edge of the wall.",
      difficultyLevel: "intermediate",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      currentNote:
        "The deeper walls in this part of High Rock often have current. Drift the site, carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 20 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A drift along a deep wall. For experienced divers.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["blue-tang", "black-grouper", "common-sea-fan", "giant-barrel-sponge"],
    },
  },
  // Denominator row: Kangaroo Gorge
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "kangaroo-gorge",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/kangaroo-gorge-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Kangaroo Gorge",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2889,
      forecastLongitude: -81.1214,
      description:
        "The dive starts at a gorge with a deep swim-through, which is overhead; stay out of it and go over the top. Coral cover is among the best on the East End.",
      marineLife: "Spotted eagle rays · sponges · corals",
      marineLifeDescription:
        "Spotted eagle rays dig for crustaceans in the sand patches near 21 m.",
      difficultyLevel: "intermediate",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      currentNote:
        "Some current now and then, which keeps visibility high. Carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 20 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A gorge you cross over, not through, and a wall beyond. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "common-sea-fan",
        "giant-barrel-sponge",
        "mountainous-star-coral",
      ],
    },
  },
  // Denominator row: Tarpon Terrace
  {
    slug: "tarpon-terrace-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/tarpon-terrace-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Tarpon Terrace",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2911,
      forecastLongitude: -81.1233,
      description:
        "A tall, narrow passage that tarpon use. Stay out of it and watch from outside. Big coral heads on the sand beyond each hold their own small reef.",
      marineLife: "Tarpon · reef fish",
      marineLifeDescription: "The tarpon are in no hurry to move for divers.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote:
        "Close to shore with a big swell, so it is not always diveable. Current not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote:
        "Check conditions with the guide before entering. Tarpon seen from outside the passage, when the sea allows.",
      creatureSlugs: ["tarpon", "queen-parrotfish", "french-angelfish", "bluestriped-grunt"],
    },
  },
  // Denominator row: High Rock Dropoff
  // Ungated: Ocean Frontiers describes the shallow top as an all-levels dive in its own right, with an 18 m (60 ft) floor; the drop-off lies beyond the plan.
  {
    slug: "high-rock-drop-off-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/high-rock-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "High Rock Drop Off",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2901,
      forecastLongitude: -81.124,
      description:
        "A sheltered wall with a top at 14 m, a large pinnacle on the east edge, and plenty of crevices. Hawksbill turtles are often in the blue.",
      marineLife: "Hawksbill turtles · reef fish",
      marineLifeDescription: "The hawksbills are curious and close.",
      difficultyLevel: "beginner",
      depthMinMeters: 14,
      maxDepthMeters: 18,
      divePlan:
        "Stay on the reef top. The plan's floor is 18 m (60 ft). The drop-off beyond is a separate, deeper dive.",
      fitTone: "welcoming",
      fitNote: "Protected and shallow on top. The wall falls far past the plan's 18 m floor.",
      creatureSlugs: [
        "hawksbill-turtle",
        "common-sea-fan",
        "giant-barrel-sponge",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: River of Sands
  // Ungated: Ocean Frontiers describes the shallow top as an all-levels dive in its own right, with an 18 m (60 ft) floor; the drop-off lies beyond the plan.
  {
    slug: "river-of-sands-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/river-of-sands-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "River of Sands",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2906,
      forecastLongitude: -81.1258,
      description:
        "Sand pours down a 45-degree slope through narrow channels in the reef wall. The top of the wall is only 15 m deep and the site is sheltered.",
      marineLife: "Razorfish · reef fish",
      marineLifeDescription: "Razorfish hover over the sand and dart into it when startled.",
      difficultyLevel: "beginner",
      depthMinMeters: 15,
      maxDepthMeters: 18,
      divePlan:
        "Stay on the reef top and hold 18 m (60 ft). The drop-off beyond is a separate, deeper dive.",
      fitTone: "welcoming",
      fitNote: "A sheltered, shallow top with overhangs below. The wall falls beyond the plan.",
      creatureSlugs: ["rosy-razorfish", "green-razorfish", "common-sea-fan", "queen-parrotfish"],
    },
  },
  // Denominator row: Ironshore Gardens
  // Overhead: the source describes a cavern route past direct daylight, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "ironshore-gardens",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/ironshore-gardens-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Ironshore Gardens",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2914,
      forecastLongitude: -81.1436,
      description:
        "A tangle of ridges, canyons, arches and tunnels. One tunnel, called The Throat, passes through a cavern full of glassy sweepers. The tunnels and cavern are overhead; stay out of them and dive the open reef.",
      marineLife: "Queen parrotfish · French angelfish · bluestriped grunts",
      marineLifeDescription:
        "Parrotfish and angelfish work the ridges, with grunts over the coral.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      minimumCertificationLevel: "advanced_open_water",
      fitTone: "demanding",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. The Throat and the cavern stay off the plan.",
      creatureSlugs: [
        "queen-parrotfish",
        "french-angelfish",
        "bluestriped-grunt",
        "great-star-coral",
      ],
    },
  },
  // Denominator row: Maggie's Maze
  {
    slug: "maggies-maze",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/maggies-maze-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Maggie's Maze",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2912,
      forecastLongitude: -81.1448,
      description:
        "A long winding canyon that starts shallow and runs to a deeper sand patch. It ends at a swim-through and an arch that frames the blue; the swim-through is overhead, so stay out of it. Nurse sharks rest under its low sides.",
      marineLife: "Nurse sharks · fairy basslets",
      marineLifeDescription: "Fairy basslets swim upside down under the overhangs.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      fitTone: "unknown",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. A winding canyon to follow on the open reef. Skip the swim-through at its end.",
      creatureSlugs: ["nurse-shark", "royal-gramma", "queen-parrotfish", "french-angelfish"],
    },
  },
  // Denominator row: Crusher's Wall
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "crushers-wall",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/crushers-wall-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Crusher's Wall",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2901,
      forecastLongitude: -81.146,
      description:
        "Two open ways to begin: straight to the drop-off, or down a canyon from a sand patch, and both lead to two pinnacles. A dark swim-through offers a third start; it is overhead, so stay out of it. An undersea cable runs down the wall.",
      marineLife: "Wall life · pinnacles",
      marineLifeDescription: "Plenty of headlands and ledges to explore past the pinnacles.",
      difficultyLevel: "intermediate",
      depthMinMeters: 19,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 19 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote: "Pinnacles and canyons on a wall. Skip the swim-through and hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["common-sea-fan", "giant-barrel-sponge", "black-coral", "queen-parrotfish"],
    },
  },
  // Denominator row: Kelly's Caverns
  // Overhead: Ocean Frontiers describes canyons and tunnels under the boat, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "kellys-caverns",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/kellys-caverns-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Kelly's Caverns",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2913,
      forecastLongitude: -81.146,
      description:
        "Three areas in one dive: canyons and tunnels under the boat, a rubble field along the miniwall, and clean white sand beyond. Stay out of the tunnels. Move slowly over the rubble and sand and the shy residents come out.",
      marineLife: "Pike blennies · yellowhead jawfish · sea slugs",
      marineLifeDescription:
        "The rubble field draws macro hunters. The sand holds blennies and jawfish.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      fitTone: "unknown",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. The rubble and sand are open.",
      creatureSlugs: [
        "yellowhead-jawfish",
        "spinyhead-blenny",
        "peacock-flounder",
        "great-barracuda",
      ],
    },
  },
  // Denominator row: Little House on the Prairie
  // Overhead: Ocean Frontiers describes connected tunnels under the boat as the main route, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "little-house-on-the-prairie",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/little-house-on-the-prairie-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Little House on the Prairie",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2912,
      forecastLongitude: -81.1482,
      description:
        "A reef riddled with holes: open reef to the south, then connected tunnels under the boat. The tunnels are overhead; stay out of them. Huge star corals on the open reef draw coral spawning night dives each autumn.",
      marineLife: "Blackbar soldierfish · star corals",
      marineLifeDescription: "Soldierfish wear small isopods on their heads.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      fitTone: "unknown",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. Dive the corals by the boat.",
      creatureSlugs: [
        "blackbar-soldierfish",
        "mountainous-star-coral",
        "great-star-coral",
        "queen-parrotfish",
      ],
    },
  },
  // Denominator row: Fantasy Land (Fantasea Land)
  // Overhead: Ocean Frontiers describes intricate swim-throughs and archways to get lost in, so it is beyond a cavern card: no gate, and the prose says to stay out of the tunnels.
  {
    slug: "fantasea-land",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/fantasea-land-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Fantasea Land",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2911,
      forecastLongitude: -81.1543,
      description:
        "Swim-throughs, overhangs and archways, with large coral meadows south of the miniwall. The swim-throughs are overhead; stay out of them. You finish on top of the miniwall at 8 m.",
      marineLife: "Star corals · gobies · blennies",
      marineLifeDescription: "A good place for star coral spawning each autumn.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      fitTone: "unknown",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. Dive the open miniwall top.",
      creatureSlugs: [
        "mountainous-star-coral",
        "great-star-coral",
        "sharknose-goby",
        "redlip-blenny",
      ],
    },
  },
  // Denominator row: Elmo's Wall
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "elmos-wall",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/elmos-wall-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Elmo's Wall",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2895,
      forecastLongitude: -81.1703,
      description:
        "A narrow east-west ridge that drops on both sides, to sand at 21 m inside and to the deep outside. A straight, flat-roofed swim-through under the boat is overhead; stay out of it.",
      marineLife: "Coral · sponges",
      marineLifeDescription: "Calm and sheltered on windier days.",
      difficultyLevel: "intermediate",
      depthMinMeters: 19,
      maxDepthMeters: 30,
      currentNote: "Sheltered from wind and waves.",
      divePlan:
        "Down the mooring to about 19 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Calm and sheltered, but the inside sand tempts you deeper than planned.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "common-sea-fan",
        "giant-barrel-sponge",
        "mountainous-star-coral",
        "queen-parrotfish",
      ],
    },
  },
  // Denominator row: Frank Sound Gardens
  {
    slug: "frank-sound-gardens",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/frank-sound-gardens-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Frank Sound Gardens",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2907,
      forecastLongitude: -81.1761,
      description:
        "A shallow site beside the Frank Sound channel, mostly under 12 m, on flat sand with coral fingers. It suits slow macro hunting.",
      marineLife: "Trunkfish · reef fish",
      marineLifeDescription: "Trunkfish blow sand off buried food.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 15,
      fitTone: "welcoming",
      fitNote: "Very shallow and open, with lots of time.",
      creatureSlugs: [
        "smooth-trunkfish",
        "spotted-trunkfish",
        "queen-parrotfish",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Breakers Wall (Breakers' Cutback)
  // Gate: the wall drops past recreational depth; the plan's floor is 30 m (100 ft, as Ocean Frontiers briefs it), so Advanced Open Water without the Deep specialty, per the walls rule.
  {
    slug: "breakers-cutback",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.oceanfrontiers.com/breakers-cutback-dive-site-in-grand-cayman",
    ],
    briefing: {
      name: "Breakers' Cutback",
      locationName: "East End, Grand Cayman",
      forecastLatitude: 19.2888,
      forecastLongitude: -81.194,
      description:
        "The farthest regular south-side dive, off the lighthouse. The wall overhangs, with sponges in its shade, and just west it cuts inland at a right angle.",
      marineLife: "Sponges · overhang",
      marineLifeDescription: "A light brings back the color in the shade of the overhang.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 18 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      currentNote:
        "Current not documented; ask the crew on the day. The East End is windward, so the surface can be rough.",
      fitTone: "demanding",
      fitNote:
        "An overhanging wall. Stay clear of the overhang, carry a light and hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "lavender-rope-sponge",
        "black-coral",
      ],
    },
  },
  // Denominator row: Japanese Gardens
  // Depth: Frommer's gives 9 to 15 m; DoE moors Japanese Garden East at 29 ft.
  // Overhead: Frommer's describes a maze of passageways, so it is beyond a cavern card: no gate, and the prose says to stay out of the passageways.
  {
    slug: "japanese-gardens-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.caymanturtledivers.com/grand-cayman-wall-diving-sites",
      "https://www.frommers.com/destinations/cayman-islands/the-best-scuba-diving",
    ],
    briefing: {
      name: "Japanese Gardens",
      locationName: "South Sound, Grand Cayman",
      forecastLatitude: 19.2683,
      forecastLongitude: -81.3453,
      description:
        "A reef inside the south wall, with a maze of passageways and schools of Bermuda chub. Juvenile fish hide in the elkhorn coral. The passageways are overhead; stay out of them.",
      marineLife: "Bermuda chub · juvenile fish · spotted drums · elkhorn coral",
      marineLifeDescription:
        "Chub school over the reef and small bright juveniles shelter in the coral.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 15,
      fitTone: "welcoming",
      fitNote: "Shallow and detailed. The passageways are overhead; stay out of them.",
      creatureSlugs: ["bermuda-chub", "spotted-drum", "elkhorn-coral", "french-angelfish"],
    },
  },
  // Denominator row: Laura's Reef
  // Depth: DoE mooring 32 ft is the only published figure.
  // Overhead: SSI and Indigo describe a maze of canyons and swim-throughs with overhangs, so it is beyond a cavern card: no gate, and the prose says to stay out of the swim-throughs. Depth: the DoE mooring is 10 m (32 ft); the sand slope runs on toward the deep, so the plan floor is 18 m.
  {
    slug: "lauras-reef",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divessi.com/en/mydiveguide/divesite/lauras-reef-3007",
      "https://www.livingthedreamdivers.com/cayman-diving/cayman-diving-sites/",
    ],
    briefing: {
      name: "Laura's Reef",
      locationName: "South Sound, Grand Cayman",
      forecastLatitude: 19.2655,
      forecastLongitude: -81.3625,
      description:
        "A winding maze of canyons, coral fingers and swim-throughs beside a sloping sand patch that runs out toward the deep, past the plan. The swim-throughs are overhead; stay out of them. Nurse sharks rest under the overhangs, so keep clear.",
      marineLife: "Nurse sharks · lobsters · crabs · moray eels",
      marineLifeDescription:
        "Nurse sharks rest in the shallow overhangs, and lobsters and eels fill the reef's sides.",
      difficultyLevel: "intermediate",
      depthMinMeters: 10,
      maxDepthMeters: 18,
      currentNote: "A south-side site, dived when northerly winds rule out the north and west.",
      divePlan:
        "Stay on the reef at the mooring depth and hold 18 m (60 ft). The sand slope runs on toward the deep, so do not follow it.",
      fitTone: "welcoming",
      fitNote:
        "A maze of canyons and overheads. Stay out of the swim-throughs and keep clear of the sharks resting under the ledges.",
      creatureSlugs: ["nurse-shark", "spiny-lobster", "green-moray", "spotted-moray"],
    },
  },
  // Denominator row: LCM David Nicholson (wreck)
  // Depth: Red Sail gives about 65 ft, Divezone 60 ft, DoE mooring 60 ft.
  {
    slug: "lcm-david-nicholson",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://redsailcayman.com/a-guide-to-shipwreck-dives-in-the-cayman-islands/",
      "https://divezone.net/diving/cayman-islands",
    ],
    briefing: {
      name: "LCM David Nicholson",
      locationName: "George Town, Grand Cayman",
      forecastLatitude: 19.2873,
      forecastLongitude: -81.3926,
      description:
        "A small landing craft sunk off a George Town hotel, now crusted with coral. It sits on sand at about 20 m, a short swim from the hotel's house reef. Stay outside the hull.",
      marineLife: "Purple finger sponges · yellow tube sponges · angelfish · snappers",
      marineLifeDescription:
        "Coral growth has covered the hull, with sponges, angelfish and snappers around it.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 20,
      currentNote:
        "Shore entry over ironshore: use the steps or ladder, check the surge and plan to exit at the same entry. Watch for boat and watersports traffic. Current not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote: "A small wreck with lots of growth. Stay outside the hull.",
      landmarks: [
        {
          name: "LCM David Nicholson",
          kind: "wreckFeature",
          note: "A landing craft on sand at about 20 m.",
        },
      ],
      creatureSlugs: [
        "yellow-tube-sponge",
        "gray-angelfish",
        "schoolmaster-snapper",
        "sergeant-major",
      ],
    },
  },
  // Denominator row: Sunset House Reef (Sunset Reef, the Amphitrite mermaid)
  // Position: the shore entry and the reef just off it, moved east of SSI's reef point so it sits about 220 m from the LCM David Nicholson pin; approximate, and the site has no DoE mooring.
  {
    slug: "sunset-house-reef",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divessi.com/en/mydiveguide/divesite/sunset-house-reef-110401",
      "https://divezone.net/diving/cayman-islands",
      "https://www.explorecayman.com/things-to-do/shore-diving-in-the-cayman-islands",
    ],
    briefing: {
      name: "Sunset House Reef",
      locationName: "George Town, Grand Cayman",
      forecastLatitude: 19.2868,
      forecastLongitude: -81.3905,
      description:
        "A hotel house reef reached from its pier. The reef starts near 9 m and slopes to about 15 m, cut by canyons, with a bronze mermaid statue at its base in about 17 m and a wreck a short swim away.",
      marineLife: "Sea turtles · eels · nurse sharks",
      marineLifeDescription: "Resident turtles, eels and nurse sharks share the reef.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 17,
      currentNote:
        "Shore entry over ironshore: use the steps or ladder, check the surge and plan to exit at the same entry. Watch for boat and watersports traffic. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Easy shore diving in clear water. The wreck beyond is a separate dive.",
      landmarks: [
        {
          name: "Amphitrite",
          kind: "underwaterMonument",
          note: "A bronze mermaid statue at the base of the reef.",
        },
      ],
      creatureSlugs: ["hawksbill-turtle", "green-moray", "nurse-shark", "queen-parrotfish"],
    },
  },
  // Denominator row: Devil's Grotto
  // Depth: DoE moors at 20 ft; the dive center gives 40 ft.
  // Overhead: Red Sail calls this cavern diving and Divetech describes caverns and tunnels, so the short lit swim-throughs get no cavern gate; the prose says to stay out of the tunnels.
  {
    slug: "devils-grotto-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://redsailcayman.com/exploring-grand-caymans-hidden-dive-sites-a-divers-paradise/",
      "https://www.explorecayman.com/eden-rock-diving-center",
      "https://cadivingnews.com/?p=1108",
    ],
    briefing: {
      name: "Devil's Grotto",
      locationName: "George Town, Grand Cayman",
      forecastLatitude: 19.2917,
      forecastLongitude: -81.3882,
      description:
        "Next to Eden Rock, a second network of caves and tunnels a short swim from the same shore entry. Coral heads are large. The swim-throughs are overhead; stay out of the tunnels and look in from the doorway.",
      marineLife: "Tarpon · barracuda · groupers · lobsters",
      marineLifeDescription: "Tarpon, groupers and the odd barracuda hold around the coral heads.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 12,
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "Shore entry over ironshore: use the steps or ladder, check the surge and plan to exit at the same entry. Watch for boat and watersports traffic. Currents are usually weak.",
      fitTone: "demanding",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. Look in from the doorway of the short tunnels.",
      creatureSlugs: [
        "tarpon",
        "great-barracuda",
        "black-grouper",
        "spiny-lobster",
        "queen-parrotfish",
      ],
    },
  },
  // Denominator row: Eden Rock
  // Depth: DoE moors both sites at 20 ft; the dive center gives 40 ft.
  // Overhead: Red Sail calls this cavern diving and Divetech describes caverns and tunnels, so the short lit swim-throughs get no cavern gate; the prose says to stay out of the tunnels.
  {
    slug: "eden-rock-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://redsailcayman.com/exploring-grand-caymans-hidden-dive-sites-a-divers-paradise/",
      "https://www.explorecayman.com/eden-rock-diving-center",
      "https://cadivingnews.com/?p=1108",
    ],
    briefing: {
      name: "Eden Rock",
      locationName: "George Town, Grand Cayman",
      forecastLatitude: 19.2931,
      forecastLongitude: -81.3873,
      description:
        "A shore dive from South Church Street, a short swim to a reef of tunnels and swim-throughs that rise from a 12 m sand floor. The swim-throughs are overhead; stay out of the tunnels and look in from the doorway.",
      marineLife: "Tarpon · barracuda · groupers · lobsters",
      marineLifeDescription: "Tarpon, groupers and the odd barracuda hold around the coral heads.",
      difficultyLevel: "intermediate",
      depthMinMeters: 6,
      maxDepthMeters: 12,
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "Shore entry over ironshore: use the steps or ladder, check the surge and plan to exit at the same entry. Watch for boat and watersports traffic. Currents are usually weak.",
      fitTone: "demanding",
      fitNote:
        "The swim-throughs are overhead; stay out of them and dive the open reef. Look in from the doorway of the short tunnels.",
      creatureSlugs: [
        "tarpon",
        "great-barracuda",
        "black-grouper",
        "spiny-lobster",
        "queen-parrotfish",
      ],
    },
  },
  // Denominator row: Balboa (wreck)
  // Depth: DoE mooring 25 ft; Red Sail gives no depth.
  {
    slug: "balboa",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://redsailcayman.com/a-guide-to-shipwreck-dives-in-the-cayman-islands/",
    ],
    briefing: {
      name: "Balboa",
      locationName: "George Town, Grand Cayman",
      forecastLatitude: 19.2972,
      forecastLongitude: -81.3864,
      description:
        "The scattered remains of a freighter that sank in a 1932 hurricane, with coral, sponges and tarpon on the wreckage. It lies in the main channel between the George Town dock and the cruise ships, which makes it harder to dive. Stay outside the hull.",
      marineLife: "Tarpon · sponges · coral",
      marineLifeDescription: "Tarpon hold over the relics. Most of the ship has gone.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 8,
      currentNote:
        "No diving while a ship or tender is moving in the channel. Carry an SMB. Surface only at the line.",
      fitTone: "unknown",
      fitNote: "Shallow, but in a working shipping channel. Confirm the dive with the crew.",
      creatureSlugs: ["tarpon", "common-sea-fan", "yellow-tube-sponge", "queen-parrotfish"],
    },
  },
  // Denominator row: La Mesa
  // Depth: DoE mooring 34 ft; Red Sail puts the top near 30 ft and the base at 50 to 55 ft.
  {
    slug: "la-mesa-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
      "https://redsailcayman.com/our-dive-instructors-favourite-dive-sites-in-grand-cayman/",
    ],
    briefing: {
      name: "La Mesa",
      locationName: "Seven Mile Beach, Grand Cayman",
      forecastLatitude: 19.3217,
      forecastLongitude: -81.3931,
      description:
        "A table-topped reef with its top at about 9 m and its base at 15 to 17 m. Ledges on the sides hold cleaning stations, and the top is busy with jacks, chub, barracuda and snapper.",
      marineLife: "Groupers · jacks · chub · barracuda · snapper",
      marineLifeDescription:
        "Watch a grouper being cleaned at the ledges, then finish among the schools on top.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 17,
      currentNote:
        "Watersports and boat traffic off Seven Mile Beach: listen for engines, surface at the line and carry an SMB. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A compact table reef, easy to circle.",
      creatureSlugs: [
        "bermuda-chub",
        "great-barracuda",
        "horse-eye-jack",
        "squirrelfish",
        "schoolmaster-snapper",
      ],
    },
  },
  // Denominator row: Killer Pillar
  // Depth: DoE mooring 30 ft is the only published figure.
  // Depth: the DoE mooring is 9 m (30 ft), the only published figure; the plan floor is 18 m because the miniwall drops off.
  {
    slug: "killer-pillar",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divessi.com/en/mydiveguide/divesite/killer-pillar-19205",
    ],
    briefing: {
      name: "Killer Pillar",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3246,
      forecastLongitude: -81.3914,
      description:
        "A shallow reef known for pillar coral on the edge of the miniwall, about 6 m north-east of the mooring line. One of very few places in the Cayman Islands where it grows. The miniwall drops off beyond the mooring.",
      marineLife: "Pillar coral · grunts · snappers · parrotfish · octopus",
      marineLifeDescription:
        "Grunts, snappers and parrotfish work the reef, with octopus in the crevices.",
      conservationNote: "Pillar coral is rare and fragile. Keep fins and hands clear.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      divePlan:
        "Stay on the reef near the mooring at 9 m (30 ft) and hold no deeper than 18 m (60 ft). The miniwall drops off beyond.",
      fitTone: "welcoming",
      fitNote: "Shallow and relaxed, with a rare coral to find.",
      creatureSlugs: [
        "pillar-coral",
        "french-grunt",
        "schoolmaster-snapper",
        "queen-parrotfish",
        "caribbean-reef-octopus",
      ],
    },
  },
  // Denominator row: Lone Star Reef (Lone Star Ledges)
  // Depth: DoE mooring 30 ft; Red Sail puts the site at 60 ft (18 m) and under.
  {
    slug: "lone-star-ledges-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://redsailcayman.com/our-dive-instructors-favourite-dive-sites-in-grand-cayman/",
    ],
    briefing: {
      name: "Lone Star Ledges",
      locationName: "Seven Mile Beach, Grand Cayman",
      forecastLatitude: 19.327,
      forecastLongitude: -81.391,
      description:
        "A shallow reef off Seven Mile Beach, 18 m or less, with a run of overhangs and coral fingers between sandy flats. Named for a restaurant on the shore.",
      marineLife: "Reef fish · lobsters · coral",
      marineLifeDescription:
        "The overhangs and coral fingers hold a wide mix of small and large reef life.",
      difficultyLevel: "beginner",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote:
        "Watersports and boat traffic off Seven Mile Beach: listen for engines, surface at the line and carry an SMB. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Shallow and easy, with ledges worth a slow look.",
      creatureSlugs: ["french-angelfish", "queen-parrotfish", "bluestriped-grunt", "spiny-lobster"],
    },
  },
  // Denominator row: Wildlife Reef
  // Depth: DoE mooring 39 ft is the only published figure.
  {
    slug: "wildlife-reef-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divessi.com/en/mydiveguide/divesite/wildlife-reef-198565",
    ],
    briefing: {
      name: "Wildlife Reef",
      locationName: "Seven Mile Beach, Grand Cayman",
      forecastLatitude: 19.3312,
      forecastLongitude: -81.3898,
      description:
        "Long coral fingers separated by big open sand patches, with hard-bottom reef on the shore side. There is plenty to explore in both directions.",
      marineLife: "Nurse sharks · turtles · blue tang · spotted drums · chromis",
      marineLifeDescription: "Nurse sharks sleep under the ledges and turtles feed along the reef.",
      difficultyLevel: "beginner",
      maxDepthMeters: 12,
      currentNote:
        "Watersports and boat traffic off Seven Mile Beach: listen for engines, surface at the line and carry an SMB. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Easy sandy reef with sharks asleep under the ledges.",
      creatureSlugs: [
        "nurse-shark",
        "hawksbill-turtle",
        "blue-tang",
        "spotted-drum",
        "blue-chromis",
      ],
    },
  },
  // Denominator row: Caribbean Club Sand Chute
  // Depth: DoE mooring 55 ft is the only published figure.
  // Depth: the DoE mooring is 17 m (55 ft), the only published figure; the plan floor is 18 m because the chute slopes on.
  {
    slug: "caribbean-club-sand-chute",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divessi.com/en/mydiveguide/divesite/caribbean-club-sand-chute-134993",
    ],
    briefing: {
      name: "Caribbean Club Sand Chute",
      locationName: "Seven Mile Beach, Grand Cayman",
      forecastLatitude: 19.3321,
      forecastLongitude: -81.3917,
      description:
        "A gently declining sand chute where eagle rays and stingrays forage, with fingers of coral stretching toward the shore. The slope continues past the plan; stay at the mooring depth.",
      marineLife: "Eagle rays · stingrays · reef fish",
      marineLifeDescription:
        "Rays dig in the sand, and snapper and angelfish work the coral fingers.",
      difficultyLevel: "beginner",
      depthMinMeters: 17,
      maxDepthMeters: 18,
      currentNote:
        "Watersports and boat traffic off Seven Mile Beach: listen for engines, surface at the line and carry an SMB. Current not documented; ask the crew on the day.",
      divePlan:
        "Stay at the mooring depth and hold 18 m (60 ft). The sand slope runs on toward the deep, so do not follow it.",
      fitTone: "welcoming",
      fitNote: "A gentle sand slope with a hard floor at 18 m.",
      creatureSlugs: ["spotted-eagle-ray", "southern-stingray", "nurse-shark", "gray-angelfish"],
    },
  },
  // Denominator row: Oro Verde
  // Depth: Red Sail gives a 50 ft maximum for the Paradise Reef and Oro Verde pairing; DoE moors the bow and stern at 50 ft.
  {
    slug: "oro-verde",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://redsailcayman.com/a-guide-to-shipwreck-dives-in-the-cayman-islands/",
      "https://diveredsailcayman.com/dive-sites/",
      "https://www.divetech.com/post/best-scuba-diving-in-west-bay",
    ],
    briefing: {
      name: "Oro Verde",
      locationName: "Seven Mile Beach, Grand Cayman",
      forecastLatitude: 19.3382,
      forecastLongitude: -81.3904,
      description:
        "An old banana trader that went aground in 1976 and was sunk in 1980. Much of it has broken up, leaving a scattered wreck on sand beside Paradise Reef. Stay outside the hull.",
      marineLife: "Eagle rays · reef fish",
      marineLifeDescription: "Eagle rays pass over the sand, and fish gather on the wreckage.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 15,
      fitTone: "welcoming",
      fitNote: "An old wreck in shallow water. Stay outside the hull.",
      landmarks: [
        {
          name: "Oro Verde",
          kind: "wreckFeature",
          note: "A scattered banana-boat wreck on sand.",
        },
      ],
      creatureSlugs: ["spotted-eagle-ray", "french-grunt", "bluestriped-grunt", "gray-angelfish"],
    },
  },
  // Denominator row: Paradise Reef
  // Depth: DoE mooring 46 ft; Red Sail gives a 50 ft maximum.
  {
    slug: "paradise-reef-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
      "https://redsailcayman.com/our-dive-instructors-favourite-dive-sites-in-grand-cayman/",
    ],
    briefing: {
      name: "Paradise Reef",
      locationName: "Seven Mile Beach, Grand Cayman",
      forecastLatitude: 19.3392,
      forecastLongitude: -81.3899,
      description: "A shallow reef, usually paired with the Oro Verde wreck beside it.",
      marineLife: "Reef fish · coral",
      marineLifeDescription: "Life crowds the reef and the neighboring wreck.",
      difficultyLevel: "beginner",
      depthMinMeters: 14,
      maxDepthMeters: 15,
      currentNote:
        "Watersports and boat traffic off Seven Mile Beach: listen for engines, surface at the line and carry an SMB. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Shallow and full of fish.",
      creatureSlugs: ["french-grunt", "blue-tang", "queen-parrotfish", "french-angelfish"],
    },
  },
  // Denominator row: Eagle's Nest
  // Depth: DoE mooring 60 ft is the only published figure.
  {
    slug: "eagles-nest-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divessi.com/en/mydiveguide/divesite/eagles-nest-198196",
    ],
    briefing: {
      name: "Eagle's Nest",
      locationName: "Seven Mile Beach, Grand Cayman",
      forecastLatitude: 19.3414,
      forecastLongitude: -81.3921,
      description:
        "Colorful sponges woven through staghorn coral, a backdrop for spotted eagle rays and plenty of turtles. Nurse sharks hide in the reef. Depth beyond the mooring is not documented; hold 18 m.",
      marineLife: "Spotted eagle rays · turtles · nurse sharks",
      marineLifeDescription:
        "Rays and turtles pass the reef, and nurse sharks tuck in among the coral.",
      difficultyLevel: "intermediate",
      maxDepthMeters: 18,
      currentNote:
        "Watersports and boat traffic off Seven Mile Beach: listen for engines, surface at the line and carry an SMB. Current not documented; ask the crew on the day.",
      divePlan: "Stay on the reef at the mooring depth and hold 18 m (60 ft).",
      fitTone: "welcoming",
      fitNote: "A reef with rays and turtles.",
      creatureSlugs: ["spotted-eagle-ray", "hawksbill-turtle", "nurse-shark", "staghorn-coral"],
    },
  },
  // Denominator row: Aquarium
  // Depth: DoE mooring 34 ft; Red Sail gives a 50 ft maximum for Aquarium North and South.
  {
    slug: "aquarium-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
    ],
    briefing: {
      name: "Aquarium",
      locationName: "Seven Mile Beach, Grand Cayman",
      forecastLatitude: 19.3449,
      forecastLongitude: -81.391,
      description:
        "Coral fingers lead out over sand, where garden eels, stingrays and the odd eagle ray work the bottom. You finish on top of the reef among schools of tang, squirrelfish, jacks and snapper.",
      marineLife: "Garden eels · stingrays · eagle rays · tang · jacks",
      marineLifeDescription: "The sand and the reef top are both busy with fish.",
      difficultyLevel: "beginner",
      depthMinMeters: 10,
      maxDepthMeters: 15,
      currentNote:
        "Watersports and boat traffic off Seven Mile Beach: listen for engines, surface at the line and carry an SMB. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Shallow and lively.",
      creatureSlugs: [
        "garden-eel",
        "southern-stingray",
        "spotted-eagle-ray",
        "blue-tang",
        "squirrelfish",
      ],
    },
  },
  // Denominator row: Doc Poulson
  // Depth: DoE mooring 50 ft; Red Sail puts the wreck at about 60 ft.
  {
    slug: "doc-poulson",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://redsailcayman.com/a-guide-to-shipwreck-dives-in-the-cayman-islands/",
    ],
    briefing: {
      name: "Doc Poulson",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3605,
      forecastLongitude: -81.3992,
      description:
        "An 80 ft former Japanese cable-laying ship, sunk on purpose as an artificial reef. She lies on white sand at about 18 m with good water clarity. Stay outside the hull.",
      marineLife: "Sea fans · sponges · reef fish",
      marineLifeDescription:
        "Coral, sponges and fans have settled on the hull, and the clear water suits photographers.",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 18,
      fitTone: "welcoming",
      fitNote: "A photogenic wreck at moderate depth. Stay outside the hull.",
      landmarks: [
        {
          name: "Doc Poulson",
          kind: "wreckFeature",
          note: "An 80 ft cable-laying ship on white sand.",
        },
      ],
      creatureSlugs: [
        "common-sea-fan",
        "yellow-tube-sponge",
        "queen-angelfish",
        "bluestriped-grunt",
      ],
    },
  },
  // Denominator row: Sand Chute
  // Depth: Red Sail puts the top of the chute near 60 ft and says it drops well over 300 ft; DoE moors at 55 ft.
  {
    slug: "sand-chute-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
      "https://www.indigodivers.com/dive-sites",
    ],
    briefing: {
      name: "Sand Chute",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3617,
      forecastLongitude: -81.4017,
      description:
        "A broad sand slope like a ski run, bordered by coral mountains, whose top lies near 18 m and drops far past recreational depth. The Kittiwake was sunk at its head. Swim-throughs alongside are overhead; stay out of them.",
      marineLife: "Coral formations · sand slope",
      marineLifeDescription: "Mountains of coral frame the slope.",
      difficultyLevel: "intermediate",
      depthMinMeters: 17,
      maxDepthMeters: 30,
      currentNote:
        "Boat and watersports traffic near the Kittiwake: listen for engines, carry an SMB and surface at the line. Current not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring, along the slope no deeper than 30 m (100 ft), and back up toward the Kittiwake with reserve gas. The slope drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A deep slope that keeps falling. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "mountainous-star-coral",
        "boulder-star-coral",
        "common-sea-fan",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: USS Kittiwake
  // Depth: Indigo and Red Sail both give 64 ft in the sand and Indigo 47 ft of height, so the top is near 17 ft.
  {
    slug: "uss-kittiwake",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://redsailcayman.com/a-guide-to-shipwreck-dives-in-the-cayman-islands/",
      "https://www.indigodivers.com/dive-sites",
      "https://www.divetech.com/post/best-dive-sites-grand-cayman",
    ],
    briefing: {
      name: "USS Kittiwake",
      locationName: "Seven Mile Beach, Grand Cayman",
      forecastLatitude: 19.3619,
      forecastLongitude: -81.4012,
      description:
        "A 251 ft US Navy submarine rescue ship, sunk on purpose off Seven Mile Beach in 2011. She rests on sand at about 19 m and stands about 14 m tall, so her top is near 5 m. Stay outside the hull.",
      marineLife: "Garden eels · southern stingrays · green morays · turtles",
      marineLifeDescription:
        "Eels and rays work the sand around the hull, and turtles and morays use the structure.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 20,
      currentNote:
        "Seven Mile Beach boat and watersports traffic: listen for engines, carry an SMB and surface at the line. Current not documented; ask the crew on the day.",
      divePlan:
        "Stay at the wreck and on the sand beside it, no deeper than 20 m (65 ft). The sand slope beyond the bow falls away past the plan.",
      fitTone: "welcoming",
      fitNote: "A big wreck in shallow water with generous bottom time. Stay outside the hull.",
      landmarks: [
        {
          name: "Kittiwake",
          kind: "wreckFeature",
          note: "The 251 ft hull on sand, with her top near 5 m.",
        },
      ],
      creatureSlugs: ["garden-eel", "southern-stingray", "green-moray", "hawksbill-turtle"],
    },
  },
  // Denominator row: Trinity Caves
  // Gate: the wall beyond the swim-throughs drops past recreational depth; the plan floor is 30 m (Red Sail's maximum), so Advanced Open Water without the Deep specialty. Overhead: the swim-throughs are short and lit from above, so no cavern gate.
  {
    slug: "trinity-caves",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
      "https://www.divetech.com/post/northwest-point-diving",
      "https://www.divetech.com/post/best-scuba-diving-in-west-bay",
    ],
    briefing: {
      name: "Trinity Caves",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3648,
      forecastLongitude: -81.4072,
      description:
        "Three wide swim-throughs run through the reef to the wall near 24 m. They are overhead; stay out of them and go around. The dive finishes on top of the wall at about 15 m.",
      marineLife: "Sponges · lobsters · morays · sea fans",
      marineLifeDescription: "The wall edge is rich in small life, with sponge on the reef.",
      difficultyLevel: "intermediate",
      depthMinMeters: 14,
      maxDepthMeters: 30,
      divePlan:
        "Go around the swim-throughs to the wall near 24 m, work along it no deeper than 30 m (100 ft), then finish on top of the wall near 15 m.",
      fitTone: "demanding",
      fitNote: "Swim-throughs you skip, and a wall just beyond. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Pinnacle window",
          kind: "reefFormation",
          note: "A large pinnacle beside the wall with a window through one side near 24 m.",
        },
      ],
      creatureSlugs: ["spiny-lobster", "green-moray", "common-sea-fan", "giant-barrel-sponge"],
    },
  },
  // Denominator row: Round Rock
  // Gate: the wall drops past recreational depth; the plan floor is 30 m, so Advanced Open Water without the Deep specialty.
  {
    slug: "round-rock-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divetech.com/post/northwest-point-diving",
      "https://www.divetech.com/post/why-experienced-divers-choose-divetech-for-best-deep-wall-dives",
    ],
    briefing: {
      name: "Round Rock",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3648,
      forecastLongitude: -81.4079,
      description:
        "A section of the north-west wall whose top is as shallow as 11 m, with sponges and swim-throughs, and the drop-off just beyond. The swim-throughs are overhead; stay out of them.",
      marineLife: "Hawksbill turtles · jacks · triggerfish · sponges",
      marineLifeDescription:
        "This corner of the marine park holds more jacks, triggerfish and barracuda than most.",
      difficultyLevel: "intermediate",
      depthMinMeters: 11,
      maxDepthMeters: 30,
      divePlan:
        "Down the mooring to about 11 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A wall with a shallow top. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["hawksbill-turtle", "horse-eye-jack", "ocean-triggerfish", "common-sea-fan"],
    },
  },
  // Denominator row: Chain Reef
  // Depth: Divetech gives 20 to 40 ft in one post and 30 to 50 ft in another; DoE moors at 35 ft.
  {
    slug: "chain-reef-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divetech.com/post/northwest-point-diving",
      "https://www.divetech.com/post/best-scuba-diving-in-west-bay",
    ],
    briefing: {
      name: "Chain Reef",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3681,
      forecastLongitude: -81.4086,
      description:
        "A pleasant shallow reef of small bommies and heads ringed by white sand, mostly between 6 and 12 m, good for wide-angle photography.",
      marineLife: "Spotted drums · eagle rays · garden eels · schooling fish",
      marineLifeDescription: "Fish school over the heads, and eels and rays work the sand.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 15,
      fitTone: "welcoming",
      fitNote: "Shallow and easy, open to every level.",
      creatureSlugs: ["spotted-drum", "spotted-eagle-ray", "garden-eel", "queen-parrotfish"],
    },
  },
  // Denominator row: Big Tunnels
  // Gate: the wall drops past recreational depth. Red Sail puts the base of the arch at 106 ft (32 m); the arch base is past 30 m, so Advanced Open Water with the Deep specialty. Divetech rates it Advanced. Overhead: the passages are short but overhead; no cavern gate, and the prose says to stay out.
  {
    slug: "big-tunnels-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
      "https://redsailcayman.com/our-dive-instructors-favourite-dive-sites-in-grand-cayman/",
      "https://www.divetech.com/post/northwest-point-diving",
      "https://www.divetech.com/post/best-scuba-diving-in-west-bay",
    ],
    briefing: {
      name: "Big Tunnels",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3683,
      forecastLongitude: -81.4165,
      description:
        "A sheer wall about 90 m long, cut by channels and canyons, with a big coral arch on its edge. The passages run progressively deeper and are overhead; stay out of them. Hold your depth at the arch.",
      marineLife: "Black coral · jacks · sponges · sea fans",
      marineLifeDescription:
        "Black coral grows on the shaded walls of the channels, and jacks patrol the edge.",
      difficultyLevel: "advanced",
      depthMinMeters: 17,
      maxDepthMeters: 32,
      divePlan:
        "Down the mooring, along the wall no deeper than 32 m (105 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "A deep wall with an arch on its edge. Hold your floor.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The arch",
          kind: "reefFormation",
          note: "A giant coral archway on the edge of the wall.",
        },
      ],
      creatureSlugs: ["black-coral", "horse-eye-jack", "giant-barrel-sponge", "common-sea-fan"],
    },
  },
  // Denominator row: Orange Canyon
  // Gate: Red Sail gives a maximum depth of 40 m (average 18 m), so Advanced Open Water with the Deep specialty.
  {
    slug: "orange-canyon-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
      "https://redsailcayman.com/exploring-grand-caymans-hidden-dive-sites-a-divers-paradise/",
      "https://redsailcayman.com/our-dive-instructors-favourite-dive-sites-in-grand-cayman/",
      "https://www.divetech.com/post/northwest-point-diving",
    ],
    briefing: {
      name: "Orange Canyon",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3687,
      forecastLongitude: -81.418,
      description:
        "A canyon that cuts through the top of the north-west wall and leads out onto it near 30 m, between pinnacles decorated with big orange elephant ear sponges.",
      marineLife: "Elephant ear sponges · eagle rays · morays · turtles",
      marineLifeDescription: "The sponges are the show, with pelagic visitors off the wall.",
      difficultyLevel: "advanced",
      depthMinMeters: 19,
      maxDepthMeters: 40,
      currentNote: "Prone to current, so it cannot always be dived. Carry an SMB.",
      fitTone: "demanding",
      fitNote: "A deep canyon with current at times, to 40 m. For experienced deep divers.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "orange-elephant-ear-sponge",
        "spotted-eagle-ray",
        "green-moray",
        "hawksbill-turtle",
      ],
    },
  },
  // Denominator row: North West Point (Northwest Point Dropoff)
  // Gate: the wall drops past recreational depth; the plan floor is 30 m (Red Sail's maximum), so Advanced Open Water without the Deep specialty.
  {
    slug: "north-west-point",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://diveredsailcayman.com/dive-sites/",
      "https://www.divetech.com/post/northwest-point-diving",
    ],
    briefing: {
      name: "North West Point",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3694,
      forecastLongitude: -81.4207,
      description:
        "The north-west tip of the island, where the top of the wall lies near 20 m and falls away deeper to the north. It is dived less often than its neighbors and the coral is in very good shape.",
      marineLife: "Groupers · horse-eye jacks · oceanic triggerfish · barracuda",
      marineLifeDescription: "The marine park starts here, and fish stocks are visibly richer.",
      difficultyLevel: "advanced",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      currentNote:
        "Stronger currents are sometimes present. Carry an SMB and agree the pickup with the crew.",
      divePlan:
        "Down the mooring to about 20 m, along the wall no deeper than 30 m (100 ft), and back up the shallower reef with reserve gas. The wall drops far below this floor.",
      fitTone: "demanding",
      fitNote: "Deeper than most west-side dives, with current at times.",
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: ["black-grouper", "horse-eye-jack", "ocean-triggerfish", "great-barracuda"],
    },
  },
  // Denominator row: Bonnie's Arch
  {
    slug: "bonnies-arch",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divetech.com/post/northwest-point-diving",
    ],
    briefing: {
      name: "Bonnie's Arch",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3704,
      forecastLongitude: -81.4195,
      description:
        "A large arch, wide enough for several divers, rises to the top of a miniwall near 12 m. The wall steps down to about 21 m, thick with coral and fish. Freshwater outlets here can form haloclines after heavy rain.",
      marineLife: "Hawksbill turtles · sponges · reef fish",
      marineLifeDescription:
        "Fish crowd the reef and above it, and hawksbills graze the sponge beside it.",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 21,
      currentNote:
        "Heavy rain can form a halocline here, where fresh water meets salt and vision blurs. Current not documented; ask the crew on the day.",
      fitTone: "unknown",
      fitNote:
        "An arch at 12 m and a wall that steps down to 21 m. Expect blurred vision in a halocline after heavy rain.",
      landmarks: [
        {
          name: "The arch",
          kind: "reefFormation",
          note: "A big coral arch reaching the top of the miniwall near 12 m.",
        },
      ],
      creatureSlugs: [
        "hawksbill-turtle",
        "giant-barrel-sponge",
        "queen-parrotfish",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Lighthouse Point
  // Ungated: Divetech teaches first open water dives on the shallow reef here. The wall continues past 30 m beyond the plan.
  {
    slug: "lighthouse-point-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divetech.com/post/grand-cayman-shore-diving-sites-the-ultimate-guide-to-exploring-cayman-s-coastline-with-divetech",
      "https://www.divetech.com/post/best-dive-sites-grand-cayman",
      "https://divezone.net/diving/cayman-islands",
    ],
    briefing: {
      name: "Lighthouse Point",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3729,
      forecastLongitude: -81.4219,
      description:
        "A shore dive off a dock and ladder with a gradual slope from about 6 m, used for first open water dives. Deeper routes run down the wall, well past the plan.",
      marineLife: "Turtles · tarpon · eels · garden eels · angelfish",
      marineLifeDescription:
        "Turtles graze the reef and summer silverside schools make light tunnels.",
      difficultyLevel: "beginner",
      depthMinMeters: 6,
      maxDepthMeters: 18,
      divePlan:
        "Stay on the reef top and hold 18 m (60 ft). The drop-off beyond is a separate, deeper dive.",
      currentNote:
        "Shore entry from a dock and ladder: check the surge and plan to exit by the same ladder. Watch for boat and snorkeler traffic. Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "Easy entry and a calm slope. The wall beyond is a different dive.",
      landmarks: [
        {
          name: "Guardian of the Reef",
          kind: "underwaterMonument",
          note: "A bronze sculpture near the reef edge.",
        },
      ],
      creatureSlugs: [
        "hawksbill-turtle",
        "tarpon",
        "garden-eel",
        "french-angelfish",
        "banded-butterflyfish",
      ],
    },
  },
  // Denominator row: Turtle Reef (Macabuca)
  // Position: SSI's coordinates for the Macabuca entry; the site has no DoE mooring. Depth: Red Sail gives the miniwall as 18 m, SSI about 14 m; the deeper is taken.
  {
    slug: "turtle-reef-grand-cayman",
    version: 1,
    area: "cayman-grand-cayman",
    sources: [
      "https://doe.ky/wp-content/uploads/2023/01/GRAND-CAYMAN-PUBLIC-MOORINGS-2023.xlsx",
      "https://www.divessi.com/en/mydiveguide/divesite/turtle-reef-macabuca-grand-cayman-197857",
      "https://redsailcayman.com/exploring-grand-caymans-hidden-dive-sites-a-divers-paradise/",
    ],
    briefing: {
      name: "Turtle Reef (Macabuca)",
      locationName: "West Bay, Grand Cayman",
      forecastLatitude: 19.3829,
      forecastLongitude: -81.4169,
      description:
        "A shore dive by the bar's ladder. A sandy plateau gives way to a miniwall about 100 m offshore, marked by a buoy, that drops to around 18 m and then to the main wall farther west.",
      marineLife: "Stingrays · barracuda · loggerhead turtles · eagle rays",
      marineLifeDescription: "Rays and turtles are common, with the odd reef shark.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 18,
      currentNote:
        "Shore entry down a ladder: check the surge and plan to exit by the same ladder. Little or no current, but plenty of boat traffic; use a surface buoy.",
      fitTone: "welcoming",
      fitNote:
        "A shore dive with a calm miniwall. The main wall farther out is a separate, deeper dive.",
      creatureSlugs: [
        "southern-stingray",
        "great-barracuda",
        "loggerhead-turtle",
        "spotted-eagle-ray",
        "caribbean-reef-shark",
      ],
    },
  },
];
