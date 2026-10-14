// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Key West. */
export const FLORIDA_KEYS_KEY_WEST: DiveSiteTemplate[] = [
  {
    slug: "usns-vandenberg",
    version: 2,
    area: "florida-keys-key-west",
    sources: [
      "https://visitfloridakeys.com/experiences/what-were-famous-for/diving-snorkeling/shipwrecks/vandenberg",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Hoyt%20Vandenberg%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Vandenberg%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
    ],
    briefing: {
      name: "USNS Vandenberg",
      locationName: "Key West, Florida",
      forecastLatitude: 24.4599,
      forecastLongitude: -81.7365,
      description:
        "A 159 m missile-tracking ship sunk in 2009, sitting upright in 44 m with her big tracking dishes still aboard. The second-largest artificial reef in the world, and it feels like it.",
      marineLife: "Goliath grouper · permit · barracuda · amberjack",
      marineLifeDescription:
        "Permit meet you on the way down. The superstructure carries dense schooling fish, and the dishes are usually surrounded.",
      difficultyLevel: "advanced",
      depthRange: "12–44 m (40–145 ft)",
      maxDepthMeters: 44,
      currentNote: "Seven miles offshore in open water — current is common.",
      divePlan:
        "Down the line to the superstructure, one section only — the mast, a dish, or the bridge — and back to the line. Nobody sees this ship in one dive.",
      fitTone: "demanding",
      fitNote:
        "Big, deep, and easy to over-run. Nitrox, a plan for one section, and a hard turn on gas.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The satellite dishes",
          kind: "wreckFeature",
          note: "The tracking dishes she carried in service. They are the reason this wreck looks like nothing else.",
        },
        {
          name: "The crow's nest",
          kind: "wreckFeature",
          note: "The shallowest steel at about 12 m — where a long safety stop becomes a pleasure.",
        },
        {
          name: "Bridge deck",
          kind: "wreckFeature",
          note: "Open and swimmable at about 27 m, with the whole ship visible fore and aft on a clear day.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "permit-fish",
        "great-barracuda",
        "horse-eye-jack",
        "cobia",
        "azure-vase-sponge",
      ],
    },
  },
  {
    slug: "sand-key-reef",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/sandkey.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Sand%20Key%20Reef%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://en.wikipedia.org/wiki/Sand_Key_Light",
      "https://www.islands.com/1857745/snorkeling-paradise-sand-key-lighthouse-key-west-coral-towers/",
    ],
    briefing: {
      name: "Sand Key Reef",
      locationName: "Key West, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.4539,
      forecastLongitude: -81.8775,
      description:
        "A shallow reef around an 1853 iron lighthouse and its shifting sand island. Sheltered on one side, exposed on the other, so there is nearly always a workable face.",
      marineLife: "Parrotfish · yellowtail snapper · sea fans · barracuda",
      marineLifeDescription:
        "Dense soft coral on the seaward face, and a permanent cloud of yellowtail wherever a boat has been.",
      difficultyLevel: "beginner",
      depthRange: "3–14 m (10–45 ft)",
      maxDepthMeters: 14,
      currentNote: "Pick the lee side of the light and the day is usually easy.",
      divePlan:
        "Circle out from the mooring along the reef edge and back — the deeper sand is worth a look for rays.",
      fitTone: "welcoming",
      fitNote: "Shallow, close to town, and workable in most conditions.",
      landmarks: [
        {
          name: "Sand Key Light",
          kind: "navigationMark",
          note: "The iron tower on its own small island — the reference for the whole site.",
        },
      ],
      creatureSlugs: [
        "yellowtail-snapper",
        "queen-parrotfish",
        "common-sea-fan",
        "great-barracuda",
        "southern-stingray",
        "sea-plume",
      ],
    },
  },
  {
    slug: "western-dry-rocks",
    version: 2,
    area: "florida-keys-key-west",
    sources: [
      "https://myfwc.com/research/saltwater/wdr/",
      "https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-68B-6-004",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Western%20Dry%20Rocks%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.duikersgids.nl/en/dive-spots/western-dry-rocks",
    ],
    briefing: {
      name: "Western Dry Rocks",
      locationName: "Key West, Florida",
      forecastLatitude: 24.4467,
      forecastLongitude: -81.9283,
      description:
        "A cut-and-cave reef west of Key West, riddled with ledges and tunnels. It is a known spawning site, so the state closes it to all fishing from April through July. That is why the fish life is what it is.",
      marineLife: "Goliath grouper · permit · tarpon · nurse sharks",
      marineLifeDescription:
        "The ledges hold big fish through the day. In spring and early summer the spawning gatherings here are extraordinary.",
      difficultyLevel: "intermediate",
      depthRange: "6–20 m (20–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Tidal current runs through the cuts and can be strong, so it is often dived as a drift. Outside the spring closure the ledges carry fishing line: carry a cutter and look before you reach into a hole.",
      divePlan:
        "Work the ledge line with the current, look into every cut, and finish on the shallow reef top.",
      fitTone: "demanding",
      fitNote:
        "Current and structure together — comfortable in a drift, and happy to swim away from a hole rather than into it.",
      landmarks: [
        {
          name: "The caves",
          kind: "reefFormation",
          note: "Undercut ledges rather than true caves, and no place to go in past your light.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "permit-fish",
        "tarpon",
        "nurse-shark",
        "spiny-lobster",
        "blackbar-soldierfish",
      ],
    },
  },
  // Denominator row: Cayman Salvager (Cayman Salvor, Cayman Salvage Master)
  {
    slug: "cayman-salvager",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Cayman%20Salvage%20Master%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Cayman%20Salvor%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://divekeywest.com/wreck-diving-key-west/",
      "https://finzdivecenter.com/dives/wreck-dive/",
    ],
    briefing: {
      name: "Cayman Salvager",
      locationName: "Key West, Florida",
      forecastLatitude: 24.4535,
      forecastLongitude: -81.7663,
      description:
        "A 57 m former US Army minelayer that worked on as the Cayman Salvage Master before she was sunk off Key West in 1985. She sits upright on sand, heavily grown over, and a pair of goliath grouper are often waiting at the bow.",
      marineLife: "Goliath grouper · snapper · great barracuda · sea turtles",
      marineLifeDescription:
        "The grouper are the reason most people come. Schools of snapper hang off the hull.",
      difficultyLevel: "advanced",
      depthRange: "21–30 m (70–100 ft)",
      maxDepthMeters: 30,
      currentNote:
        "Open water south of Key West, where current is common. The deck lies around 21–29 m depending on where you stand, and the sand near 30 m. Stay outside the hull.",
      divePlan:
        "Down the line to the bow, a slow lap of the deck at a planned depth, and back to the line with gas to spare. A natural nitrox dive.",
      fitTone: "demanding",
      fitNote: "Deep enough that the bottom time goes quickly. For divers comfortable near 30 m.",
      // Below 30 m only by a metre: the sand is at about 30 m and Key West operators ask for an
      // advanced card or recent deep experience before taking divers here.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The bow",
          kind: "wreckFeature",
          note: "Usually the first thing you reach on the way down, and where the resident goliaths tend to sit.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "gray-snapper",
        "great-barracuda",
        "green-sea-turtle",
        "horse-eye-jack",
      ],
    },
  },
  // Denominator row: Joe's Tug
  {
    slug: "joes-tug",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Joe%27%27s%20Tug%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://nmsfloridakeys.blob.core.windows.net/floridakeys-prod/media/archive/mbuoy/mooringbuoy20140228.pdf",
      "https://finzdivecenter.com/dives/wreck-dive/",
    ],
    briefing: {
      name: "Joe’s Tug",
      locationName: "Key West, Florida",
      forecastLatitude: 24.4642,
      forecastLongitude: -81.7378,
      description:
        "A 27 m tugboat sunk off Key West in 1989, now broken up by years of storms and settled against a living reef. Small as wrecks go, and you never quite know what will be sitting in it.",
      marineLife: "Sea turtles · moray eels · grouper · reef fish",
      marineLifeDescription:
        "The wreckage and the reef beside it share their fish, so a dive here is two sites in one.",
      difficultyLevel: "intermediate",
      depthRange: "15–20 m (50–65 ft)",
      maxDepthMeters: 20,
      currentNote:
        "Open water south of Key West, so current is possible. Storm damage has left sharp, loose metal: look, but stay off and out of it.",
      divePlan:
        "Circle the tug from the mooring, then spend the rest of the dive on the reef that surrounds it.",
      fitNote: "A good first wreck for a diver already comfortable at 20 m.",
      creatureSlugs: [
        "green-sea-turtle",
        "green-moray",
        "black-grouper",
        "gray-snapper",
        "french-angelfish",
      ],
    },
  },
  // Denominator row: Eastern Dry Rocks
  {
    slug: "eastern-dry-rocks",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/eastern.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Eastern%20Dry%20Rocks%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.snubakeywest.com/about-us/dive-sites-in-key-west-with-snuba-diving-florida-reefs-shipwrecks-sandbar-trips/",
      "https://visitfloridakeys.com/sites/default/files/2025-10/Reef-Explorer-Guide.pdf",
    ],
    briefing: {
      name: "Eastern Dry Rocks",
      locationName: "Key West, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.46,
      forecastLongitude: -81.8455,
      description:
        "A compact bank reef south of Key West: long coral fingers separated by sand and coral-filled canyons, with a rubble zone on top. It is one of seven reefs in NOAA’s Mission: Iconic Reefs restoration effort, so expect to see young coral that people planted.",
      marineLife: "Sea fans · parrotfish · grunts · yellowtail snapper",
      marineLifeDescription:
        "Gorgonians across the fingers, and reef fish moving through every canyon.",
      difficultyLevel: "beginner",
      depthRange: "2–11 m (5–35 ft)",
      maxDepthMeters: 11,
      currentNote:
        "A Sanctuary Preservation Area: no fishing or collecting, no touching the coral, and boats use the mooring buoys. Generally an easy reef.",
      divePlan:
        "Follow one coral finger out from the mooring, cross a sand channel, and come back along the next.",
      fitTone: "welcoming",
      fitNote: "Shallow, clear and easy to navigate. Good for new divers and snorkelers together.",
      landmarks: [
        {
          name: "Coral fingers",
          kind: "reefFormation",
          note: "Long spurs of reef running seaward, with sand canyons between them.",
        },
      ],
      creatureSlugs: [
        "common-sea-fan",
        "stoplight-parrotfish",
        "bluestriped-grunt",
        "yellowtail-snapper",
        "blue-tang",
        "sea-plume",
      ],
    },
  },
  // Denominator row: Rock Key
  {
    slug: "rock-key",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/rockkey.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Rock%20Key%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.snubakeywest.com/about-us/dive-sites-in-key-west-with-snuba-diving-florida-reefs-shipwrecks-sandbar-trips/",
    ],
    briefing: {
      name: "Rock Key",
      locationName: "Key West, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.4549,
      forecastLongitude: -81.8581,
      description:
        "A small bank reef a mile east of Sand Key Light, packing coral fingers, sand canyons and a rubble zone into a short swim. It is a Sanctuary Preservation Area, and the fish behave like it.",
      marineLife: "Parrotfish · grunts · snapper · sea fans",
      difficultyLevel: "beginner",
      depthRange: "2–11 m (5–35 ft)",
      maxDepthMeters: 11,
      currentNote:
        "Usually easy. A preservation area: no fishing or collecting, no touching the coral, moor on the buoys.",
      divePlan:
        "Out along a coral finger, back through a sand canyon, and finish in the shallows near the mooring.",
      fitTone: "welcoming",
      fitNote: "Shallow and simple to find your way around. A good first reef in Key West.",
      landmarks: [
        {
          name: "Sand Key Light",
          kind: "navigationMark",
          note: "The iron lighthouse a mile to the west, visible from the surface on a clear day.",
        },
      ],
      creatureSlugs: [
        "stoplight-parrotfish",
        "french-grunt",
        "yellowtail-snapper",
        "common-sea-fan",
        "great-barracuda",
      ],
    },
  },
  // Denominator row: Western Sambo (Sambos, Western Sambos)
  {
    slug: "western-sambo",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://floridakeys.noaa.gov/zones/ers/westernsambo.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Western%20Sambos%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.snubakeywest.com/about-us/dive-sites-in-key-west-with-snuba-diving-florida-reefs-shipwrecks-sandbar-trips/",
      "https://lostreefadventures.com/padi-scuba-certifications/scuba-diving-key-west-reefs-wrecks-dive-trips/",
    ],
    briefing: {
      name: "Western Sambo",
      locationName: "Boca Chica, Key West, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.4813,
      forecastLongitude: -81.7124,
      description:
        "The shallow bank reef at the outer edge of the Western Sambo reserve, the no-take zone with the widest range of habitats in the Lower Keys. Spurs and grooves on the reef line, patch reefs inshore, and fish that have not been fished.",
      marineLife: "Gray angelfish · surgeonfish · parrotfish · sea fans",
      marineLifeDescription:
        "Big gray angelfish drift over the shallows, and the reef fish here are noticeably bold.",
      difficultyLevel: "beginner",
      depthRange: "3–8 m (10–26 ft)",
      maxDepthMeters: 8,
      currentNote:
        "Inside a no-take reserve (the Western Sambo Ecological Reserve, renamed a Conservation Area under the sanctuary’s new rules): no fishing, spearing or collecting of any kind, and boats use the mooring buoys. Usually easy on the reef top.",
      divePlan:
        "Follow a spur seaward from the mooring, turn at your planned depth, and come back along the next groove.",
      fitTone: "welcoming",
      fitNote: "Shallow, protected and full of unhurried fish.",
      landmarks: [
        {
          name: "Spur-and-groove reef",
          kind: "reefFormation",
          note: "Coral ridges and sand channels running out toward deeper water.",
        },
      ],
      creatureSlugs: [
        "gray-angelfish",
        "blue-tang",
        "stoplight-parrotfish",
        "common-sea-fan",
        "yellowtail-snapper",
        "spiny-lobster",
      ],
    },
  },
  // Denominator row: Cottrell Key
  {
    slug: "cottrell-key",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Cottrell%20Key%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.snubakeywest.com/about-us/dive-sites-in-key-west-with-snuba-diving-florida-reefs-shipwrecks-sandbar-trips/",
      "https://visitfloridakeys.com/sites/default/files/2025-10/Reef-Explorer-Guide.pdf",
    ],
    briefing: {
      name: "Cottrell Key",
      locationName: "Key West, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.6146,
      forecastLongitude: -81.9195,
      description:
        "Shallow sponge and sand bottom off a small key northwest of Key West, the northernmost of the Mule Keys. A gentle, easy swim where rays and turtles turn up among the sponges.",
      marineLife: "Sponges · rays · sea turtles · tropical fish",
      difficultyLevel: "beginner",
      depthRange: "2–4 m (6–14 ft)",
      maxDepthMeters: 4,
      currentNote:
        "Barely deeper than a snorkel site, so any chop reaches the bottom. Save it for a calm day.",
      divePlan: "A slow, shallow wander among the sponges near the mooring.",
      fitTone: "welcoming",
      fitNote: "As shallow and easy as Key West diving gets.",
      creatureSlugs: [
        "southern-stingray",
        "green-sea-turtle",
        "branching-vase-sponge",
        "sergeant-major",
        "bluehead-wrasse",
      ],
    },
  },
  // Denominator row: Nine Foot Stake (9 Foot Stake)
  {
    slug: "nine-foot-stake",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%279%20Foot%20Stake%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://southpointdivers.com/dive-in-a-day/",
      "https://www.duikersgids.nl/en/dive-spots/nine-foot-stake",
    ],
    briefing: {
      name: "Nine Foot Stake",
      locationName: "Key West, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.4721,
      forecastLongitude: -81.7642,
      description:
        "A shallow reef south of Key West named for the marker stake that once stood on it. Easy, clear and close to town, it is a common first dive and a favourite with photographers.",
      marineLife: "Green morays · parrotfish · grunts · snapper",
      difficultyLevel: "beginner",
      depthRange: "2–9 m (6–30 ft)",
      maxDepthMeters: 9,
      currentNote:
        "Current is usually limited, and the reef is shallow enough to stay close to the mooring.",
      divePlan: "A relaxed loop of the reef from the mooring. Good for a night dive, too.",
      fitTone: "welcoming",
      fitNote: "Shallow and forgiving. A good first ocean dive or training dive.",
      creatureSlugs: [
        "green-moray",
        "stoplight-parrotfish",
        "french-grunt",
        "yellowtail-snapper",
        "common-sea-fan",
      ],
    },
  },
  // Denominator row: Toppino's Reef (Marker 32)
  {
    slug: "toppinos-reef",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Toppinos%20Marker%2032%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://southpointdivers.com/dive-in-a-day/",
      "https://www.duikersgids.nl/en/marker-32-reef",
    ],
    briefing: {
      name: "Toppino’s Reef (Marker 32)",
      locationName: "Key West, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.474,
      forecastLongitude: -81.7435,
      description:
        "A shallow spur-and-groove reef south of Key West, beside the channel marker numbered 32 that gives it its other name. Its coral fingers rise off a sand bottom and hold a steady crowd of reef fish.",
      marineLife: "Grunts · yellowtail snapper · green morays · sea turtles",
      difficultyLevel: "beginner",
      depthRange: "3–8 m (10–27 ft)",
      maxDepthMeters: 8,
      currentNote:
        "Current is usually limited, but boats run past the marker: fly a dive flag and surface by the boat. Not a preservation area, so you may share it with fishing boats.",
      divePlan: "Swim a coral finger out from the mooring and return along the next one.",
      fitTone: "welcoming",
      fitNote: "Shallow, easy and close to town.",
      landmarks: [
        {
          name: "Marker 32",
          kind: "navigationMark",
          note: "The channel marker beside the reef, and the site’s second name.",
        },
      ],
      creatureSlugs: [
        "french-grunt",
        "yellowtail-snapper",
        "green-moray",
        "green-sea-turtle",
        "longsnout-butterflyfish",
        "nurse-shark",
      ],
    },
  },
  // Denominator row: Windjammer (Avanti), Dry Tortugas
  {
    slug: "windjammer-wreck",
    version: 1,
    area: "florida-keys-key-west",
    sources: [
      "https://www.nps.gov/drto/planyourvisit/drtomooringbuoys.htm",
      "https://www.nps.gov/drto/planyourvisit/swimming-snorkeling-and-diving.htm",
      "https://finzdivecenter.com/dives/tortugas/",
      "https://www.tourparks.com/tours/dry-tortugas-scuba-snorkel-charter/",
    ],
    briefing: {
      name: "Windjammer Wreck (Avanti)",
      locationName: "Loggerhead Reef, Dry Tortugas National Park, Florida",
      forecastLatitude: 24.6236,
      forecastLongitude: -82.9429,
      description:
        "The Avanti, an 80 m three-masted iron sailing ship built in 1875, wrecked on Loggerhead Reef in 1907. Her broken hull rises from shallow water almost to the surface, coral-covered and full of fish, about 70 miles west of Key West.",
      marineLife: "Hogfish · snapper · grunts · great barracuda",
      marineLifeDescription:
        "Remote and protected, so the fish are larger and more numerous than on most Keys reefs.",
      difficultyLevel: "intermediate",
      depthRange: "1–6 m (3–21 ft)",
      maxDepthMeters: 7,
      currentNote:
        "Inside the park’s Research Natural Area: boats must use the mooring buoy (two hours at most), and nothing is taken or touched. Wreckage reaches the surface, so watch your head on ascent and your hands near the sharp iron. The nearest help is a long boat ride away.",
      divePlan:
        "Circle the hull from the mooring, looking into the open frames from outside, and finish over the reef around it.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and spectacular. The long, all-day crossing is the hard part, not the dive.",
      landmarks: [
        {
          name: "The iron hull",
          kind: "wreckFeature",
          note: "Frames and plates of the 1875 ship, parts of them breaking the surface.",
        },
        {
          name: "Loggerhead Key Light",
          kind: "navigationMark",
          note: "The lighthouse on the nearby island, the reference point for the reef.",
        },
      ],
      creatureSlugs: ["hogfish", "gray-snapper", "french-grunt", "great-barracuda", "porkfish"],
    },
  },
];
