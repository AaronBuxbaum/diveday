// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Upper Keys: Key Largo. */
export const FLORIDA_KEYS_UPPER: DiveSiteTemplate[] = [
  {
    slug: "molasses-reef",
    version: 3,
    area: "florida-keys-upper",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/molasses.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Molasses%20Reef%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://rainbowreef.com/dive-locations-in-key-largo/molasses-reef/winch-hole",
      "https://en.wikipedia.org/wiki/Molasses_Reef",
    ],
    briefing: {
      name: "Molasses Reef",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.0117,
      forecastLongitude: -80.3764,
      description:
        "The most-dived reef in the Keys, and it earns it: spur-and-groove coral fingers running out into sand channels, in water that is usually bright enough to see the whole thing.",
      marineLife: "Parrotfish · angelfish · southern stingrays · nurse sharks",
      marineLifeDescription:
        "Look along the coral heads for schooling grunts and curious damselfish; rays often cruise the sandy channels between the spurs.",
      difficultyLevel: "beginner",
      depthRange: "5–18 m (15–60 ft)",
      maxDepthMeters: 18,
      currentNote: "Usually gentle, but reef-line current can run.",
      divePlan:
        "Follow a coral ridge out from the mooring, cross at a sand channel, and drift back along the next spur to the shallow garden under the boat.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, bright, and forgiving — a good first ocean dive after a pool course, and still worth a hundredth.",
      landmarks: [
        {
          name: "Molasses Reef Light",
          kind: "navigationMark",
          note: "The steel tower is the easiest above-water reference on the reef, and the way to stay oriented all dive.",
        },
        {
          name: "Winch Hole",
          kind: "reefHistory",
          note: "A ship's winch in a sand patch at about 7.5 m, worn smooth and grown over.",
        },
        {
          name: "Spanish anchor",
          kind: "reefHistory",
          note: "An old anchor among the coral. Let the crew point it out — it disappears into the reef remarkably well.",
        },
      ],
      creatureSlugs: [
        "stoplight-parrotfish",
        "french-angelfish",
        "blue-tang",
        "southern-stingray",
        "yellowtail-snapper",
      ],
    },
  },
  {
    slug: "french-reef",
    version: 2,
    area: "florida-keys-upper",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27French%20Reef%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://rainbowreef.com/dive-locations-in-key-largo/french-reef/christmas-tree-cave",
      "https://www.duikersgids.nl/en/french-reef",
    ],
    briefing: {
      name: "French Reef",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.0353,
      forecastLongitude: -80.3494,
      description:
        "The swim-through reef. Ledges, overhangs and short tunnels cut through a shallow spur-and-groove system, so the dive happens as much under the coral as over it.",
      marineLife: "Nurse sharks · green morays · parrotfish · barracuda",
      marineLifeDescription:
        "The overhangs hide sleeping nurse sharks and squirrelfish. Check the ceilings, not just the sand.",
      difficultyLevel: "beginner",
      depthRange: "5–14 m (15–45 ft)",
      maxDepthMeters: 14,
      currentNote: "Usually mild; a swim-through is no place to be surprised by surge.",
      divePlan:
        "Drop on the mooring, work the ledges into the current, then drift back over the coral heads with gas in reserve for the swim-throughs. Only go through a tunnel you can see the far end of.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and easy-going, but the overhangs reward decent buoyancy — worth a few dives of practice first.",
      fieldGuideTipsHeading: "Look up, not just down",
      landmarks: [
        {
          name: "Christmas Tree Cave",
          kind: "reefFormation",
          note: "A short swim-through with two exits; the coral over the entrance is where it gets its name.",
        },
        {
          name: "Hourglass Cave",
          kind: "reefFormation",
          note: "Narrow in the middle and open at both ends — a good look at what lives on a ceiling.",
        },
        {
          name: "White Sand Bottom Cave",
          kind: "reefFormation",
          note: "The brightest of the tunnels, and usually the one with a nurse shark parked in it.",
        },
      ],
      creatureSlugs: [
        "nurse-shark",
        "green-moray",
        "stoplight-parrotfish",
        "great-barracuda",
        "squirrelfish",
        "blackbar-soldierfish",
      ],
    },
  },
  {
    slug: "christ-of-the-abyss",
    version: 2,
    area: "florida-keys-upper",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/kldryrocks.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Key%20Largo%20Dry%20Rocks%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://en.wikipedia.org/wiki/Christ_of_the_Abyss",
      "https://www.seadwellers.com/christ-of-the-abyss-key-largo",
    ],
    briefing: {
      name: "Christ of the Abyss",
      locationName: "Key Largo Dry Rocks, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.1245,
      forecastLongitude: -80.2972,
      description:
        "A 2.6 m bronze statue standing on the sand in about 8 m of water, arms up toward the surface, with a shallow coral garden all around it. The most photographed dive in Florida.",
      marineLife: "Sergeant majors · blue tangs · French angelfish · brain coral",
      marineLifeDescription:
        "Sergeant majors guard purple egg patches on the statue's base all summer, and the coral heads around it are as good as anything deeper.",
      difficultyLevel: "beginner",
      depthRange: "5–8 m (15–25 ft)",
      maxDepthMeters: 8,
      currentNote:
        "Usually gentle; it is shallow enough that surface chop is felt on the bottom. Ascend on the mooring line, never in open water: there are always boats and snorkelers overhead.",
      divePlan:
        "Arc from the mooring through the sand channels, spend the time you want at the statue, then return across the coral garden — most of the dive is above 6 m, so it is a long one.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, sheltered and busy. Snorkelers share the site, so this is a good day to stay low and let the surface belong to them.",
      landmarks: [
        {
          name: "Christ of the Abyss",
          kind: "underwaterMonument",
          note: "A third casting of the 1954 Italian original, placed here in 1965. It is the reason most people are on the boat.",
        },
        {
          name: "Dry Rocks sand channels",
          kind: "reefFormation",
          note: "Bright channels weaving between the coral, and a good place to look for rays and grouper.",
        },
      ],
      creatureSlugs: [
        "sergeant-major",
        "blue-tang",
        "french-angelfish",
        "grooved-brain-coral",
        "yellow-stingray",
      ],
    },
  },
  {
    slug: "benwood-wreck",
    version: 2,
    area: "florida-keys-upper",
    sources: [
      "https://floridakeys.noaa.gov/shipwrecktrail/benwood.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/ShipwreckTrail_FKNMS/FeatureServer/4/query?where=1%3D1&outFields=*&f=json",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27The%20Benwood%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://en.wikipedia.org/wiki/SS_Benwood",
      "https://www.opalcollection.com/blog/best-dive-sites-key-largo/",
    ],
    briefing: {
      name: "Benwood Wreck",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.0527,
      forecastLongitude: -80.3337,
      description:
        "A freighter lost off Key Largo in 1942. She was running without lights in wartime and collided with another ship. Now she lies broken open in shallow sand: wreck scale without wreck depth, and one of the best night dives in the Keys.",
      marineLife: "Glassy sweepers · sergeant majors · moray eels · yellowtail snapper",
      marineLifeDescription:
        "The hull is a fish apartment block. Look into every gap in the plates and something is home.",
      difficultyLevel: "intermediate",
      depthRange: "8–15 m (25–50 ft)",
      maxDepthMeters: 15,
      currentNote: "Mild, but it sits in open water off the reef line.",
      divePlan:
        "Swim the length of the hull from bow to stern along the sand, then come back over the plates at about 9 m (30 ft) for the safety stop.",
      fitTone: "welcoming",
      fitNote:
        "Shallow enough for a long dive, and structured enough to be a real first wreck. Stay outside the plates.",
      landmarks: [
        {
          name: "Bow section",
          kind: "wreckFeature",
          note: "The most intact piece, standing proud of the sand and the easiest place to get your bearings.",
        },
        {
          name: "Collapsed midships plates",
          kind: "wreckFeature",
          note: "Where the hull opened up. Swim over it rather than into it — the gaps are fish holes, not doorways.",
        },
      ],
      creatureSlugs: [
        "glassy-sweeper",
        "sergeant-major",
        "spotted-moray",
        "yellowtail-snapper",
        "great-barracuda",
        "caribbean-reef-octopus",
      ],
    },
  },
  {
    slug: "spiegel-grove",
    version: 2,
    area: "florida-keys-upper",
    sources: [
      "https://visitfloridakeys.com/experiences/what-were-famous-for/diving-snorkeling/shipwrecks/spiegel-grove",
      "https://www.rainbowreef.com/dive-locations-in-key-largo/spiegel-grove-wreck",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27The%20Spiegel%20Grove%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Spiegel%20Grove%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Spiegel Grove",
      locationName: "Key Largo, Florida",
      forecastLatitude: 25.0666,
      forecastLongitude: -80.3108,
      description:
        "A 155 m Navy landing ship dock sunk as an artificial reef in 2002 and rolled upright by Hurricane Dennis in 2005. Big enough that a single dive is a tour of one end of it.",
      marineLife: "Goliath grouper · barracuda · jacks · soft coral",
      marineLifeDescription:
        "Expect big silhouettes, moving schools, and changing light along the exterior decks. The superstructure is thick with coral and sponge now.",
      difficultyLevel: "advanced",
      depthRange: "18–40 m (60–130 ft)",
      maxDepthMeters: 40,
      currentNote: "Open-water current can run hard, and it is a long ship.",
      divePlan:
        "Descend together on the mooring line, tour the exterior — flight deck, cranes, well deck — and return to the ascent line with reserve gas and a planned stop.",
      fitTone: "demanding",
      fitNote:
        "Deep, exposed and current-prone. Nitrox and recent deep experience turn this from a short look into a proper dive.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Flight deck and cranes",
          kind: "wreckFeature",
          note: "The broad deck and paired cranes make the ship's scale click into place. Stay outside the structure and follow the guide's line.",
        },
        {
          name: "Well deck",
          kind: "wreckFeature",
          note: "The open stern space is the most dramatic exterior room on the wreck, with changing light and big schools working through it.",
        },
        {
          name: "The mast",
          kind: "wreckFeature",
          note: "The shallowest steel on the wreck at about 18 m — a useful reference on the way up.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "horse-eye-jack",
        "permit-fish",
        "yellowtail-snapper",
        "remora",
      ],
    },
  },
  {
    slug: "uscgc-duane",
    version: 2,
    area: "florida-keys-upper",
    sources: [
      "https://floridakeys.noaa.gov/shipwrecktrail/duane.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/ShipwreckTrail_FKNMS/FeatureServer/4/query?where=1%3D1&outFields=*&f=json",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Duane%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://underwaterscience.indiana.edu/research/florida-keys/uscg-duane-archaeological-investigations.html",
    ],
    briefing: {
      name: "USCGC Duane",
      locationName: "Key Largo, Florida",
      forecastLatitude: 24.9898,
      forecastLongitude: -80.3815,
      description:
        "A 100 m Coast Guard cutter sunk in 1987 and sitting perfectly upright. Her guns and forward mast came off before she went down, but the aft mast and crow's nest still stand. The tidiest wreck in the Upper Keys, and the one everyone remembers the shape of.",
      marineLife: "Goliath grouper · barracuda · amberjack · schooling grunts",
      marineLifeDescription:
        "A resident goliath grouper often holds near the wheelhouse. Look out into the blue for jacks working the current off the bow.",
      difficultyLevel: "advanced",
      depthRange: "18–37 m (60–120 ft)",
      maxDepthMeters: 37,
      currentNote: "Can run strong on the surface and at depth.",
      divePlan:
        "Descend the mooring to the deck, tour the superstructure and the wheelhouse, then ascend on reserve gas with a stop on the line. The crow's nest at about 18 m is a good place to spend it.",
      fitTone: "demanding",
      fitNote:
        "Deep and current-swept, but upright and intact enough to be an excellent first big wreck once the depth is within your card.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Wheelhouse",
          kind: "wreckFeature",
          note: "Open, recognizable, and usually holding the resident grouper. Approach along the deck, not from above.",
        },
        {
          name: "The bow",
          kind: "wreckFeature",
          note: "The cutwater is intact at about 30 m. The bow gun was taken off before she sank, and its open hatch drops into a compartment. Look in, but stay out.",
        },
        {
          name: "Crow's nest",
          kind: "wreckFeature",
          note: "The shallowest point at about 18 m — where the safety stop happens on a good day.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "horse-eye-jack",
        "bluestriped-grunt",
        "spotted-moray",
        "great-star-coral",
      ],
    },
  },
  {
    slug: "grecian-rocks",
    version: 2,
    area: "florida-keys-upper",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/kldryrocks.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Grecian%20Rocks%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.opalcollection.com/blog/best-dive-sites-key-largo/",
      "https://www.nbcnews.com/science/climate-change/florida-coral-species-declared-functionally-extinct-rcna238753",
    ],
    briefing: {
      name: "Grecian Rocks",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.1114,
      forecastLongitude: -80.3053,
      description:
        "A crescent of shallow reef that shelters its own back side — a coral garden in barely 3 m on one edge, sloping to sand at about 10 m on the other.",
      marineLife: "Sergeant majors · barracuda · queen conch · butterflyfish",
      marineLifeDescription:
        "The crest is so shallow it breaks the surface at low tide. Small reef fish crowd the coral heads, and conch work the sand behind.",
      difficultyLevel: "beginner",
      depthRange: "3–10 m (10–35 ft)",
      maxDepthMeters: 10,
      currentNote:
        "The back side is sheltered even when the reef line is not — a good bad-weather call.",
      divePlan:
        "Work the deeper sand edge first, then come up onto the crest and finish shallow among the coral heads with plenty of gas left.",
      fitTone: "welcoming",
      fitNote: "Shallow, sheltered and slow. The site where a nervous diver stops being nervous.",
      landmarks: [
        {
          name: "The reef crest",
          kind: "reefFormation",
          note: "The shallowest point, in barely knee-deep water at low tide. Keep your fins high and well clear.",
        },
        {
          name: "Sand-edge coral heads",
          kind: "reefFormation",
          note: "Isolated heads out on the sand, each one holding its own small population.",
        },
      ],
      creatureSlugs: [
        "sergeant-major",
        "queen-conch",
        "great-barracuda",
        "foureye-butterflyfish",
        "smooth-trunkfish",
      ],
    },
  },
  {
    slug: "carysfort-reef",
    version: 2,
    area: "florida-keys-upper",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/carysfort.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Carysfort%20Reef%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://keyshistory.org/reef-lighthousespage1.html",
      "https://www.nbcnews.com/science/climate-change/florida-coral-species-declared-functionally-extinct-rcna238753",
    ],
    briefing: {
      name: "Carysfort Reef",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.2219,
      forecastLongitude: -80.2115,
      description:
        "The northernmost of the big Keys reefs, marked by an 1852 iron-pile lighthouse. Well offshore, and less dived than Molasses.",
      marineLife: "Star coral · parrotfish · nurse sharks · grunts",
      marineLifeDescription:
        "Carysfort is one of NOAA's Mission: Iconic Reefs restoration sites. The 2023 heat wave killed much of the planted coral, so what you see here changes year to year.",
      difficultyLevel: "intermediate",
      depthRange: "8–21 m (25–70 ft)",
      maxDepthMeters: 21,
      currentNote:
        "Exposed and further offshore than the rest of the Key Largo line — current and surface conditions decide the day.",
      divePlan:
        "Drop on the outer reef, work along the spurs into whatever current is running, and finish shallow on the restoration plots.",
      fitTone: "demanding",
      fitNote:
        "Not hard water, but a long ride and an exposed site — best on a settled day and with a diver who is comfortable in a bit of current.",
      landmarks: [
        {
          name: "Carysfort Reef Light",
          kind: "navigationMark",
          note: "The rust-red iron tower standing straight out of the reef — visible for miles and impossible to lose.",
        },
        {
          name: "Coral restoration plots",
          kind: "reefFormation",
          note: "Nursery-grown coral planted out on the reef. Look, photograph, and keep every part of you off it.",
        },
      ],
      creatureSlugs: [
        "great-star-coral",
        "queen-parrotfish",
        "nurse-shark",
        "french-grunt",
        "banded-butterflyfish",
      ],
    },
  },
  {
    slug: "pickles-reef",
    version: 2,
    area: "florida-keys-upper",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Pickles%20Reef%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://en.wikipedia.org/wiki/Pickles_Reef",
      "https://rainbowreef.com/dive-locations-in-key-largo/pickles-reef/pickle-barrel-wreck",
    ],
    briefing: {
      name: "Pickles Reef",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.9883,
      forecastLongitude: -80.4127,
      description:
        "A shallow spur-and-groove reef named for the barrel-shaped cement casks lying among the coral heads. They came off an unidentified wreck, and the cement dates from around 1890 to 1923.",
      marineLife: "Blue tangs · stoplight parrotfish · French angelfish · sergeant majors",
      marineLifeDescription:
        "Grazing parrotfish work the coral heads all day; blue tangs move through in loose, easy groups.",
      difficultyLevel: "beginner",
      depthRange: "4–9 m (12–30 ft)",
      maxDepthMeters: 9,
      currentNote: "Usually gentle.",
      divePlan:
        "Drift the coral ridge from the mooring, pause over the barrel casks, then loop back over the sand.",
      fitTone: "welcoming",
      fitNote: "Quiet, shallow and rarely crowded — a good second tank after something deeper.",
      landmarks: [
        {
          name: "The cement barrels",
          kind: "reefHistory",
          note: "Casks of cement that hardened in their barrels and outlasted the ship carrying them.",
        },
        {
          name: "Anchor chain remnant",
          kind: "reefHistory",
          note: "A length of chain grown into the reef, running off toward the sand.",
        },
      ],
      creatureSlugs: [
        "blue-tang",
        "stoplight-parrotfish",
        "french-angelfish",
        "sergeant-major",
        "spanish-hogfish",
        "christmas-tree-worm",
      ],
    },
  },
  // Denominator row: North Dry Rocks (Key Largo Northern Dry Rocks, Minnow Cave; incl. North North Dry Rocks)
  {
    slug: "north-dry-rocks",
    version: 1,
    area: "florida-keys-upper",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27N%20Dry%20Rocks%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.rainbowreef.com/dive-locations-in-key-largo/key-largo-northern-dry-rocks",
      "https://www.pcwatersports.com/key-largo-dive-sites",
    ],
    briefing: {
      name: "North Dry Rocks",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.1299,
      forecastLongitude: -80.2937,
      description:
        "A small, shallow reef just north of Key Largo Dry Rocks, with everything its famous neighbour has except the statue and the crowd. Its best-known corner is Minnow Cave, a coral undercut that fills with glassy baitfish.",
      marineLife: "Glass minnows · great barracuda · grouper · spiny lobster",
      marineLifeDescription:
        "Baitfish hang in the mouth of the undercut, and the barracuda that hunt them are rarely far away.",
      difficultyLevel: "beginner",
      depthRange: "3–12 m (10–40 ft)",
      maxDepthMeters: 12,
      currentNote:
        "Shallow and usually easy on the reef top. The northern moorings (North North Dry Rocks) sit deeper, near 8 m, so check which one the boat is on.",
      divePlan:
        "Swim the reef edge from the mooring to Minnow Cave, look in from outside, and finish over the shallow coral heads.",
      fitTone: "welcoming",
      fitNote: "Bright, shallow and quieter than the Dry Rocks next door.",
      landmarks: [
        {
          name: "Minnow Cave",
          kind: "reefFormation",
          note: "A coral undercut named for the baitfish that crowd it. A place to look into, not to swim into.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "black-grouper",
        "spiny-lobster",
        "bluestriped-grunt",
        "boulder-star-coral",
      ],
    },
  },
  // Denominator row: The Elbow (Elbow Reef)
  {
    slug: "the-elbow",
    version: 1,
    area: "florida-keys-upper",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/elbow.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27The%20Elbow%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.rainbowreef.com/dive-locations-in-key-largo/elbow-reef",
      "https://www.pcwatersports.com/key-largo-dive-sites",
    ],
    briefing: {
      name: "The Elbow",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.1433,
      forecastLongitude: -80.2571,
      description:
        "A spur-and-groove reef that crooks out toward the Gulf Stream like a bent arm, marked by a light tower. It has been catching ships for well over a century, so wreckage lies among the coral, and the clear blue water comes with the location.",
      marineLife: "Bluestriped grunts · porkfish · angelfish · sea turtles",
      marineLifeDescription:
        "Grunts and snapper school in the grooves, and turtles are regulars along the deeper fingers.",
      difficultyLevel: "intermediate",
      depthRange: "3–17 m (10–55 ft)",
      maxDepthMeters: 17,
      currentNote:
        "Closer to the Gulf Stream than most Key Largo reefs: clearer water, and more current in exchange, so it is often run as a drift. A Sanctuary Preservation Area, so no fishing or collecting, and boats use the mooring buoys.",
      divePlan:
        "Follow a spur from the mooring toward the deeper edge, turn with the current, and come back up a neighbouring groove. Wreck pieces turn up on most of the moorings near the tower.",
      fitTone: "demanding",
      fitNote: "Easy depths, but the current deserves respect. Comfortable in a drift is the bar.",
      landmarks: [
        {
          name: "Elbow light tower",
          kind: "navigationMark",
          note: "The light tower over the reef. The City of Washington lies just off it.",
        },
        {
          name: "The Civil War wreck",
          kind: "reefHistory",
          note: "Wooden beams and iron fastenings just north of the tower, a favourite with photographers.",
        },
        {
          name: "Mike’s Wreck",
          kind: "reefHistory",
          note: "Scattered remains in about 6–8 m, one of several wrecks the reef claimed.",
        },
      ],
      creatureSlugs: [
        "bluestriped-grunt",
        "porkfish",
        "french-angelfish",
        "hawksbill-turtle",
        "yellowtail-snapper",
        "giant-barrel-sponge",
      ],
    },
  },
  // Denominator row: City of Washington
  {
    slug: "city-of-washington",
    version: 1,
    area: "florida-keys-upper",
    sources: [
      "https://floridakeys.noaa.gov/shipwrecktrail/cityofwashington.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27The%20Elbow%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.pcwatersports.com/key-largo-dive-sites",
      "https://www.rainbowreef.com/dive-locations-in-key-largo/elbow-reef",
    ],
    briefing: {
      name: "City of Washington",
      locationName: "The Elbow, Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.1464,
      forecastLongitude: -80.2559,
      description:
        "An 1877 iron steamship that stood by the USS Maine when she blew up in Havana in 1898, carried troops in the war that followed, and ended her days as a coal barge. A tug ran her onto the Elbow in 1917, and her flattened hull now lies across the reef in shallow water.",
      marineLife: "Black grouper · great barracuda · moray eels · nurse sharks",
      marineLifeDescription:
        "Coral has grown through the broken iron, and the fish use it like any other ledge.",
      difficultyLevel: "beginner",
      depthRange: "4–8 m (12–25 ft)",
      maxDepthMeters: 8,
      currentNote:
        "Shallow, but on the Elbow, so current can run across the wreck. Inside The Elbow Sanctuary Preservation Area: nothing is taken, and every piece of the wreck is protected.",
      divePlan:
        "Trace the hull from the mooring, bow to stern, and look for the propeller shaft tunnel at the stern end. A good second dive and a good night dive.",
      fitTone: "welcoming",
      fitNote: "History you can read from the surface, at a depth anyone can manage.",
      landmarks: [
        {
          name: "Propeller shaft tunnel",
          kind: "wreckFeature",
          note: "The most recognisable piece of her, at the less broken stern end.",
        },
        {
          name: "The collapsed hull",
          kind: "wreckFeature",
          note: "Her iron sides have fallen outward, so the wreck spreads wider than the ship ever was.",
        },
      ],
      creatureSlugs: [
        "black-grouper",
        "great-barracuda",
        "green-moray",
        "nurse-shark",
        "french-grunt",
      ],
    },
  },
  // Denominator row: Bibb (USCGC Bibb)
  {
    slug: "uscgc-bibb",
    version: 1,
    area: "florida-keys-upper",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Bibb%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27The%20Bibb%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.rainbowreef.com/dive-locations-in-key-largo/uscg-bibb-wreck",
      "https://www.pcwatersports.com/key-largo-dive-sites",
    ],
    briefing: {
      name: "USCGC Bibb",
      locationName: "Key Largo, Florida",
      forecastLatitude: 24.9952,
      forecastLongitude: -80.3795,
      description:
        "The Duane’s sister, a 100 m Coast Guard cutter that served from 1937 through World War II and Vietnam. Sunk beside her in 1987, she landed on her starboard side, which keeps her deep and keeps the crowds away.",
      marineLife: "Goliath grouper · great barracuda · jacks · passing sharks",
      marineLifeDescription:
        "Close enough to the Gulf Stream for big visibility and big animals passing through.",
      difficultyLevel: "advanced",
      depthRange: "29–40 m (95–130 ft)",
      maxDepthMeters: 40,
      currentNote:
        "Current here can be strong enough to call the dive off. The port rail is the shallowest point, near 29 m, and the sand lies at about 40 m. Stay outside the hull: cables and debris make penetration a different dive and a different card.",
      divePlan:
        "Down the line to the port rail, a short swim along the side she lies on, and back to the line with gas to spare. Plan nitrox and a short bottom time.",
      fitTone: "demanding",
      fitNote:
        "Deep from the first metre of steel, often current-swept. For divers already at home on the Duane.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The port rail",
          kind: "wreckFeature",
          note: "The highest part of the wreck, about 29 m down, and where most dives are spent.",
        },
        {
          name: "Crow’s nest",
          kind: "wreckFeature",
          note: "Because she lies on her side, the mast reaches out sideways over the sand.",
        },
      ],
      creatureSlugs: ["goliath-grouper", "great-barracuda", "horse-eye-jack", "bar-jack"],
    },
  },
  // Denominator row: Snapper Ledge
  {
    slug: "snapper-ledge",
    version: 1,
    area: "florida-keys-upper",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Snapper%20Ledge%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.rainbowreef.com/dive-locations-in-key-largo/snapper-ledge",
      "https://www.bwdiver.com/dive-the-best-key-largo-dive-sites-bluewater-divers",
      "https://www.pcwatersports.com/key-largo-dive-sites",
    ],
    briefing: {
      name: "Snapper Ledge",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.9819,
      forecastLongitude: -80.4212,
      description:
        "A low coral ledge named for the yellowtail and other snapper that school along it, sometimes thickly enough to hide the reef. It also holds one of the biggest boulder brain corals in the Upper Keys.",
      marineLife: "Yellowtail snapper · nurse sharks · moray eels · hogfish",
      marineLifeDescription:
        "Schools along the ledge, nurse sharks tucked underneath it, and morays in the holes between.",
      difficultyLevel: "beginner",
      depthRange: "5–8 m (15–25 ft)",
      maxDepthMeters: 8,
      currentNote: "Usually gentle, and shallow enough for snorkelers on the same boat.",
      divePlan:
        "Follow the ledge from the mooring with it on one shoulder, look under it for sharks and eels, and turn back along the top.",
      fitTone: "welcoming",
      fitNote: "Shallow, easy and full of fish. A favourite second tank.",
      landmarks: [
        {
          name: "The ledge",
          kind: "reefFormation",
          note: "The undercut that gives the site its shape and its sleeping nurse sharks.",
        },
        {
          name: "The big boulder brain coral",
          kind: "reefFormation",
          note: "One of the largest of its kind in the Upper Keys. Admire it from a fin’s length away.",
        },
      ],
      creatureSlugs: [
        "yellowtail-snapper",
        "nurse-shark",
        "green-moray",
        "spotted-moray",
        "hogfish",
        "corkscrew-anemone",
      ],
    },
  },
  // Denominator row: Sand Island
  {
    slug: "sand-island",
    version: 1,
    area: "florida-keys-upper",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Sand%20Island%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.rainbowreef.com/dive-locations-in-key-largo/sand-island",
      "https://www.seadwellers.com/blog/scuba-diving/best-scuba-diving-in-key-largo-top-reefs-wrecks-what-to-expect",
    ],
    briefing: {
      name: "Sand Island",
      locationName: "Key Largo, Florida Keys National Marine Sanctuary",
      forecastLatitude: 25.0185,
      forecastLongitude: -80.3673,
      description:
        "Scattered coral heads and soft corals on open sand, just north of Molasses Reef. Shallow and forgiving, it is where Key Largo boats go when the outer reef is too rough or the current too strong.",
      marineLife: "Juvenile reef fish · puffers · sea fans · parrotfish",
      marineLifeDescription:
        "Look into the nooks on the shallow northeast side, where the young fish hide.",
      difficultyLevel: "beginner",
      depthRange: "5–9 m (15–30 ft)",
      maxDepthMeters: 9,
      currentNote: "The rough-weather choice: sheltered and easy when the deeper reefs are not.",
      divePlan:
        "A slow loop from coral head to coral head, coming back across the sand to the mooring.",
      fitTone: "welcoming",
      fitNote: "Easy navigation and gentle depths. A good first ocean dive or a calm checkout.",
      creatureSlugs: [
        "sharpnose-puffer",
        "stoplight-parrotfish",
        "common-sea-fan",
        "sea-plume",
        "yellowhead-jawfish",
      ],
    },
  },
];
