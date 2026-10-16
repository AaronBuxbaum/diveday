// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Sint Maarten. */
export const SINT_MAARTEN: DiveSiteTemplate[] = [
  {
    slug: "the-gregory-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://www.sxmdivers.com/sxm-dive-sites",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "The Gregory",
      locationName: "Long Bay, Sint Maarten",
      // Position: the French nature reserve's dive layer (Gregory).
      forecastLatitude: 18.0416,
      forecastLongitude: -63.141,
      description:
        "A barge sunk on purpose in 1993 that rolled over as it went down and now lies upside down. Soft coral and barrel sponges cover it and the reef around it, and the fish, turtles and lobsters shelter underneath.",
      marineLife: "Sergeant majors · trumpetfish · barracuda · spotted eagle rays",
      marineLifeDescription:
        "The wreck is crumbling and teems with small fish and their eggs. Eagle rays, Caribbean reef sharks and sea turtles pass, and lobsters come out at night. Night dives need staff approval and a briefed plan.",
      conservationNote:
        "On Dutch Sint Maarten each diver pays the Nature Foundation’s dive tag, which the dive shop collects. The fees pay for conservation, research and the moorings.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 17 m (55 ft)",
      maxDepthMeters: 17,
      currentNote:
        "The site lies offshore in open water and is run as a moored dive. The crew sometimes drifts from the wreck along Long Bay Reef, so carry an SMB and stop on the mooring line or an SMB.",
      divePlan:
        "Down the mooring to the wreck, once around it and the reef beside it, and back up the line. Stay outside the hull; the wreck is crumbling.",
      fitTone: "unknown",
      fitNote:
        "A shallow wreck with an upside-down hull to look at from outside, in open water. Ask the crew about the day’s water.",
      creatureSlugs: [
        "sergeant-major",
        "trumpetfish",
        "great-barracuda",
        "spotted-eagle-ray",
        "green-moray",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "fuh-sheng-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://web.archive.org/web/2024/http://www.thescubashop.net/OldWebsite/thesites.htm",
      "https://www.cityzeum.com/plongee-a-saint-martin",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "Fuh Sheng",
      locationName: "Long Bay, Sint Maarten",
      // Position: the French nature reserve's dive layer (Le Coréen).
      forecastLatitude: 18.0394,
      forecastLongitude: -63.1449,
      description:
        "An intact offshore fishing vessel in deep water west of Long Bay, the deep wreck dive on the island. French grunts school around her.",
      marineLife: "French grunts · jacks · sponge growth",
      marineLifeDescription: "Schools of grunts hang around the hull.",
      conservationNote:
        "On Dutch Sint Maarten each diver pays the Nature Foundation’s dive tag, which the dive shop collects. The fees pay for conservation, research and the moorings.",
      difficultyLevel: "advanced",
      depthRange: "Up to 38 m (120 ft)",
      maxDepthMeters: 38,
      currentNote:
        "The site lies offshore in open water. Current is not documented; carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring to the deck, along the outside of the hull, and back up the line with reserve gas. Stay outside the hull. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "A deep wreck in open water. For divers with the cards and the recent dives for it.",
      // The Nature Foundation and the French reserve list 34 m and The Scuba Shop's old site lists 38 m; the deeper figure is used, so Advanced Open Water and the Deep specialty apply.
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "french-grunt",
        "horse-eye-jack",
        "great-barracuda",
        "caribbean-reef-shark",
        "orange-cup-coral",
        "schoolmaster-snapper",
      ],
    },
  },
  {
    slug: "porpoise-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "Porpoise",
      locationName: "Simpson Bay, Sint Maarten",
      // Position: the French nature reserve's dive layer (Porpoise).
      forecastLatitude: 18.0289,
      forecastLongitude: -63.1279,
      description:
        "A tugboat of unknown history that sits upright on a sandy bottom, leaning a little to starboard. Sponges cover her, and soldierfish, hogfish and stingrays work the area.",
      marineLife: "Blackbar soldierfish · Spanish hogfish · bar jacks · southern stingrays",
      marineLifeDescription:
        "Soldierfish and hogfish gather around the wreck, with stingrays on the sand and the odd toadfish and reef shark.",
      conservationNote:
        "On Dutch Sint Maarten each diver pays the Nature Foundation’s dive tag, which the dive shop collects. The fees pay for conservation, research and the moorings.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 28 m (90 ft)",
      maxDepthMeters: 28,
      currentNote:
        "The site lies offshore in open water. Current is not documented; carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring to the tug, once around the outside, and back up the line. Stay outside the hull.",
      fitTone: "unknown",
      fitNote: "An upright tugboat in moderate depth. Ask the crew about the day’s water.",
      creatureSlugs: [
        "blackbar-soldierfish",
        "spanish-hogfish",
        "bar-jack",
        "southern-stingray",
        "ocean-surgeonfish",
        "caribbean-reef-shark",
      ],
    },
  },
  {
    slug: "tugboat-simpson-bay-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://web.archive.org/web/2024/http://www.thescubashop.net/OldWebsite/thesites.htm",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
      "https://naturefoundationsxm.org/marine-park/",
    ],
    briefing: {
      name: "Tugboat",
      locationName: "Simpson Bay Lagoon, Sint Maarten",
      // Position: the French nature reserve's dive layer (Le Remorqueur). The Nature Foundation's map shows the same Tug Boat mark in Simpson Bay. The point lies inside the Simpson Bay lagoon (north of the sandbar between the lagoon and the sea), so the briefing says lagoon.
      forecastLatitude: 18.0363,
      forecastLongitude: -63.1048,
      description:
        "An intact small boat in very shallow water in the Simpson Bay lagoon, now home to tropical fish and coral. It is an easy first dive.",
      marineLife: "Tropical reef fish · coral",
      marineLifeDescription: "Small reef fish and young coral cover the boat.",
      conservationNote:
        "On Dutch Sint Maarten each diver pays the Nature Foundation’s dive tag, which the dive shop collects. The fees pay for conservation, research and the moorings.",
      difficultyLevel: "beginner",
      depthRange: "Up to 6 m (20 ft)",
      maxDepthMeters: 6,
      currentNote:
        "Boats and yachts use the Simpson Bay lagoon and its bridge channel, so listen for engines, carry an SMB and come up the line. Current not documented; ask the crew on the day.",
      divePlan: "Down to the boat, around the outside, and back up. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "A very shallow wreck for a first or refresher dive.",
      creatureSlugs: [
        "bicolor-damselfish",
        "sergeant-major",
        "french-grunt",
        "bluestriped-grunt",
        "yellowtail-snapper",
      ],
    },
  },
  {
    slug: "the-bridge-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://www.sxmdivers.com/sxm-dive-sites",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "The Bridge",
      locationName: "Simpson Bay, Sint Maarten",
      // Position: the French nature reserve's dive layer (Le Pont).
      forecastLatitude: 18.021,
      forecastLongitude: -63.1127,
      description:
        "Several purpose-sunk installations on seagrass and sand near the Dutch entrance of the Simpson Bay lagoon: the remains of the old bridge, a small sailboat lying on its side and a floating bar re-sunk after Irma. Each draws different life, so the site takes several dives.",
      marineLife: "Southern stingrays · sand tilefish · tomtate · barracuda",
      marineLifeDescription:
        "Stingrays lie buried in the sand and sergeant majors guard their eggs. Reef sharks, nurse sharks and turtles pass, and an anemone in the sailboat’s bow holds shrimp.",
      conservationNote:
        "On Dutch Sint Maarten each diver pays the Nature Foundation’s dive tag, which the dive shop collects. The fees pay for conservation, research and the moorings.",
      difficultyLevel: "beginner",
      depthRange: "8–17 m (25–55 ft)",
      maxDepthMeters: 17,
      currentNote:
        "Boats pass in and out of the Simpson Bay lagoon entrance near the site, and cargo ships anchor near it; one anchor dragged the floating bar in 2024. Listen for engines, carry an SMB and come up the mooring line. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the small sailboat, then out across the sand to the bridge remains. Stay outside every hull.",
      fitTone: "welcoming",
      fitNote: "A shallow artificial reef with several things to find.",
      creatureSlugs: [
        "southern-stingray",
        "sand-tilefish",
        "tomtate",
        "great-barracuda",
        "nurse-shark",
        "sergeant-major",
      ],
    },
  },
  {
    slug: "isabella-reef-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://web.archive.org/web/2024/http://www.thescubashop.net/OldWebsite/thesites.htm",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "Isabella Reef",
      locationName: "Simpson Bay, Sint Maarten",
      // Position: the French nature reserve's dive layer (Isabelle). The Nature Foundation's map shows the same mark.
      forecastLatitude: 18.0182,
      forecastLongitude: -63.1181,
      description:
        "One of the deepest reefs around the island, with healthy coral and schools of fish. The Nature Foundation lists wreckage here as well as reef.",
      marineLife: "Reef fish schools · hard coral",
      marineLifeDescription:
        "Healthy coral and plenty of fish, in water deeper than most island reefs.",
      conservationNote:
        "On Dutch Sint Maarten each diver pays the Nature Foundation’s dive tag, which the dive shop collects. The fees pay for conservation, research and the moorings.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 30 m (100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "The site lies offshore in open water. Current is not documented; carry an SMB and ask the crew on the day.",
      divePlan:
        "Down the mooring to the reef, along it no deeper than 30 m, and back up the line with reserve gas. Stay outside the hull of any wreckage.",
      fitTone: "unknown",
      fitNote: "A deep reef in open water. Ask the crew about the day’s water.",
      // The Nature Foundation lists 28 m and The Scuba Shop's old site lists 30 m; the deeper figure is used. Depth up to 30 m does not gate by itself.
      creatureSlugs: [
        "blue-tang",
        "queen-angelfish",
        "french-angelfish",
        "bluehead-wrasse",
        "great-star-coral",
        "giant-barrel-sponge",
      ],
    },
  },
  {
    slug: "frenchmans-reef-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "Frenchman’s Reef",
      locationName: "Cole Bay, Sint Maarten",
      // Position: the French nature reserve's dive layer (French Reef).
      forecastLatitude: 18.0168,
      forecastLongitude: -63.0941,
      description:
        "A shallow reef on hard-packed sand with rocky features, a treasure hunt for nursery fish. Sunlight dapples the water, and baby animals hide in every crevice.",
      marineLife: "Ocean surgeonfish · French grunts · lionfish · baby nurse sharks",
      marineLifeDescription:
        "Surgeonfish, grunts and damselfish fill the shallows, with spotted morays and young nurse sharks in the crevices.",
      conservationNote:
        "On Dutch Sint Maarten each diver pays the Nature Foundation’s dive tag, which the dive shop collects. The fees pay for conservation, research and the moorings.",
      difficultyLevel: "beginner",
      depthRange: "6–9 m (20–30 ft)",
      maxDepthMeters: 9,
      currentNote: "Current not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A shallow reef that rewards a slow look in the crevices.",
      creatureSlugs: [
        "ocean-surgeonfish",
        "french-grunt",
        "lionfish",
        "nurse-shark",
        "spotted-moray",
        "bicolor-damselfish",
      ],
    },
  },
  {
    slug: "carib-cargo-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://www.sxmdivers.com/sxm-dive-sites",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
      "https://visitstmaarten.com/dive-discoveries",
    ],
    briefing: {
      name: "Carib Cargo",
      locationName: "Man of War Shoal Marine Park, Sint Maarten",
      // Position: the French nature reserve's dive layer (Le Roro).
      forecastLatitude: 17.9936,
      forecastLongitude: -63.0697,
      description:
        "An inter-island roll-on roll-off cargo ship lost in a hurricane in 1996 and found later, resting upright on sand among seagrass at the edge of the marine park. Reef balls east of the wreck are full of life.",
      marineLife: "Tomtate · bluestriped grunts · southern stingrays · green turtles",
      marineLifeDescription:
        "Snapper, grunts and soldierfish school over the wreck, with stingrays, reef sharks and queen triggerfish around, and a bottlenose dolphin in winter months.",
      conservationNote:
        "Man of War Shoal Marine Park is a no-fishing, no-anchoring zone. Each diver pays the Nature Foundation’s dive tag, which the dive shop collects, and the fees pay for conservation, research and the moorings.",
      difficultyLevel: "intermediate",
      depthRange: "Up to 21 m (70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "Parts of the park are kept open to shipping and Philipsburg’s harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the wreck, around the outside of the hull, and over to the reef balls on the east side. Stay outside the hull; the wreck is crumbling.",
      fitTone: "unknown",
      fitNote: "A wreck to 21 m in a busy water for boats. Ask the crew about the day’s water.",
      creatureSlugs: [
        "tomtate",
        "bluestriped-grunt",
        "southern-stingray",
        "green-sea-turtle",
        "queen-triggerfish",
        "caribbean-reef-shark",
      ],
    },
  },
  {
    slug: "lucys-barge-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://web.archive.org/web/2024/http://www.thescubashop.net/OldWebsite/thesites.htm",
    ],
    briefing: {
      name: "Lucy’s Barge",
      locationName: "Man of War Shoal Marine Park, Sint Maarten",
      // Approximate pin: measured off the Nature Foundation's marine park map, where the barge's mark sits about 140 m west-northwest of the Proselyte mark; read to about 100 m with the map's graticule. The two pins are about 140 m apart.
      forecastLatitude: 17.9896,
      forecastLongitude: -63.0596,
      description:
        "A cargo ferry that sank in 1991 and has been broken down by storms. The propeller is still visible, and the wreck’s bones attract eels, nurse sharks and masses of marine life.",
      marineLife: "Yellowtail snapper · green morays · spotted eagle rays · porcupinefish",
      marineLifeDescription:
        "Snappers, morays and porcupinefish live in the wreckage, with turtles, rays, reef sharks and octopus around.",
      conservationNote:
        "Man of War Shoal Marine Park is a no-fishing, no-anchoring zone. Each diver pays the Nature Foundation’s dive tag, which the dive shop collects, and the fees pay for conservation, research and the moorings.",
      difficultyLevel: "beginner",
      depthRange: "Up to 17 m (56 ft)",
      maxDepthMeters: 17,
      currentNote:
        "Parts of the park are kept open to shipping and Philipsburg’s harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the wreckage, along the outside of the broken hull to the propeller, and back up the line. Stay outside the hull.",
      fitTone: "welcoming",
      fitNote: "A shallow, broken wreck that is good for photographs.",
      landmarks: [
        {
          name: "The propeller",
          kind: "wreckFeature",
          note: "The propeller still shows above the broken remains of the ferry.",
        },
      ],
      creatureSlugs: [
        "yellowtail-snapper",
        "green-moray",
        "spotted-eagle-ray",
        "porcupinefish",
        "sharpnose-puffer",
        "caribbean-reef-shark",
      ],
    },
  },
  {
    slug: "hms-proselyte-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://www.sxmdivers.com/sxm-dive-sites",
      "https://visitstmaarten.com/dive-discoveries",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "HMS Proselyte",
      locationName: "Man of War Shoal Marine Park, Sint Maarten",
      // Position: the French nature reserve's dive layer (Proselyte).
      forecastLatitude: 17.9895,
      forecastLongitude: -63.0583,
      description:
        "The British frigate that struck Man of War Shoal in 1801. No wood is left, but coral-encrusted cannons, barrel hoops and massive anchors lie scattered over the shoal, which tops out near 5 m.",
      marineLife: "Barracuda · porcupinefish · ocean surgeonfish · nurse sharks",
      marineLifeDescription:
        "Many of the island’s reef fish live here, with a few resident reef sharks, spotted eagle rays, jawfish and sea slugs near the mooring.",
      conservationNote:
        "Man of War Shoal Marine Park is a no-fishing, no-anchoring zone. Each diver pays the Nature Foundation’s dive tag, which the dive shop collects, and the fees pay for conservation, research and the moorings. This is a historic wreck site: leave every cannon and artifact where it lies.",
      difficultyLevel: "beginner",
      depthRange: "5–17 m (15–56 ft)",
      maxDepthMeters: 17,
      currentNote:
        "Parts of the park are kept open to shipping and Philipsburg’s harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the cannons and anchors, a loop of the shoal, and back up the line. Make the safety stop on the mooring line or an SMB, not on the shoal.",
      fitTone: "welcoming",
      fitNote: "A historic site on a shallow shoal.",
      landmarks: [
        {
          name: "Cannons and anchors",
          kind: "reefHistory",
          note: "Coral-encrusted cannons, barrel hoops and several large anchors from the 1801 wreck.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "porcupinefish",
        "ocean-surgeonfish",
        "nurse-shark",
        "spotted-eagle-ray",
        "caribbean-reef-shark",
      ],
    },
  },
  {
    slug: "teigland-cable-reef-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://www.sxmdivers.com/sxm-dive-sites",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "Teigland and Cable Reef",
      locationName: "Man of War Shoal Marine Park, Sint Maarten",
      // Position: the French nature reserve's dive layer (Cable Reef).
      forecastLatitude: 17.9877,
      forecastLongitude: -63.0589,
      description:
        "A freighter sunk on a ledge in 1993 slid off in a storm and now lies as wreckage on the bottom. Reef structures nearby carry an old fiber-optic cable across the seafloor, with a swim-through to the east that is overhead; stay out.",
      marineLife: "French grunts · bluestriped grunts · yellow goatfish · green turtles",
      marineLifeDescription:
        "Grunts and goatfish school over the wreckage. Moray eels, green and hawksbill turtles, spotted eagle rays and reef sharks pass.",
      conservationNote:
        "Man of War Shoal Marine Park is a no-fishing, no-anchoring zone. Each diver pays the Nature Foundation’s dive tag, which the dive shop collects, and the fees pay for conservation, research and the moorings.",
      difficultyLevel: "intermediate",
      depthRange: "20–23 m (65–75 ft)",
      maxDepthMeters: 23,
      currentNote:
        "Parts of the park are kept open to shipping and Philipsburg’s harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. The swim-through east of the reef is overhead; stay out of it. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring to the wreckage, along the cable across the reef, and back up the line. Stay outside the hull.",
      fitTone: "unknown",
      fitNote: "A wreck and reef pairing at 20 to 23 m.",
      // The swim-through is overhead and not part of the plan, so the site carries no cavern gate.
      creatureSlugs: [
        "french-grunt",
        "bluestriped-grunt",
        "yellow-goatfish",
        "green-moray",
        "hawksbill-turtle",
        "spotted-eagle-ray",
      ],
    },
  },
  {
    slug: "mikes-maze-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://www.sxmdivers.com/sxm-dive-sites",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "Mike’s Maze",
      locationName: "Man of War Shoal Marine Park, Sint Maarten",
      // Approximate pin: the French reserve's "Le Cirque" point. On the Nature Foundation's map the Mike's Maze mark is the northernmost mark of the cluster, and Le Cirque is the northernmost reserve point, within about 100 m of it.
      forecastLatitude: 17.992,
      forecastLongitude: -63.0563,
      description:
        "One of the prettiest and shallowest sites in the marine park, small coral canyons with arches and bridges. The swim-throughs are overhead; stay out. The Nature Foundation used it for its coral restoration project.",
      marineLife: "French angelfish · gray angelfish · Bermuda chub · foureye butterflyfish",
      marineLifeDescription:
        "Angelfish, chubs and spiny lobsters fill the canyons. Elkhorn and staghorn coral grow here, and eagle rays and nurse sharks pass.",
      conservationNote:
        "Man of War Shoal Marine Park is a no-fishing, no-anchoring zone. Each diver pays the Nature Foundation’s dive tag, which the dive shop collects, and the fees pay for conservation, research and the moorings.",
      difficultyLevel: "beginner",
      depthRange: "Up to 18 m (60 ft)",
      maxDepthMeters: 18,
      currentNote:
        "Parts of the park are kept open to shipping and Philipsburg’s harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. The coral swim-throughs and arches are overhead; stay out of them. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring, then along the canyons from above, over the arches and bridges, and back to the mooring.",
      fitTone: "welcoming",
      fitNote: "Shallow coral canyons seen from above.",
      // The swim-throughs are short coral passages, overhead and not part of the plan, so the site carries no cavern gate.
      creatureSlugs: [
        "french-angelfish",
        "gray-angelfish",
        "bermuda-chub",
        "foureye-butterflyfish",
        "spiny-lobster",
        "staghorn-coral",
      ],
    },
  },
  {
    slug: "coralita-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://naturefoundationsxm.org/marine-park/",
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
    ],
    briefing: {
      name: "Coralita",
      locationName: "Man of War Shoal Marine Park, Sint Maarten",
      // Approximate pin: measured off the Nature Foundation's marine park map, where the Coralita mark sits between the Mike's Maze and Pelikaan Reef marks, about 250 m south-southeast of the Mike's Maze point; good to about 150 m.
      forecastLatitude: 17.9897,
      forecastLongitude: -63.0564,
      description:
        "Sand gullies with corals scattered along them, used in 2020 for the Nature Foundation’s coral restoration, where staghorn fragments that survived Hurricane Irma were planted out.",
      marineLife: "Fairy basslets · chubs · queen angelfish · spiny lobsters",
      marineLifeDescription:
        "Small reef fish and lobsters live among the coral patches, with staghorn and elkhorn coral growing back.",
      conservationNote:
        "Man of War Shoal Marine Park is a no-fishing, no-anchoring zone. Each diver pays the Nature Foundation’s dive tag, which the dive shop collects, and the fees pay for conservation, research and the moorings.",
      difficultyLevel: "beginner",
      depthRange: "Up to 16 m (51 ft)",
      maxDepthMeters: 16,
      currentNote:
        "Parts of the park are kept open to shipping and Philipsburg’s harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. Current is not documented; ask the crew on the day.",
      fitTone: "welcoming",
      fitNote: "A shallow reef of sand gullies and young coral.",
      creatureSlugs: [
        "royal-gramma",
        "bermuda-chub",
        "queen-angelfish",
        "french-angelfish",
        "spiny-lobster",
        "staghorn-coral",
      ],
    },
  },
  {
    slug: "fish-bowl-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://www.sxmdivers.com/sxm-dive-sites",
      "https://web.archive.org/web/2024/http://www.thescubashop.net/OldWebsite/thesites.htm",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
      "https://naturefoundationsxm.org/marine-park/",
    ],
    briefing: {
      name: "Fish Bowl",
      locationName: "Man of War Shoal Marine Park, Sint Maarten",
      // Approximate pin: the French reserve's "Arche" point. On the Nature Foundation's map the Fish Bowl mark is the easternmost mark of the cluster, level with the Cable Reef mark, and Arche is the matching reserve point, within about 100 m of it.
      forecastLatitude: 17.9877,
      forecastLongitude: -63.0516,
      description:
        "Named for its bowl shape and the fish inside it, with the mooring in the middle of the bowl. Two coral arches and a short swim-through lie on the rim; they are overhead, so stay out.",
      marineLife: "Great barracuda · filefish · boxfish · yellowhead jawfish",
      marineLifeDescription:
        "Barracuda and schools of surgeonfish hold over the bowl, with jawfish and fairy basslets below and spotted eagle rays and green morays around.",
      conservationNote:
        "Man of War Shoal Marine Park is a no-fishing, no-anchoring zone. Each diver pays the Nature Foundation’s dive tag, which the dive shop collects, and the fees pay for conservation, research and the moorings.",
      difficultyLevel: "beginner",
      depthRange: "12–19 m (40–62 ft)",
      maxDepthMeters: 19,
      currentNote:
        "Parts of the park are kept open to shipping and Philipsburg’s harbor is close, so listen for engines and carry an SMB. The boat flies the alpha flag. No diving while a ship is maneuvering or alongside. Ascend on the mooring line or an SMB. The arches and the swim-through are overhead; stay out of them. Current is not documented; ask the crew on the day.",
      divePlan:
        "Down the mooring in the middle of the bowl, once around the rim, and back to the mooring.",
      fitTone: "welcoming",
      fitNote:
        "A small bowl of a dive, easy to keep orientation in because the mooring sits at its center.",
      // The arches and swim-through are overhead and not part of the plan, so the site carries no cavern gate.
      creatureSlugs: [
        "great-barracuda",
        "orangespotted-filefish",
        "yellowhead-jawfish",
        "ocean-surgeonfish",
        "spotted-eagle-ray",
        "green-moray",
      ],
    },
  },
  {
    slug: "hen-and-chicks-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://web.archive.org/web/2024/http://www.thescubashop.net/OldWebsite/thesites.htm",
      "https://www.sxmdivers.com/sxm-dive-sites",
      "https://visitstmaarten.com/dive-discoveries",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "Hen and Chicks and Moonhole",
      locationName: "East coast, Sint Maarten",
      // Position: the French nature reserve's dive layer (Hens and Chicken).
      forecastLatitude: 18.0108,
      forecastLongitude: -63.0076,
      description:
        "Three rocks at the surface that look like a hen and two chicks, and below them a rocky ledge dropping to sand and a crater-like hole where waves break and surge. The hole and its caves are surge and overhead; stay out. A gully at the back leads to a shallow reef on the east side.",
      marineLife: "Angelfish · surgeonfish · tarpon · spotted morays",
      marineLifeDescription:
        "Healthy coral and schools of grunts and snappers line the ledge, with sea slugs, sweepers and peacock flounder.",
      conservationNote:
        "On Dutch Sint Maarten each diver pays the Nature Foundation’s dive tag, which the dive shop collects. The fees pay for conservation, research and the moorings.",
      difficultyLevel: "advanced",
      depthRange: "Up to 20 m (65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "East coast, open to Atlantic swell, and dived only when the weather allows. Waves crash over the rocks and surge in the hole, so carry an SMB and ask the crew about the day. The cave and corridors at the back are overhead; stay out.",
      divePlan:
        "Down the mooring to the ledge, along it in the open no deeper than 20 m, and back the same way. The hole and its caves and corridors are surge and overhead; stay out. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "An exposed east-coast site that only opens in calm weather.",
      // Gated at Advanced Open Water: the island's own guide says the east-coast sites are for more experienced divers, and swell exposure is the reason, not depth (20 m). The caves and corridors are overhead and not part of the plan.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "gray-angelfish",
        "ocean-surgeonfish",
        "tarpon",
        "spotted-moray",
        "peacock-flounder",
        "glassy-sweeper",
      ],
    },
  },
  {
    slug: "one-step-beyond-sint-maarten",
    version: 1,
    area: "sint-maarten",
    sources: [
      "https://thescubashopsxm.com/dive-sites-of-st-maarten/",
      "https://web.archive.org/web/2024/http://www.thescubashop.net/OldWebsite/thesites.htm",
      "https://visitstmaarten.com/dive-discoveries",
      "https://reservenaturelle-saint-martin.com/maps/plongee.kml",
    ],
    briefing: {
      name: "One Step Beyond",
      locationName: "East coast, Sint Maarten",
      // Position: the French nature reserve's dive layer (One Step Beyond).
      forecastLatitude: 17.9885,
      forecastLongitude: -62.9993,
      description:
        "An underwater pinnacle rising from a rocky bottom on a lush reef, with a small rocky swim-through that is overhead; stay out, and schools of fish. Dived only when the weather allows.",
      marineLife: "Black durgon · parrotfish · porkfish · French grunts",
      marineLifeDescription:
        "Schools of grunts and chubs, black durgon and parrotfish fill the water around the pinnacle, with stingrays and nurse sharks and sometimes dolphins.",
      conservationNote:
        "On Dutch Sint Maarten each diver pays the Nature Foundation’s dive tag, which the dive shop collects. The fees pay for conservation, research and the moorings.",
      difficultyLevel: "advanced",
      depthRange: "Up to 25 m (82 ft)",
      maxDepthMeters: 25,
      currentNote:
        "East coast, open to Atlantic swell, and dived only when the weather allows. Carry an SMB and ask the crew about the day. The small swim-through is overhead; stay out.",
      divePlan:
        "Down the mooring, around the pinnacle in the open, and back up the line with reserve gas. Staff confirm the diver’s log before boarding.",
      fitTone: "demanding",
      fitNote: "An exposed east-coast pinnacle that only opens in calm weather.",
      // Gated at Advanced Open Water: the island's own guide says the east-coast sites are for more experienced divers, and swell exposure is the reason, not depth. The French reserve lists 25 m and Scuba Shop 18 to 21 m; the deepest is used.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "black-durgon",
        "queen-parrotfish",
        "porkfish",
        "french-grunt",
        "southern-stingray",
        "nurse-shark",
      ],
    },
  },
];
