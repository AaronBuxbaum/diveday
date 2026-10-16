// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Placencia and the southern barrier reef. */
export const BELIZE_SOUTH: DiveSiteTemplate[] = [
  // Denominator row: Gladden Spit (whale shark dive)
  {
    slug: "gladden-spit",
    version: 1,
    area: "belize-south",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/whale-sharks-at-gladden-spit/",
      "https://belizescuba.com/diving-snorkeling/whale-sharks/",
    ],
    briefing: {
      name: "Gladden Spit",
      locationName: "Gladden Spit and Silk Cayes Marine Reserve, Belize",
      // Approximate pin: no source lists coordinates. The point is inside OpenStreetMap's mapped
      // "Gladden Spit Spawning Aggregation" boundary (16.499–16.568 N, -88.004 to -87.954), near
      // its south-eastern corner where the reef ends in the spit. A shop confirms its own spot.
      forecastLatitude: 16.505,
      forecastLongitude: -87.962,
      description:
        "A point of the barrier reef where fish spawn in the spring, and the whale sharks arrive to feed on the eggs. The dive is in open water off the reef, in groups with a licensed guide.",
      marineLife: "Spawning snappers · bull sharks · dolphins · whale sharks",
      marineLifeDescription:
        "The spawning snappers are the event, with jacks, bull sharks and dolphins coming to feed on the eggs. A whale shark is unpredictable: one operator logged no sightings in several recent seasons, so treat one as a bonus.",
      conservationNote:
        "Time slots are allocated to licensed operators, guides are trained by the Southern Environmental Association, and groups are capped at 12 divers with their guides. Keep the distance the guide sets and never touch or chase an animal.",
      difficultyLevel: "advanced",
      depthRange: "Up to 24 m (80 ft)",
      maxDepthMeters: 24,
      currentNote:
        "Carry an SMB and surface with it deployed, because the boat picks divers up in open water. This is a blue-water drift outside the reef with no visual reference to the reef or bottom. Current is not documented; ask the crew on the day.",
      divePlan:
        "Staff confirm the diver’s log before boarding. Mid-water in the group, no deeper than 24 m (80 ft). Below the plan the wall keeps sloping and then drops into deep water. Watch your gauge, because nothing in view shows depth. Around any shark, whale sharks and bull sharks alike, stay put and keep the group together, keep nothing dangling, never chase or touch, and follow the guide’s briefing. Out of season it is a blue-water dive without the event, and no animal is promised.",
      fitTone: "demanding",
      fitNote:
        "Open-ocean diving with nothing to hold on to, so buoyancy has to be good. The season runs March to June, from about two days before the full moon to ten days after. Medical care is far; confirm the boat’s oxygen and plan.",
      // Blue-water dive with no visual reference: Advanced Open Water. The 24 m ceiling is the
      // operators' own cap, so no Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "cubera-snapper",
        "dog-snapper",
        "horse-eye-jack",
        "bull-shark",
        "bottlenose-dolphin",
        "whale-shark",
      ],
    },
  },
  // Denominator row: Coral Garden (Laughing Bird Caye)
  {
    slug: "coral-garden-laughing-bird-caye",
    version: 1,
    area: "belize-south",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/laughing-bird-caye/",
      "https://belizescuba.com/diving-snorkeling/local-reef/",
    ],
    briefing: {
      name: "Coral Garden, Laughing Bird Caye",
      locationName: "Laughing Bird Caye National Park, Belize",
      // Approximate pin: Laughing Bird Caye (OpenStreetMap 16.4437, -88.1964) plus half a mile southeast,
      // as Splash describes the site. Roughly 570 m south and 570 m east of the caye.
      forecastLatitude: 16.4386,
      forecastLongitude: -88.1911,
      description:
        "Coral mounds split by patches of sand, southeast of Laughing Bird Caye. It is known for the variety of its corals, and the fish and small animals around them. The mounds rise from deep water to within 10 to 12 m (30 to 40 ft) of the surface.",
      marineLife: "Spotted drums · spiny lobsters · cleaner shrimp · arrow crabs",
      marineLifeDescription:
        "Spotted drums, big lobsters, cleaner shrimp and arrow crabs live among the mounds, with plenty of smaller reef fish.",
      difficultyLevel: "intermediate",
      depthRange: "10–21 m (30–70 ft)",
      maxDepthMeters: 21,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Work the mound tops and the sand patches between them at 12 m (40 ft), or the sides of the mounds no deeper than 21 m (70 ft). The mounds drop away below that, and the bases are not part of the plan.",
      fitTone: "demanding",
      fitNote:
        "The mound tops sit at about 12 m (40 ft), and the plan reaches 21 m along the sides, so watch the gauge once you leave the tops.",
      // The plan reaches 21 m, past the Open Water limit, so the gate is Advanced Open Water. A shop
      // that dives only the 12 m range, as one operator page describes, can lower it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-drum",
        "spiny-lobster",
        "pederson-cleaner-shrimp",
        "arrow-crab",
        "mountainous-star-coral",
      ],
    },
  },
  // Denominator row: Laughing Bird South (Laughing Bird Caye South)
  {
    slug: "laughing-bird-south",
    version: 1,
    area: "belize-south",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/laughing-bird-caye/",
      "https://belizescuba.com/diving-snorkeling/local-reef/",
    ],
    briefing: {
      name: "Laughing Bird South",
      locationName: "Laughing Bird Caye National Park, Belize",
      // Approximate pin: Laughing Bird Caye (OpenStreetMap 16.4437, -88.1964) plus one and a half miles
      // south, as Splash describes the site (2.4 km).
      forecastLatitude: 16.422,
      forecastLongitude: -88.1964,
      description:
        "A long canyon running north to south on the reef south of Laughing Bird Caye. You can dive in the canyon or along its eastern side.",
      marineLife: "Spiny lobsters · southern stingrays · nurse sharks · healthy coral",
      marineLifeDescription:
        "Lobsters tuck into the canyon walls in groups, and stingrays and nurse sharks rest on the sand between them.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 15 m (50 ft)",
      maxDepthMeters: 15,
      currentNote:
        "The southern end of the canyon catches some current. Listen to the briefing about which way to go.",
      fitTone: "welcoming",
      fitNote:
        "A canyon dive to 15 m with a sandy floor. Ask which way the crew wants you to go before the southern end, where the water moves more.",
      creatureSlugs: ["spiny-lobster", "southern-stingray", "nurse-shark", "boulder-star-coral"],
    },
  },
  // Denominator row: North Wall (Silk Cayes)
  {
    slug: "north-wall-silk-cayes",
    version: 1,
    area: "belize-south",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/silk-cayes/",
      "https://belizescuba.com/diving-snorkeling/local-reef/",
    ],
    briefing: {
      name: "North Wall, Silk Cayes",
      locationName: "Silk Cayes, Gladden Spit and Silk Cayes Marine Reserve",
      // Approximate pin: the Silk Cayes (the mapped caye outlines span 16.499 to 16.521 N and -88.292
      // to -88.275 W in OpenStreetMap). The site's name puts it on the north side of the cayes, so the
      // pin is in the water about 350 m north of the northernmost outline. Good to about 2 km.
      // Not checked against the reserve map: the pin may sit on either side of the reef crest, so a
      // shop confirms the mooring.
      forecastLatitude: 16.5245,
      forecastLongitude: -88.28,
      description:
        "A wall off the north side of the Silk Cayes, among the busiest dives out of Placencia. Operators run it as a multi-level dive from the wall up onto the reef crest.",
      marineLife: "Black groupers · hawksbill turtles · spotted eagle rays · morays",
      marineLifeDescription:
        "Big black groupers, hawksbills, eagle rays and schools of jacks and schoolmasters work the wall. Reef sharks and mantas are occasional in the blue.",
      difficultyLevel: "advanced",
      depthRange: "12–24 m (40–80 ft)",
      maxDepthMeters: 24,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Start at the wall near 24 m (80 ft), no deeper than 24 m, then work up in stages to the reef crest at 12 m (40 ft), with the rest of your gas for the top. The wall falls away below the plan.",
      fitTone: "demanding",
      fitNote:
        "The wall starts deeper than an Open Water diver’s limit, so this one is for Advanced divers comfortable beside open blue water.",
      // The dive starts at 24 m at the foot of the wall, beyond the 18 m Open Water limit.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "black-grouper",
        "hawksbill-turtle",
        "spotted-eagle-ray",
        "green-moray",
        "horse-eye-jack",
      ],
    },
  },
  // Denominator row: Turtle Canyons
  {
    slug: "turtle-canyons-silk-cayes",
    version: 1,
    area: "belize-south",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/silk-cayes/",
      "https://belizescuba.com/diving-snorkeling/local-reef/",
    ],
    briefing: {
      name: "Turtle Canyons, Silk Cayes",
      locationName: "Silk Cayes, Gladden Spit and Silk Cayes Marine Reserve",
      // Approximate pin: both sources place it just north of North Wall, so the pin sits about 300 m
      // north of that site's pin (16.5245, -88.28). Good to about 2 km. Not checked against the
      // reserve map, so a shop confirms the mooring.
      forecastLatitude: 16.5272,
      forecastLongitude: -88.28,
      description:
        "Canyons just north of North Wall where hawksbill and loggerhead turtles rest. The dive stays in and around the canyons.",
      marineLife: "Hawksbill turtles · loggerhead turtles · spotted drums · cleaner shrimp",
      marineLifeDescription:
        "Turtles rest in the canyons, and juvenile spotted drums, cleaner shrimp and arrow crabs give macro photographers plenty to do.",
      difficultyLevel: "intermediate",
      depthRange: "15–18 m (50–60 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote:
        "Moderate depth with plenty to see up close. Often the second dive after North Wall.",
      creatureSlugs: [
        "hawksbill-turtle",
        "loggerhead-turtle",
        "spotted-drum",
        "pederson-cleaner-shrimp",
        "arrow-crab",
      ],
    },
  },
  // Denominator row: Rosella's Garden
  {
    slug: "rosellas-garden",
    version: 1,
    area: "belize-south",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/south-water-caye/",
      "https://belizescuba.com/diving-snorkeling/south-water-caye/",
    ],
    briefing: {
      name: "Rosella’s Garden",
      locationName: "South Water Caye Marine Reserve, Belize",
      // Approximate pin: South Water Caye (OpenStreetMap 16.8159, -88.082). Both sources put the site
      // about a minute by boat from the caye, direction not given, so the pin is in the water about
      // 350 m south of the caye's south end, 800 m from the Abyss pin. Good to about 2 km.
      forecastLatitude: 16.81,
      forecastLongitude: -88.082,
      description:
        "A short ride from South Water Caye, between two reef structures with sandy bottom between them. Named for a longtime resident of the caye.",
      marineLife: "Southern stingrays · nurse sharks · spotted eagle rays · turtles",
      marineLifeDescription:
        "Stingrays and nurse sharks rest on the sand between the structures, with eagle rays, turtles and schools of tarpon passing through.",
      difficultyLevel: "intermediate",
      depthRange: "14–18 m (45–60 ft)",
      maxDepthMeters: 18,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote:
        "Two reef structures and the sand between them at 14 to 18 m, where the stingrays and nurse sharks rest.",
      creatureSlugs: [
        "southern-stingray",
        "nurse-shark",
        "spotted-eagle-ray",
        "hawksbill-turtle",
        "tarpon",
      ],
    },
  },
  // Denominator row: Long Reef
  {
    slug: "long-reef-south-water-caye",
    version: 1,
    area: "belize-south",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/south-water-caye/",
      "https://www.thatchcayebelize.com/belize-barrier-reef",
    ],
    briefing: {
      name: "Long Reef, South Water Caye",
      locationName: "South Water Caye Marine Reserve, Belize",
      // Approximate pin: Splash lists the site with the South Water Caye reserve dives and Thatch
      // Caye Resort calls it a South Water Caye Marine Reserve wall. Neither gives coordinates,
      // so the pin is on the reef edge about 550 m east and 800 m north of South Water Caye
      // (OpenStreetMap 16.8159, -88.082), 800 m from the Abyss pin and 1.4 km from Rosella's Garden.
      // Treat it as good to a couple of kilometers.
      forecastLatitude: 16.823,
      forecastLongitude: -88.077,
      description:
        "A wall with small crevices along its face in the South Water Caye Marine Reserve. The wall starts at about 12 m (45 ft) and falls past 30 m (100 ft).",
      marineLife: "Spiny lobsters · spotted eels · eagle rays · hawksbill turtles",
      marineLifeDescription:
        "Lobsters and big crabs sit in the crevices, with eels, eagle rays and turtles along the face.",
      difficultyLevel: "advanced",
      depthRange: "12–30 m (45–100 ft)",
      maxDepthMeters: 30,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Start at the top of the wall near 12 m, spend the dive around 18 m (60 ft), where most dives run, and keep to 30 m (100 ft) at the very deepest. Come back up the wall with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "The wall reaches the limit of recreational depth, so it suits Advanced divers who watch their gauge.",
      // The wall falls to a little over 30 m; the plan holds 30 m, so the Advanced gate covers it.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spiny-lobster",
        "spotted-eagle-ray",
        "hawksbill-turtle",
        "spotted-moray",
        "green-moray",
      ],
    },
  },
  // Denominator row: The Abyss
  {
    slug: "the-abyss-south-water-caye",
    version: 1,
    area: "belize-south",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/south-water-caye/",
      "https://belizescuba.com/diving-snorkeling/south-water-caye/",
      "https://belizeadventure.ca/dive-sites-in-south-water-caye-marine-reserve/",
    ],
    briefing: {
      name: "The Abyss, South Water Caye",
      locationName: "South Water Caye Marine Reserve, Belize",
      // Approximate pin: the sources place it in the South Water Caye Marine Reserve, south of
      // Discovery and Curlew Wall, with no coordinates. The pin is on the reef edge about 550 m
      // east of South Water Caye (OpenStreetMap 16.8159, -88.082), 450 m from the Rosella's Garden
      // pin. Treat it as good to a couple of kilometers.
      forecastLatitude: 16.8159,
      forecastLongitude: -88.077,
      description:
        "A sheer wall that starts at about 12 m (40 ft) and drops into deep blue water. Overhangs, black coral and several gorgonians line the face, and visibility often passes 30 m (100 ft).",
      marineLife: "Spotted eagle rays · hawksbill turtles · nurse sharks · spiny lobsters",
      marineLifeDescription:
        "Lobsters hide in the overhangs, nurse sharks and turtles cruise past, and eagle rays patrol the face while blue wrasse school in open water.",
      difficultyLevel: "advanced",
      depthRange: "12–24 m (40–80 ft)",
      maxDepthMeters: 24,
      currentNote: "Current not documented; ask the crew on the day, and carry an SMB.",
      divePlan:
        "Start on the reef at about 12 m (40 ft), swim to the lip, and work along the wall no deeper than 24 m (80 ft). Some of the wall is deeper than it looks, so check your gauge. The overhangs are overheads; stay out. Finish on the shallow reef with reserve gas.",
      fitTone: "demanding",
      fitNote:
        "The wall falls away to open water and depth is easy to lose, so it suits Advanced divers.",
      // The wall drops sheer past recreational depth; 24 m is the plan's floor, not the bottom.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "spotted-eagle-ray",
        "hawksbill-turtle",
        "nurse-shark",
        "spiny-lobster",
        "black-coral",
      ],
    },
  },
  // Denominator row: White Hole
  {
    slug: "white-hole-silk-cayes",
    version: 1,
    area: "belize-south",
    sources: [
      "https://splashbelize.com/scuba-diving-sites/silk-cayes/",
      "https://belizescuba.com/diving-snorkeling/local-reef/",
    ],
    briefing: {
      name: "White Hole, Silk Cayes",
      locationName: "Silk Cayes, Gladden Spit and Silk Cayes Marine Reserve",
      // Approximate pin: both sources place it among the Silk Cayes (mapped in OpenStreetMap
      // between 16.499 and 16.521 N) without a direction. The earlier pin fell inside that span and
      // could have been on a caye, so this one is moved south of the span, in open water, about
      // 300 m below the southern edge and 3 km from the North Wall pin. The direction is an
      // assumption; treat it as good to a couple of kilometers. Not checked against the reserve
      // map, so a shop confirms the mooring.
      forecastLatitude: 16.4965,
      forecastLongitude: -88.28,
      description:
        "A white sand patch at about 10 m (30 ft) among coral heads, named for how it looks from the surface. The reef beyond it slopes to an outer wall at about 21 m (70 ft), which then drops steeply.",
      marineLife: "Southern stingrays · nurse sharks · green moray eels · yellowtail snappers",
      marineLifeDescription:
        "Stingrays, morays and nurse sharks rest in the sand and coral patches, with snappers and groupers over the reef and eagle rays sometimes in the blue.",
      difficultyLevel: "intermediate",
      depthRange: "10–21 m (30–70 ft)",
      maxDepthMeters: 21,
      currentNote: "Current not documented; ask the crew on the day.",
      divePlan:
        "Start on the sand at 10 m (30 ft) and explore the coral patches, where most of the life is near 18 m (60 ft). Stay inside 18 m. The outer wall at about 21 m drops steeply and is beyond the plan.",
      fitTone: "unknown",
      fitNote:
        "Most of the dive is on sand and coral patches in shallow water. The outer wall edge at 21 m is the limit of the site, and the plan stays inside 18 m.",
      // The sources put the outer wall at about 21 m, so the site is bounded at 21 m and gated at
      // Advanced Open Water, while the plan keeps to 18 m. A shop that dives only the sand and
      // patches can lower the gate.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "southern-stingray",
        "nurse-shark",
        "green-moray",
        "yellowtail-snapper",
        "spotted-eagle-ray",
      ],
    },
  },
];
