// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** The Gulf coast: Clearwater to Fort Myers. */
export const FLORIDA_GULF_COAST: DiveSiteTemplate[] = [
  // Denominator row: "Sheridan (Pinellas #2)"
  {
    slug: "sheridan-tug",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://pinellas.gov/artificial-reef-gps-coordinates",
      "https://www.scubaheroes.com/about/dive-sites",
      "https://www.floridagofishing.com/locations/cw/cw-reefs-and-shipwrecks.html",
      "https://narcosisscuba.com/charters",
    ],
    briefing: {
      name: "Sheridan",
      locationName: "off Clearwater, Florida",
      forecastLatitude: 27.8763,
      forecastLongitude: -83.1858,
      description:
        "A 55 m ocean tug sunk on the Pinellas #2 reef in the late 1980s, about 20 miles off Indian Rocks Beach. She sits upright and nearly whole with a list to starboard, one of the most intact wrecks on this coast.",
      marineLife: "Goliath grouper · barracuda · spadefish · snapper · amberjack",
      marineLifeDescription:
        "Bait and mackerel hang over the hull, and the big grouper keep to the shade beneath it.",
      difficultyLevel: "advanced",
      depthRange: "12–24 m (40–80 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Open Gulf, a long boat ride out, so current and visibility change from day to day. A heavily fished reef: watch for line and tackle on the hull. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "Local operators run it for Advanced divers: the depth sits near the bottom of recreational comfort and the ride out is long.",
      // Below 30 m, but the shops that run it ask for Advanced: 24 m on an open-Gulf site 20 miles out.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The deck",
          kind: "wreckFeature",
          note: "The top of the wreck, at about 12 m. The shallow end of the dive and the place to finish it.",
        },
        {
          name: "USCGC Blackthorn",
          kind: "wreckFeature",
          note: "A second wreck on the same reef, a short swim away. Most trips dive one, then the other.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "atlantic-spadefish",
        "gray-snapper",
        "lionfish",
      ],
    },
  },
  // Denominator row: "USCGC Blackthorn (Pinellas #2)"
  {
    slug: "uscgc-blackthorn",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://pinellas.gov/artificial-reef-gps-coordinates",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Blackthorn%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.scubaheroes.com/about/dive-sites",
      "https://www.floridagofishing.com/locations/cw/cw-reefs-and-shipwrecks.html",
    ],
    briefing: {
      name: "USCGC Blackthorn",
      locationName: "off Clearwater, Florida",
      forecastLatitude: 27.8766,
      forecastLongitude: -83.1861,
      description:
        "A 55 m Coast Guard buoy tender that sank in Tampa Bay in 1980 after a collision with a tanker that killed 23 of her crew. She was raised and sunk again as part of the Pinellas #2 reef, and today lies in two pieces in 24 m of water.",
      marineLife: "Goliath grouper · spadefish · snapper · amberjack · barracuda",
      marineLifeDescription:
        "Schools of mackerel and spadefish often cover the wreck, and whale sharks have passed through.",
      difficultyLevel: "advanced",
      depthRange: "15–24 m (50–80 ft)",
      maxDepthMeters: 25,
      currentNote:
        "Open Gulf about 20 miles out: current and visibility vary. The hull is broken and silted, so it is a dive around the outside, and line from the reef's anglers is common.",
      fitTone: "demanding",
      fitNote:
        "Twenty-three people died aboard her. Dive her with respect, and with the Advanced card local operators ask for.",
      // Below 30 m, but the shops that run it ask for Advanced: 24 m on an open-Gulf site 20 miles out.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Sheridan",
          kind: "wreckFeature",
          note: "The tug sunk on the same reef, a short swim away.",
        },
      ],
      creatureSlugs: ["goliath-grouper", "atlantic-spadefish", "gray-snapper", "great-barracuda"],
    },
  },
  // Denominator row: "Indian Shores Reef"
  {
    slug: "indian-shores-reef",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://pinellas.gov/artificial-reef-gps-coordinates",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Indian%20Shores%20Reef%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.scubaheroes.com/about/dive-sites",
      "https://www.visitstpeteclearwater.com/profile/indian-shores-reef/1060",
    ],
    briefing: {
      name: "Indian Shores Reef",
      locationName: "off Indian Shores, Florida",
      forecastLatitude: 27.8629,
      forecastLongitude: -83.0288,
      description:
        "One of Florida's oldest artificial reefs, begun in the 1960s and still being added to. Piles of culvert, slabs from the old John's Pass Bridge and clusters of reef balls make a wide field of hiding places on flat sand.",
      marineLife: "Goliath grouper · snapper · barracuda · spadefish",
      marineLifeDescription:
        "Every pile is its own small reef. Look into the culverts for the fish that live in them.",
      difficultyLevel: "beginner",
      depthRange: "8–14 m (25–45 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Usually mild, but Gulf visibility changes with wind and runoff. The reef is a popular fishing spot, so expect boats overhead and line on the rubble.",
      fitTone: "welcoming",
      fitNote: "Moderate depth and plenty to look at, a good first Gulf reef.",
      landmarks: [
        {
          name: "John's Pass Bridge rubble",
          kind: "reefFormation",
          note: "Bridge slabs and handrails laid down in 2006 and 2007, standing up to about 6 m off the sand.",
        },
        {
          name: "Reef ball clusters",
          kind: "reefFormation",
          note: "Five clusters of large reef balls set out in 2013 near the center of the reef.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "gray-snapper",
        "great-barracuda",
        "atlantic-spadefish",
        "lionfish",
      ],
    },
  },
  // Denominator row: "Indian Shores Landing Ships (LSM 1 and LSM 2)"
  {
    slug: "indian-shores-landing-ships",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://pinellas.gov/artificial-reef-gps-coordinates",
      "https://www.visitstpeteclearwater.com/profile/indian-shores-reef/1060",
      "https://www.scubaheroes.com/about/dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Indian%20Shores%20Reef%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Indian Shores Landing Ships",
      locationName: "off Indian Shores, Florida",
      forecastLatitude: 27.8574,
      forecastLongitude: -83.0306,
      description:
        "Two World War II Navy landing ships, each more than 60 m long, filled with scrap cable and sunk with explosives by a Navy bomb disposal team. One lies at the south end of Indian Shores Reef and the other near its center.",
      marineLife: "Goliath grouper · barracuda · blacktip sharks · snapper",
      difficultyLevel: "beginner",
      depthRange: "8–14 m (25–45 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Usually mild, with visibility that follows the weather. The hulls are old, broken and full of cable: stay outside them, and watch for fishing line.",
      landmarks: [
        {
          name: "The upside-down barge",
          kind: "wreckFeature",
          note: "A 73 m salt hopper barge sunk in 1984, lying inverted southwest of the reef's north end.",
        },
      ],
      creatureSlugs: ["goliath-grouper", "great-barracuda", "gray-snapper", "atlantic-spadefish"],
    },
  },
  // Denominator row: "St. Pete Beach Reef"
  {
    slug: "st-pete-beach-reef",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://pinellas.gov/artificial-reef-gps-coordinates",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27St.%20Pete%20Beach%20Site%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.scubaheroes.com/about/dive-sites",
    ],
    briefing: {
      name: "St. Pete Beach Reef",
      locationName: "off St. Pete Beach, Florida",
      forecastLatitude: 27.6767,
      forecastLongitude: -82.8625,
      description:
        "A shallow reef built from bridge concrete in 1976, with a 60 m steel barge added in 1984 and a row of M-60 Army tanks in 1995. A short ride and an easy depth make it an easy first Gulf dive.",
      marineLife: "Goliath grouper · snapper · spadefish · grunts",
      difficultyLevel: "beginner",
      depthRange: "7–10 m (22–32 ft)",
      maxDepthMeters: 10,
      currentNote:
        "Shallow and close to shore, so wind and runoff decide the visibility more than current does. Boats fish here often; fly a flag and watch for line.",
      fitTone: "welcoming",
      fitNote: "Shallow, close in and full of structure. A good place for new divers.",
      landmarks: [
        {
          name: "The barge",
          kind: "wreckFeature",
          note: "A 60 m steel barge, on the bottom since 1984 and slowly coming apart.",
        },
        {
          name: "The tanks",
          kind: "pointOfInterest",
          note: "M-60 Army tanks set down in a group in 1995.",
        },
      ],
      creatureSlugs: ["goliath-grouper", "gray-snapper", "atlantic-spadefish", "white-grunt"],
    },
  },
  // Denominator row: "Tug Orange (South County Reef)"
  {
    slug: "tug-orange",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://pinellas.gov/artificial-reef-gps-coordinates",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Pinellas%20South%20Reef%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.scubaheroes.com/about/dive-sites",
    ],
    briefing: {
      name: "Tug Orange",
      locationName: "off St. Petersburg, Florida",
      forecastLatitude: 27.7229,
      forecastLongitude: -82.9742,
      description:
        "A 24 m steel harbor tug sunk on the South County Reef in the early 2000s, now lying on her port side in 14 m of water. Three steel barges sit close by, so one dive can take in several wrecks.",
      marineLife: "Goliath grouper · barracuda · spadefish · snapper",
      marineLifeDescription: "Pelagic fish and the odd shark come through over the wreck.",
      difficultyLevel: "beginner",
      depthRange: "8–15 m (25–50 ft)",
      maxDepthMeters: 15,
      currentNote:
        "A shorter ride than the offshore wrecks, with visibility that follows the weather. Stay outside the hull, and watch for fishing line.",
      landmarks: [
        {
          name: "The barges",
          kind: "wreckFeature",
          note: "Three upright steel barges, 23 to 35 m long, sunk in 2004 a short way west of the tug in about 15 m.",
        },
      ],
      creatureSlugs: ["goliath-grouper", "great-barracuda", "atlantic-spadefish", "gray-snapper"],
    },
  },
  // Denominator row: "Veterans Reef (Circle of Heroes underwater veterans memorial)"
  {
    slug: "veterans-reef-circle-of-heroes",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://pinellas.gov/artificial-reef-gps-coordinates",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Circle%20of%20Heroes%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.scubaheroes.com/about/dive-sites",
    ],
    briefing: {
      name: "Veterans Reef and the Circle of Heroes",
      locationName: "off Dunedin, Florida",
      forecastLatitude: 28.05,
      forecastLongitude: -83.0125,
      description:
        "A reef of steel barges and concrete about 10 miles off Dunedin, and home since 2019 to the Circle of Heroes: a ring of life-size concrete statues of service members, billed as the first underwater veterans memorial.",
      marineLife: "Goliath grouper · snapper · spadefish · barracuda",
      difficultyLevel: "beginner",
      depthRange: "12–14 m (40–45 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Open Gulf, so current and visibility vary with the day. A memorial: look, photograph, and leave the statues as you found them. A fished reef: fly a flag and watch for line on the barges.",
      fitTone: "welcoming",
      fitNote: "A moderate depth and a dive with a story. Open Water divers are welcome here.",
      landmarks: [
        {
          name: "Circle of Heroes",
          kind: "underwaterMonument",
          note: "Statues of soldiers, sailors, airmen, Marines and Coast Guard members standing in a circle on the sand.",
        },
        {
          name: "The barges",
          kind: "wreckFeature",
          note: "Upright steel barges sunk from 1999, with culvert and pilings piled around them.",
        },
      ],
      creatureSlugs: ["goliath-grouper", "gray-snapper", "atlantic-spadefish", "great-barracuda"],
    },
  },
  // Denominator row: "Regina (Sugar Barge)"
  {
    slug: "regina-wreck",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://museumsinthesea.fpan.us/preserves/regina",
      "https://en.wikipedia.org/wiki/SS_Regina_(1904)",
      "https://www.bradentongulfislands.com/blogs/snorkeling-and-scuba-diving-in-the-bradenton-area/",
    ],
    briefing: {
      name: "Regina",
      locationName: "Bradenton Beach, Florida",
      forecastLatitude: 27.4689,
      forecastLongitude: -82.7019,
      description:
        "A steel steamer built in Belfast in 1904 and later turned into a molasses barge. She ran aground in a storm in 1940 under tow from Havana and broke up about 70 m off the beach, where she is now a state underwater archaeological preserve.",
      marineLife: "Grunts · sheepshead · blue crabs · manatees",
      marineLifeDescription:
        "Beach and seagrass life: small fish on the plates, crabs underneath, and the odd manatee.",
      difficultyLevel: "beginner",
      depthRange: "3–6 m (10–20 ft)",
      maxDepthMeters: 6,
      currentNote:
        "A shore dive or snorkel from the beach. Surf and stirred sand set the visibility, and the bottom shifts as the beach is renourished. It is outside the swim zone, so tow a dive flag. Longshore and rip currents run along this beach; check the flags before you wade in. Jet skis and boats work just outside the swim zone, so stay on the flag and surface beside it.",
      fitTone: "welcoming",
      fitNote: "Shallow enough to snorkel. A protected preserve: nothing comes off it.",
      creatureSlugs: ["manatee", "gray-snapper", "white-grunt"],
    },
  },
  // Denominator row: "USS Mohawk CGC Veterans Memorial Reef (Charlie's Reef)"
  {
    slug: "uss-mohawk-memorial-reef",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27USS%20Mohawk%20CGC%20V.M.R.%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://visitfortmyers.com/listing/uss-mohawk-memorial-reef/45594",
      "https://services2.arcgis.com/LvWGAAhHwbCJ2GMP/arcgis/rest/services/ArtificialReef/FeatureServer/0/query?where=Reef%20LIKE%20%27CHARLIE%25%27&outFields=Reef,ID,Material,DEPTH,LAT_DD,LONG_DD&f=json",
    ],
    briefing: {
      name: "USS Mohawk Memorial Reef",
      locationName: "off Sanibel Island, Florida",
      forecastLatitude: 26.5513,
      forecastLongitude: -82.7247,
      description:
        "A World War II Coast Guard cutter, 50 m long, sunk on 2 July 2012 about 28 nautical miles off Sanibel as a memorial reef to all American veterans. She sits upright on the sand with her bow to the east.",
      marineLife: "Goliath grouper · amberjack · barracuda · cobia",
      difficultyLevel: "advanced",
      depthRange: "9–27 m (30–90 ft)",
      maxDepthMeters: 28,
      currentNote:
        "A long open-Gulf run with no shelter, so current, visibility and sea state all decide the day. Moored at bow and stern. Stay outside the hull.",
      fitTone: "demanding",
      fitNote:
        "Far offshore and close to 30 m on the sand. Plan it as a deep dive with a hard turn pressure.",
      // Below 30 m, but the sand at 27 m sits close to it and the site is 28 nautical miles out in open Gulf.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The deck guns",
          kind: "wreckFeature",
          note: "Replica guns mounted at the bow and the stern.",
        },
        {
          name: "The propeller",
          kind: "wreckFeature",
          note: "A 3 m propeller at the stern, near the deepest part of the dive.",
        },
        {
          name: "Pegasus",
          kind: "wreckFeature",
          note: "A steel tug sunk in 1999 on the same reef, close enough to dive on the same trip.",
        },
      ],
      creatureSlugs: ["goliath-grouper", "great-barracuda", "cobia", "gray-snapper", "lionfish"],
    },
  },
  // Denominator row: "Pegasus Tugboat (Charlie's Reef)"
  {
    slug: "pegasus-tug",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Pegasus%20Tugboat%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://sanibel-captiva.org/sanibel-island-snorkeling-scuba-diving/",
      "https://services2.arcgis.com/LvWGAAhHwbCJ2GMP/arcgis/rest/services/ArtificialReef/FeatureServer/0/query?where=Reef%20LIKE%20%27CHARLIE%25%27&outFields=Reef,ID,Material,DEPTH,LAT_DD,LONG_DD&f=json",
    ],
    briefing: {
      name: "Pegasus",
      locationName: "off Captiva Island, Florida",
      forecastLatitude: 26.5522,
      forecastLongitude: -82.7236,
      description:
        "A 34 m steel tug sunk in 1999 on Charlie's Reef, about 28 miles west of Redfish Pass, beside railroad hopper cars laid down a few years earlier. The USS Mohawk joined her on the same reef in 2012.",
      marineLife: "Barracuda · cobia · nurse sharks · grouper · amberjack · moray eels",
      difficultyLevel: "advanced",
      depthRange: "15–26 m (50–85 ft)",
      maxDepthMeters: 26,
      currentNote:
        "Open Gulf a long way out, so current and visibility vary with the day. Stay outside the hull.",
      fitTone: "demanding",
      // Below 30 m, but 26 m on an open-Gulf site 28 miles from the pass.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The hopper cars",
          kind: "wreckFeature",
          note: "Steel railroad hopper cars sunk on the reef in the early 1990s.",
        },
      ],
      creatureSlugs: ["great-barracuda", "cobia", "nurse-shark", "goliath-grouper", "green-moray"],
    },
  },
  // Denominator row: "Edison Reef"
  {
    slug: "edison-reef",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://sanibel-captiva.org/sanibel-island-snorkeling-scuba-diving/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%20LIKE%20%27Edison%25%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://services2.arcgis.com/LvWGAAhHwbCJ2GMP/arcgis/rest/services/ArtificialReef/FeatureServer/0/query?where=Reef%20LIKE%20%27EDISON%25%27&outFields=Reef,ID,Material,DEPTH,LAT_DD,LONG_DD&f=json",
    ],
    briefing: {
      name: "Edison Reef",
      locationName: "off Sanibel Island, Florida",
      forecastLatitude: 26.3088,
      forecastLongitude: -82.2224,
      description:
        "Spans and rubble from the old Edison Bridge in Fort Myers, sunk in 1993 to make one of the largest reefs off Sanibel. The pieces stand up to about 5 m off the sand and spread across a wide area.",
      marineLife: "Grouper · snapper · spadefish · barracuda",
      difficultyLevel: "beginner",
      depthRange: "9–14 m (30–45 ft)",
      maxDepthMeters: 14,
      currentNote:
        "Gulf visibility changes with the wind and the outflow from the Caloosahatchee. A popular fishing reef, so watch for line.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "The bridge spans",
          kind: "reefFormation",
          note: "Eight groups of bridge spans standing up to about 5 m high.",
        },
      ],
      creatureSlugs: ["goliath-grouper", "gray-snapper", "atlantic-spadefish", "great-barracuda"],
    },
  },
  // Denominator row: "Belton Johnson Reef"
  {
    slug: "belton-johnson-reef",
    version: 1,
    area: "florida-gulf-coast",
    sources: [
      "https://sanibel-captiva.org/sanibel-island-snorkeling-scuba-diving/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Belton%20Johnson%20Reef%27&outFields=Name,Description,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://services2.arcgis.com/LvWGAAhHwbCJ2GMP/arcgis/rest/services/ArtificialReef/FeatureServer/0/query?where=Reef%20LIKE%20%27BELTON%25%27&outFields=Reef,ID,Material,DEPTH,LAT_DD,LONG_DD&f=json",
    ],
    briefing: {
      name: "Belton Johnson Reef",
      locationName: "off Sanibel Island, Florida",
      forecastLatitude: 26.4251,
      forecastLongitude: -82.1947,
      description:
        "A reef of concrete culverts, slabs and stacked pilings about 5 nautical miles off Bowman's Beach, built in 1996 and 1997 and named for a well-known local fishing guide. The closest of Sanibel's reefs and one of the shallowest.",
      marineLife: "Snapper · grouper · spadefish",
      difficultyLevel: "beginner",
      depthRange: "6–10 m (20–32 ft)",
      maxDepthMeters: 10,
      currentNote:
        "Shallow and close in, so the weather sets the visibility. A yellow and white marker shows the reef, and anglers use it too.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "The piling stacks",
          kind: "reefFormation",
          note: "Pilings stacked in a log-cabin pattern, about 4 m tall.",
        },
      ],
      creatureSlugs: ["gray-snapper", "goliath-grouper", "atlantic-spadefish"],
    },
  },
];
