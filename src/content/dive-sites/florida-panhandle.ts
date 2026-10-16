// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** The Panhandle: Pensacola, Destin and Panama City. */
export const FLORIDA_PANHANDLE: DiveSiteTemplate[] = [
  {
    slug: "uss-oriskany",
    version: 2,
    area: "florida-panhandle",
    sources: [
      "https://myfwc.com/fishing/saltwater/artificial-reefs/oriskany/",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Oriskany%20Memorial%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://reefsmartguides.com/oriskany/",
    ],
    briefing: {
      name: "USS Oriskany",
      locationName: "Pensacola, Florida",
      forecastLatitude: 30.0425,
      forecastLongitude: -87.0064,
      description:
        "An aircraft carrier, 278 m (911 ft) long, sunk in 2006 and standing upright in 65 m of Gulf water. The largest artificial reef in the world. A recreational plan stays on the island tower, from about 26 m; the flight deck at 44–46 m and the sand at 65 m are technical dives.",
      marineLife: "Amberjack · barracuda · red snapper · whale sharks (rarely)",
      marineLifeDescription:
        "Pelagic. The tower holds bait balls and the amberjack that work them; the open Gulf brings everything else.",
      difficultyLevel: "advanced",
      depthMinMeters: 26,
      maxDepthMeters: 44,
      currentNote:
        "Open Gulf, 22 miles out. Current, visibility and the boat ride all decide the day together.",
      divePlan:
        "The island tower only, on a recreational dive: down the line to about 26–30 m, one section of the superstructure, and back up the line. The flight deck is a technical dive.",
      fitTone: "demanding",
      fitNote:
        "This is the deepest thing most recreational divers will ever do, on a long open-Gulf ride. Nitrox, a conservative plan, and a hard turn pressure.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The island tower",
          kind: "wreckFeature",
          note: "The superstructure, from about 26 m down. The whole recreational dive happens here.",
        },
        {
          name: "The flight deck",
          kind: "wreckFeature",
          note: "At about 44–46 m and beyond recreational limits for most plans. Look down at it, not from it.",
        },
      ],
      creatureSlugs: [
        "horse-eye-jack",
        "great-barracuda",
        "cobia",
        "gray-snapper",
        "remora",
        "red-rope-sponge",
      ],
    },
  },
  {
    slug: "vamar-wreck",
    version: 2,
    area: "florida-panhandle",
    sources: [
      "https://en.wikipedia.org/wiki/Vamar_Shipwreck_Site",
      "https://npgallery.nps.gov/GetAsset/54d835f5-7714-4d33-81e4-80f4e5d8a557",
    ],
    briefing: {
      name: "Vamar Wreck",
      locationName: "Mexico Beach, Florida",
      forecastLatitude: 29.8989,
      forecastLongitude: -85.4633,
      description:
        "A 52 m steamer that carried Admiral Byrd's 1928 Antarctic expedition. She sank in 1942 about 6 km off Mexico Beach with a load of lumber, and is now a protected state underwater archaeological preserve in 8 m of sand.",
      marineLife: "Sheepshead · flounder · octopus · sea urchins",
      marineLifeDescription:
        "Gulf life rather than reef life — the wreck is an island of structure on an otherwise empty sand plain.",
      difficultyLevel: "beginner",
      maxDepthMeters: 9,
      currentNote: "Shallow and usually calm; Gulf visibility is the variable, not the current.",
      divePlan:
        "Follow the hull line, look under every plate, and give the whole tank to a wreck the size of a tennis court.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and forgiving. A protected preserve — nothing comes off it, including the small stuff.",
      landmarks: [
        {
          name: "The boiler",
          kind: "wreckFeature",
          note: "The highest point on the wreck and the first thing to find on the descent.",
        },
      ],
      creatureSlugs: [
        "caribbean-reef-octopus",
        "sand-diver",
        "gray-snapper",
        "spotted-scorpionfish",
      ],
    },
  },
  // Denominator row: "Miss Louise (Crystal Beach Tug)"
  {
    slug: "miss-louise-tug",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Miss%20Louise%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://floridapanhandledivetrail.com/Ships/MissLouise",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
    ],
    briefing: {
      name: "Miss Louise",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.3714,
      forecastLongitude: -86.4219,
      description:
        "A 29 m push tug sunk off the beach east of Destin in 1997 as a training reef. Storms took her wheelhouse, but the hull and the big push pads still stand upright on the sand, and the fish never left.",
      marineLife: "Spadefish · Spanish mackerel · barracuda · goliath grouper (sometimes)",
      marineLifeDescription:
        "Bait schools over the hull bring the mackerel in, and a goliath grouper turns up often enough to keep watching the shadows.",
      difficultyLevel: "beginner",
      depthMinMeters: 14,
      maxDepthMeters: 18,
      currentNote:
        "Usually mild current and a short ride from East Pass. Gulf visibility changes day to day, and fishing line snags on the hull.",
      divePlan:
        "Circle the hull on the sand, look in through the holes in her sides, then come up over the deck and the push pads before the ascent.",
      fitTone: "welcoming",
      fitNote: "Shallow, upright and small enough to see whole. A good first Gulf wreck.",
      landmarks: [
        {
          name: "The push pads",
          kind: "wreckFeature",
          note: "The tall bow fenders she pushed barges with, still upright and the highest part of the wreck.",
        },
      ],
      creatureSlugs: [
        "atlantic-spadefish",
        "great-barracuda",
        "goliath-grouper",
        "gray-snapper",
        "lionfish",
      ],
    },
  },
  // Denominator row: "Thomas Heyward Liberty Ship (Thomas Hayward, Destin Liberty Ship)"
  {
    slug: "thomas-heyward-liberty-ship",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Liberty%20Ship%20-%20Thomas%20Hayward%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://floridapanhandledivetrail.com/Ships/DestinLibertyShip",
      "https://www.destincondorent.com/guest-blog/scuba-diving-in-destin/",
    ],
    briefing: {
      name: "Thomas Heyward Liberty Ship",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.3063,
      forecastLongitude: -86.6037,
      description:
        "A 110 m Liberty Ship built in Mobile in 1942 that carried troops across the Atlantic, then was sunk south of the Okaloosa Island pier in 1977. Decades on the bottom have cracked her amidships and collapsed her north end, but she still rises up to 7 m off the sand and holds some of the biggest fish near Destin.",
      marineLife: "Goliath grouper · barracuda · spadefish · stingrays",
      marineLifeDescription:
        "Summer brings the spadefish and jacks; the goliaths and the rays on the sand stay all year.",
      difficultyLevel: "intermediate",
      depthMinMeters: 21,
      maxDepthMeters: 28,
      currentNote:
        "Mild to moderate current, short ride from East Pass. The wreck is broken and partly collapsed at the north end, so stay outside the structure and watch for fishing line.",
      fitTone: "welcoming",
      fitNote:
        "The most popular wreck off Destin, but the whole dive sits below 20 m. Plan the gas and the no-stop time before you go down.",
      // Advanced Open Water for depth near 30 m: the deck is at about 21 m and the
      // sand at 27 m, so the whole dive sits below an Open Water ceiling.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "atlantic-spadefish",
        "southern-stingray",
        "spotted-eagle-ray",
        "gray-snapper",
      ],
    },
  },
  // Denominator row: "M/V Janet"
  {
    slug: "mv-janet-tug",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20Janet-%20Fish%20Haven%20%236%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://floridapanhandledivetrail.com/Ships/MvJanet",
      "https://reefsmartguides.com/wp-content/uploads/2021/05/Northwest-Florida-sample-guidebook.pdf",
    ],
    briefing: {
      name: "M/V Janet",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.264,
      forecastLongitude: -86.3851,
      description:
        "A 26 m steel tug sunk southeast of Destin East Pass in 1997. She sits upright and remarkably whole, with a two-level superstructure and an intact wheelhouse that the bait schools wrap around.",
      marineLife: "Barracuda · vermilion snapper · gag grouper · goliath grouper",
      marineLifeDescription:
        "Barracuda hang over the wheelhouse, schooling snapper surround the hull, and rays and toadfish sit in the sand off the stern.",
      difficultyLevel: "advanced",
      depthMinMeters: 24,
      maxDepthMeters: 30,
      currentNote:
        "About 10 miles southeast of East Pass, open Gulf, with no mooring buoy, so boats tie into the wreck or anchor nearby. Bottom time is short at this depth; the openings cut in the hull are for divers trained in overhead environments only.",
      divePlan:
        "Down to the main deck, one lap of the hull at deck level, then up to the wheelhouse and the top of the superstructure before heading back to the line.",
      fitTone: "demanding",
      fitNote: "A small wreck that is easy to navigate, but it is a deep one. Nitrox helps.",
      // Advanced Open Water for depth near 30 m: the shallowest point is 24 m and
      // the sand is at 30 m.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The wheelhouse",
          kind: "wreckFeature",
          note: "The top of the wreck at about 24 m, where the barracuda usually wait.",
        },
        {
          name: "Eglin LCM-8",
          kind: "pointOfInterest",
          note: "A landing-craft reef about 170 m to the northwest.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "goliath-grouper",
        "cobia",
        "southern-stingray",
        "lionfish",
        "vermilion-snapper",
      ],
    },
  },
  // Denominator row: "Chepanoc (Starfish Reef)"
  {
    slug: "chepanoc-tug",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Chepanoc%20-%20Starfish%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://floridapanhandledivetrail.com/Ships/Chepanoc",
      "https://www.divedestin.net/deep-water-wrecks",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "Chepanoc",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1472,
      forecastLongitude: -86.6269,
      description:
        "A 39 m utility tug sunk by Okaloosa County in 2005 at the heart of the Starfish Reef complex. She sits upright and intact, and her simple layout makes her an easy deep wreck to find your way around.",
      marineLife: "Goliath grouper · spadefish · vermilion snapper · French angelfish",
      marineLifeDescription:
        "A large resident goliath, schools of spadefish and snapper, and angelfish and butterflyfish along the hull.",
      difficultyLevel: "advanced",
      depthMinMeters: 24,
      maxDepthMeters: 33,
      currentNote:
        "Open Gulf about 15 miles out, so current and the ride decide the day. The wheelhouse and the opening behind it are overhead; stay outside.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Starfish Reef modules",
          kind: "reefFormation",
          note: "Concrete reef pyramids dropped around the tug in 2004, a few hundred meters off.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "atlantic-spadefish",
        "french-angelfish",
        "great-barracuda",
        "variegated-sea-urchin",
        "vermilion-snapper",
      ],
    },
  },
  // Denominator row: "Belize Queen (Bob Reay Reef)"
  {
    slug: "belize-queen-bob-reay-reef",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Bob%20Reay%20Reef-Belize%20Queen%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://floridapanhandledivetrail.com/Ships/BelizeQueen",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "Belize Queen",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1467,
      forecastLongitude: -86.6729,
      description:
        "A 26 m steel tug sunk in 2001 as the Bob Reay Reef, a memorial to a supporter of Okaloosa County's reef program. Her stern has settled deep into the sand, so she looks as if she is still going down.",
      marineLife: "Blue angelfish · rock hind · amberjack · slipper lobster",
      marineLifeDescription:
        "Bait swarms around the pilot house, with angelfish, hinds and lobsters tucked into the hull.",
      difficultyLevel: "advanced",
      depthMinMeters: 23,
      maxDepthMeters: 34,
      currentNote:
        "Open Gulf, a long ride south of Destin. The open back of the wheelhouse is a partly enclosed space; look in, do not go in.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "rock-hind",
        "slipper-lobster",
        "great-barracuda",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "Mohawk Chief"
  {
    slug: "mohawk-chief-tug",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Sand%20Dollar%20Complex%20%237-Mohawk%20Chief%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://floridapanhandledivetrail.com/Ships/MohawkChief",
    ],
    briefing: {
      name: "Mohawk Chief",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1468,
      forecastLongitude: -86.7179,
      description:
        "A 28 m tug sunk in 2003 at the center of the Sand Dollar reef complex, a ring of six concrete reefs around her. She sits upright, was shifted by Hurricane Ivan the year after, and is one of the deepest wrecks on the Panhandle Shipwreck Trail.",
      marineLife: "Amberjack · goliath grouper · bait schools · sand dollars",
      difficultyLevel: "advanced",
      depthMinMeters: 30,
      maxDepthMeters: 38,
      currentNote:
        "Open Gulf, well offshore. The top of the wreck is already at 30 m, so bottom time is short; the pilot house is an overhead space.",
      divePlan:
        "Down the line to the pilot house, one slow lap of the hull, and back to the line with plenty of gas for the stops.",
      fitTone: "demanding",
      fitNote: "Deep from the first fin kick. Nitrox and a conservative plan.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Sand Dollar reef modules",
          kind: "reefFormation",
          note: "Six concrete reef sites set in a hexagon around the tug, each about 240 m away.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "gray-snapper",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "Tugboat Zuess"
  {
    slug: "tugboat-zuess",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Tugboat%20%22Zuess%22%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://floridapanhandledivetrail.com/Ships/TugboatZuess",
    ],
    briefing: {
      name: "Tugboat Zuess",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.157,
      forecastLongitude: -86.7415,
      description:
        "A steel tug sunk by Okaloosa County in 1992, one of the oldest wrecks on the Panhandle Shipwreck Trail. More than thirty years down, she shows what the Gulf does to a hull, and how much life it grows on one.",
      marineLife: "Snapper · grouper · bait schools · encrusting sponges",
      difficultyLevel: "advanced",
      depthMinMeters: 28,
      maxDepthMeters: 33,
      currentNote:
        "Open Gulf, a long ride west and south of East Pass. Low relief, so most of the dive is close to the sand at depth; watch the no-stop time and the fishing line.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["gray-snapper", "goliath-grouper", "lionfish", "great-barracuda"],
    },
  },
  // Denominator row: "Eglin LCM-8 (Eglin Reef #1, Eglin Landing Craft)"
  {
    slug: "eglin-lcm-8",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Eglin%20Reef%20%231%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://reefsmartguides.com/wp-content/uploads/2021/05/Northwest-Florida-sample-guidebook.pdf",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
    ],
    briefing: {
      name: "Eglin LCM-8",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.2653,
      forecastLongitude: -86.386,
      description:
        "A 23 m Navy landing craft from Eglin Air Force Base, sunk as Eglin Reef #1 in 2000. She lies a short swim from the tug Janet, so the two are often dived together.",
      marineLife: "Snapper · grouper · barracuda · stingrays",
      difficultyLevel: "advanced",
      depthMinMeters: 22,
      maxDepthMeters: 30,
      currentNote:
        "About 10 miles southeast of East Pass, in the same water as Janet. Deep enough that bottom time runs out quickly; watch for fishing line.",
      fitTone: "demanding",
      // Advanced Open Water for depth near 30 m: the sand is at about 29 m.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "M/V Janet",
          kind: "pointOfInterest",
          note: "A 26 m tug about 170 m to the southeast.",
        },
      ],
      creatureSlugs: ["gray-snapper", "great-barracuda", "southern-stingray", "lionfish"],
    },
  },
  // Denominator row: "Monica Lee Tugboat"
  {
    slug: "monica-lee-tugboat",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Monica%20Lee%20Tugboat%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://pcdivecenter.com/popular-dive-sites",
      "https://reefsmartguides.com/wp-content/uploads/2021/05/Northwest-Florida-sample-guidebook.pdf",
    ],
    briefing: {
      name: "Monica Lee",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1557,
      forecastLongitude: -86.3704,
      description:
        "A 15 m steel tug sunk in 2011 in the middle of the Conch Reef patch, a spread of limestone reef pyramids set down around her that summer. Small, deep and busy with fish.",
      marineLife: "Snapper · grouper · amberjack · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 30,
      maxDepthMeters: 36,
      currentNote:
        "Open Gulf, a long run southeast of Destin. The top of the wreck is already near 30 m, so bottom time is short.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Conch Reef modules",
          kind: "reefFormation",
          note: "Pairs of limestone reef pyramids set in a grid around the tug in 2011.",
        },
      ],
      creatureSlugs: [
        "gray-snapper",
        "great-barracuda",
        "lionfish",
        "goliath-grouper",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "Mac's Reef"
  {
    slug: "macs-reef-destin",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%20IN%20%28%27Eglin%20AFB%20Material%20FH13%202015%27%2C%27Emerald%20Coast%20Scuba%209%2F11%20Memorial%27%29&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/listing/macs-reef/50639/",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
    ],
    briefing: {
      name: "Mac's Reef",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.3566,
      forecastLongitude: -86.5479,
      description:
        'Old concrete targets from Eglin Air Force Base and a field of concrete culverts, laid down in 2015 a couple of miles southwest of East Pass and named for Charles "Mac" McClenahan, who spent decades at Eglin. A 9/11 memorial made with steel and concrete from the World Trade Center and the Pentagon was added to the northeast corner in 2020.',
      marineLife: "Snapper · grouper · triggerfish · octopus",
      marineLifeDescription:
        "Every gap in the concrete is a hiding place, so look into the culverts as well as over them.",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 23,
      currentNote:
        "Close to the pass, so the ride is short, but tide through East Pass can carry bay water and current out over the site. Spearfishers work this reef; keep clear of them and of fishing line.",
      divePlan:
        "Work the concrete targets on the north side, cross to the culverts on the south half, and finish at the memorial in the northeast corner.",
      fitTone: "welcoming",
      fitNote:
        "Shallower than most Destin boat dives, but the whole site sits below 18 m. A good second dive.",
      landmarks: [
        {
          name: "9/11 memorial",
          kind: "underwaterMonument",
          note: "Steel and concrete from the World Trade Center and the Pentagon, placed on the northeast corner in September 2020.",
        },
        {
          name: "The culverts",
          kind: "reefFormation",
          note: "Concrete culverts covering the southern half of the reef.",
        },
      ],
      creatureSlugs: [
        "gray-snapper",
        "atlantic-common-octopus",
        "atlantic-spadefish",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Denominator row: "Destin Jetties (East Pass Jetty)"
  {
    slug: "destin-east-jetty",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://www.destinfwb.com/listing/destin-jetty/50606",
      "https://reefsmartguides.com/product/destin-east-jetty/",
      "https://www.padi.com/dive-site/united-states-of-america-usa/destin-jetties/",
    ],
    briefing: {
      name: "Destin Jetty",
      locationName: "East Pass, Destin, Florida",
      forecastLatitude: 30.3858,
      forecastLongitude: -86.5061,
      description:
        "The rock jetty on the east side of Destin's East Pass, also called the Finger Jetty, reaching more than 90 m out into the channel. The tumbled boulders are packed with life.",
      marineLife: "Stingrays · grouper · octopus · snapper",
      marineLifeDescription:
        "Fish crowd the rocks, and rays rest on the sand at the foot of the jetty.",
      difficultyLevel: "intermediate",
      depthMinMeters: 9,
      maxDepthMeters: 18,
      currentNote:
        "Dive it only at slack tide: the current through the pass is strong at other times and has carried swimmers off. The clearest water comes in with the high tide. Expect boat traffic in the channel and fishing line on the rocks; the depth at the tip changes as the sand bars move.",
      divePlan:
        "Go in at slack high water, follow the rocks out toward the tip, and turn back along the northern slope before the tide turns.",
      fitTone: "demanding",
      fitNote:
        "Shallow, but the pass decides everything. Timing the tide matters more here than certification.",
      creatureSlugs: [
        "gray-snapper",
        "sergeant-major",
        "southern-stingray",
        "atlantic-common-octopus",
      ],
    },
  },
  // Denominator row: "USAF Big Dawg"
  {
    slug: "usaf-big-dawg",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27USAF%20Big%20Dawg%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.divedestin.net/deep-water-wrecks",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "USAF Big Dawg",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1508,
      forecastLongitude: -86.5737,
      description:
        "A 28 m Air Force boat used to train aircrews in parachute water survival, donated and sunk as a reef in 2021. She settled upright, and extra steel added to her deck gives the fish more to hang on.",
      marineLife: "Snapper · amberjack · grouper · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 32,
      currentNote:
        "Open Gulf, well offshore. Holes were cut in the deck before she was sunk; inside is overhead and for trained divers only.",
      fitTone: "demanding",
      fitNote: "Compact and easy to navigate for a deep wreck.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "gray-snapper",
        "great-barracuda",
        "goliath-grouper",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "R/V Manta"
  {
    slug: "rv-manta",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27R%2FV%20MANTA%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.divedestin.net/deep-water-wrecks",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "R/V Manta",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1438,
      forecastLongitude: -86.6532,
      description:
        "A 55 m research vessel that once laid seismic cable for oil and gas surveys, sunk off Destin in 2023. Long and narrow, she stands tall off the sand, and her superstructure starts within reach of a moderate dive.",
      marineLife: "Amberjack · snapper · barracuda · grouper",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 34,
      currentNote:
        "Open Gulf, a long ride south of East Pass. The upper structure is shallow enough to keep most of the dive above 25 m if you choose to.",
      divePlan:
        "Down the line to the top of the superstructure, along the hull at deck level, and back up the structure before the ascent.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "R/V Dolphin",
          kind: "pointOfInterest",
          note: "Her slightly longer sister ship, sunk the same year southeast of Destin.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "gray-snapper",
        "goliath-grouper",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "M/V Spirit of Norfolk"
  {
    slug: "spirit-of-norfolk",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20Spirit%20of%20Norfolk%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.divedestin.net/deep-water-wrecks",
    ],
    briefing: {
      name: "Spirit of Norfolk",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1324,
      forecastLongitude: -86.6615,
      description:
        "A 57 m harbor dinner-cruise ship, sunk by the Air Force in a weapons exercise off Okaloosa County in 2025. She is one of the biggest and most intact of the deep Destin wrecks, standing about 15 m off the sand.",
      marineLife: "Amberjack · snapper · barracuda · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 23,
      maxDepthMeters: 39,
      currentNote:
        "Open Gulf, a long ride offshore. A new wreck sunk by a weapons test, so expect torn steel; stay outside the structure.",
      fitTone: "demanding",
      fitNote: "Big and deep. Plan to see one part of her well rather than all of her quickly.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "great-barracuda",
        "gray-snapper",
        "goliath-grouper",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "M/V Courageous"
  {
    slug: "mv-courageous",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20Courageous%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.divedestin.net/deep-water-wrecks",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "M/V Courageous",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1115,
      forecastLongitude: -86.555,
      description:
        "A 58 m cargo ship built in Sweden in 1956 and seized for smuggling in 1985, sunk by an Air Force weapons demonstration in 2022. The blast broke her in two, and the bow and stern now lie side by side on the sand.",
      marineLife: "Amberjack · snapper · grouper · bait schools",
      marineLifeDescription:
        "Fish gather around both halves, and the twisted steel at the break holds the most.",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 40,
      currentNote:
        "Open Gulf, a long ride offshore. The torn hull at the break is a real entanglement hazard; stay outside the structure and away from the jagged steel.",
      divePlan:
        "Pick one half for the dive, work it from the top down, and leave the sand at 40 m alone.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The break",
          kind: "wreckFeature",
          note: "Where the explosion split the ship. The bow turned around as it sank, so the two halves lie side by side.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "gray-snapper",
        "goliath-grouper",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "M/V Deep Stim III"
  {
    slug: "deep-stim-iii",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27DEEP%20STIM%20III%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "Deep Stim III",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.0506,
      forecastLongitude: -86.296,
      description:
        "A 72 m oil and gas exploration ship from the 1990s, sunk in 2024 by Okaloosa and Walton counties and Panama City Beach together. She sits upright with her open back deck filled with concrete reef modules, and her wheelhouse rises about 20 m off the sand.",
      marineLife: "Amberjack · snapper · grouper · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 40,
      currentNote:
        "Open Gulf, about 23 nautical miles southeast of East Pass. The sand lies at about 41 m, deeper than a recreational dive goes; the engine holds are overhead and for trained divers only.",
      divePlan:
        "Down the line to the wheelhouse, along the back deck and its reef modules, and back up to the wheelhouse before the ascent.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The back deck reef",
          kind: "reefFormation",
          note: "Concrete reef pyramids and modules bolted across the open working deck before she was sunk.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "gray-snapper",
        "goliath-grouper",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "M/V Nekton Pilot (Ted Forsgren)"
  {
    slug: "nekton-pilot",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20NEKTON%20PILOT%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://pcdivecenter.com/popular-dive-sites",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
    ],
    briefing: {
      name: "Nekton Pilot",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.074,
      forecastLongitude: -86.3081,
      description:
        "A 23 m steel catamaran with an aluminum superstructure, sunk in 2025 as one of the two Ted Forsgren reefs southeast of Destin. Her sister, the Nekton Rorqual, lies about 2 km to the west.",
      marineLife: "Amberjack · snapper · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 27,
      maxDepthMeters: 40,
      currentNote:
        "Open Gulf, a long ride offshore. The top of the wreck is already below 27 m and the sand is at about 40 m, so the dive is short and deep. A new wreck; expect little growth yet.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "gray-snapper", "lionfish", "greater-amberjack"],
    },
  },
  // Denominator row: "M/V Nekton Rorqual (Ted Forsgren)"
  {
    slug: "nekton-rorqual",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20NEKTON%20RORQUAL%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://pcdivecenter.com/popular-dive-sites",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
    ],
    briefing: {
      name: "Nekton Rorqual",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.0718,
      forecastLongitude: -86.3307,
      description:
        "A 24 m steel catamaran with an aluminum superstructure, sunk in 2025 as one of the two Ted Forsgren reefs southeast of Destin. Her sister, the Nekton Pilot, lies about 2 km to the east.",
      marineLife: "Amberjack · snapper · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 28,
      maxDepthMeters: 40,
      currentNote:
        "Open Gulf, a long ride offshore. The top of the wreck is below 28 m and the sand lies at about 40 m, right at the recreational limit, so the dive is short and deep. A new wreck; expect little growth yet.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "gray-snapper", "lionfish", "greater-amberjack"],
    },
  },
  // Denominator row: "R/V Dolphin"
  {
    slug: "rv-dolphin",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27R%2FV%20DOLPHIN%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "R/V Dolphin",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1272,
      forecastLongitude: -86.4022,
      description:
        "A 58 m seismic research ship from the oil and gas fields, sunk by Okaloosa County in 2023, about 16 nautical miles southeast of East Pass. She stands nearly 15 m off the sand, a little longer than her sister ship Manta.",
      marineLife: "Goliath grouper · vermilion snapper · amberjack",
      difficultyLevel: "advanced",
      depthMinMeters: 22,
      maxDepthMeters: 37,
      currentNote:
        "Open Gulf, a long ride offshore. The covered main deck, wheelhouse and stern are overhead environments; stay outside.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "gray-snapper",
        "lionfish",
        "vermilion-snapper",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "M/V Brannon"
  {
    slug: "mv-brannon",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20Brannon%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "M/V Brannon",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.127,
      forecastLongitude: -86.3919,
      description:
        "A 20 m experimental military fast-response catamaran sunk in 2021 at the Boat Yard, a few meters from the sailboat Dylan and 23 m from the tug Miss Joann. Her aft superstructure has collapsed onto the sand, but she still stands about 4 m tall.",
      marineLife: "Red snapper · sea urchins · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 32,
      maxDepthMeters: 36,
      currentNote:
        "Open Gulf, a long ride offshore. Low relief means the whole dive is close to 36 m; watch the no-stop time and the collapsed steel.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "S/V Dylan",
          kind: "pointOfInterest",
          note: "A steel sailboat lying on her side a few meters away.",
        },
        {
          name: "M/V Miss Joann",
          kind: "pointOfInterest",
          note: "A tug with a mermaid statue on her deck, about 23 m away.",
        },
      ],
      creatureSlugs: ["gray-snapper", "variegated-sea-urchin", "lionfish"],
    },
  },
  // Denominator row: "S/V Dylan"
  {
    slug: "sv-dylan",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27S%2FV%20DYLAN%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "S/V Dylan",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1269,
      forecastLongitude: -86.3912,
      description:
        "A 19 m steel sailboat seized by U.S. Customs and sunk in 2020 as the first wreck of the Boat Yard. She lies on her starboard side with two steel chicken-transport cages welded to her deck, next to the catamaran Brannon and the tug Miss Joann.",
      marineLife: "Snapper · grouper · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 33,
      maxDepthMeters: 36,
      currentNote:
        "Open Gulf, a long ride offshore. She lies low on the sand, so the dive is spent near 36 m; most divers visit her as part of a Boat Yard dive.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "M/V Brannon",
          kind: "pointOfInterest",
          note: "A military catamaran a few meters away.",
        },
        {
          name: "M/V Miss Joann",
          kind: "pointOfInterest",
          note: "A tug about 23 m away, the tallest wreck at the Boat Yard.",
        },
      ],
      creatureSlugs: ["gray-snapper", "lionfish", "great-barracuda"],
    },
  },
  // Denominator row: "M/V Miss Joann"
  {
    slug: "mv-miss-joann",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20Miss%20Joann%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "M/V Miss Joann",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1269,
      forecastLongitude: -86.3915,
      description:
        "A 20 m steel tug sunk in 2022 as the third and last wreck of the Boat Yard, with a concrete mermaid statue by artist Meg Powell on her forward deck. She stands about 9 m tall, the highest point of the site.",
      marineLife: "Snapper · amberjack · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 26,
      maxDepthMeters: 36,
      currentNote:
        "Open Gulf, a long ride offshore. Her wheelhouse and interior are overhead; stay outside.",
      divePlan:
        "Down the line to the wheelhouse and the mermaid, then, with gas and no-stop time to spare, across the sand to the Brannon and the Dylan.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The mermaid",
          kind: "underwaterMonument",
          note: "A concrete statue on the forward deck.",
        },
        {
          name: "S/V Dylan and M/V Brannon",
          kind: "pointOfInterest",
          note: "The other two Boat Yard wrecks, about 23 m away.",
        },
      ],
      creatureSlugs: ["gray-snapper", "great-barracuda", "lionfish", "greater-amberjack"],
    },
  },
  // Denominator row: "M/V Fantasea (Alex and Anna Jernigan Fantasea Reef)"
  {
    slug: "mv-fantasea",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20FANTASEA%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "Fantasea",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.2398,
      forecastLongitude: -86.5049,
      description:
        "A 44 m former casino boat sunk in 2025 as the Alex and Anna Jernigan Fantasea Reef. She is tall for her length, so a lot of the wreck sits in moderate depths.",
      marineLife: "Snapper · amberjack · bait schools",
      difficultyLevel: "intermediate",
      depthMinMeters: 16,
      maxDepthMeters: 27,
      // Below 30 m, but the sand is at 27 m, past an Open Water diver's depth, as on the Dupont spans.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "A short ride south of East Pass, open Gulf. A young wreck with little growth yet; the sand is at 27 m, so keep an eye on depth if you drop down the hull.",
      fitTone: "welcoming",
      fitNote: "The upper decks start at 16 m, and the sand at 27 m makes her an Advanced dive.",
      creatureSlugs: [
        "gray-snapper",
        "great-barracuda",
        "atlantic-spadefish",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "M/V Skippin Sue"
  {
    slug: "mv-skippin-sue",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20SKIPPIN%20SUE%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "Skippin Sue",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.2442,
      forecastLongitude: -86.5039,
      description:
        "A 36 m offshore supply boat sunk in 2025, lying on her port side a short ride south of East Pass. A good first wreck at Destin.",
      marineLife: "Snapper · amberjack · bait schools",
      difficultyLevel: "beginner",
      depthMinMeters: 16,
      maxDepthMeters: 24,
      currentNote:
        "Short ride from East Pass, open Gulf. She lies on her side, so doorways and hatches face sideways or down; stay outside the hull.",
      fitTone: "welcoming",
      creatureSlugs: ["gray-snapper", "atlantic-spadefish", "lionfish", "greater-amberjack"],
    },
  },
  // Denominator row: "RMS Atlantis"
  {
    slug: "rms-atlantis",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27RMS%20ATLANTIS%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "RMS Atlantis",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.2422,
      forecastLongitude: -86.5101,
      description:
        "A 38 m offshore supply vessel built in 1979, sunk upright off Destin in 2023. The top of her wheelhouse is within easy reach, so newer divers get a proper Gulf wreck without going deep.",
      marineLife: "Snapper · amberjack · spadefish · bait schools",
      difficultyLevel: "intermediate",
      depthMinMeters: 16,
      maxDepthMeters: 25,
      currentNote:
        "A short ride south of East Pass, open Gulf. Current and visibility vary by the day; watch for fishing line on the rails.",
      fitTone: "welcoming",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "great-barracuda",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "RMS Cyclops"
  {
    slug: "rms-cyclops",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27RMS%20CYCLOPS%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "RMS Cyclops",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.3471,
      forecastLongitude: -86.4373,
      description:
        "A 32 m oilfield supply boat sunk by Okaloosa County in 2023, about 4 nautical miles east-southeast of East Pass. Air trapped in her hull rolled her over on the way down, and she now rests upside down on her wheelhouse.",
      marineLife: "Goliath grouper · snapper · jacks",
      marineLifeDescription: "A goliath grouper often waits behind the wheelhouse.",
      difficultyLevel: "beginner",
      depthMinMeters: 14,
      maxDepthMeters: 22,
      currentNote:
        "Close to the pass and shallow, but upside down: the spaces under the hull are overhead, so stay outside.",
      fitTone: "welcoming",
      creatureSlugs: ["goliath-grouper", "gray-snapper", "atlantic-spadefish", "lionfish"],
    },
  },
  // Denominator row: "Sea Barb Paddlewheel (Okaloosa Reef Odyssey)"
  {
    slug: "sea-barb-paddlewheel",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Okaloosa%20Reef%20Odyssey%20%28Sea%20Barb%29%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.destinfwb.com/explore/eco-tourism/artificial-reefs/3d-models/",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "Sea Barb Paddlewheel",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1488,
      forecastLongitude: -86.6768,
      description:
        "A 26 m steel paddlewheel boat, said to have once worked the Mississippi, sunk in 2002 as the Okaloosa Reef Odyssey. She lies about 450 m from the tug Belize Queen.",
      marineLife: "Snapper · grouper · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 31,
      maxDepthMeters: 34,
      currentNote:
        "Open Gulf, a long ride offshore. Low on the sand, so the dive is spent past 30 m.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["gray-snapper", "lionfish", "great-barracuda"],
    },
  },
  // Denominator row: "AJ's Blackbeard (Flying Eagle)"
  {
    slug: "ajs-blackbeard-flying-eagle",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27AJs%20Blackbeard%20-%20Flying%20Eagle%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "AJ's Blackbeard",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.139,
      forecastLongitude: -86.565,
      description:
        "A 22 m steel sailboat, the Flying Eagle, sunk off Destin in 2023 as AJ's Blackbeard. She stands about 13 m off the sand, and a second sunken steel sailboat, the Cordonazo, lies about 30 m away.",
      marineLife: "Amberjack · snapper · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 35,
      currentNote:
        "Open Gulf, a long ride offshore. A young wreck; watch for fishing line on the rigging.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "gray-snapper", "lionfish", "greater-amberjack"],
    },
  },
  // Denominator row: "M/V Deborah"
  {
    slug: "mv-deborah",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20Deborah%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "M/V Deborah",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1252,
      forecastLongitude: -86.5899,
      description:
        "A 41 m tug sunk off Okaloosa County in 1999 on a deep stretch of sand south of Destin.",
      marineLife: "Amberjack · snapper · grouper",
      difficultyLevel: "advanced",
      depthMinMeters: 37,
      maxDepthMeters: 40,
      currentNote:
        "Open Gulf, a long ride offshore. Sources put the sand at 39–41 m, at or past the recreational limit, and the top of the wreck is at about 37 m: turn at 40 m, not the sand. Bottom time is very short.",
      fitTone: "demanding",
      fitNote: "Only for divers comfortable right at 40 m.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["gray-snapper", "great-barracuda", "lionfish", "greater-amberjack"],
    },
  },
  // Denominator row: "M/V Monarch Countess"
  {
    slug: "mv-monarch-countess",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27M%2FV%20Monarch%20Countess%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "Monarch Countess",
      locationName: "off Destin, Florida",
      forecastLatitude: 30.1058,
      forecastLongitude: -86.7584,
      description:
        "A 110 m roll-on roll-off ship sunk by the Air Force in a weapons exercise off Okaloosa County in 2024. She rises about 30 m off the bottom, so her upper structure is diveable even though the sand is far below.",
      marineLife: "Amberjack · snapper · barracuda · bait schools",
      difficultyLevel: "advanced",
      depthMinMeters: 24,
      maxDepthMeters: 40,
      currentNote:
        "Open Gulf, far offshore. The sand lies at about 55 m, well beyond recreational limits; stay on the upper structure and on the line. A weapons-test wreck, so expect torn steel.",
      divePlan:
        "Down the line to the top of the superstructure, stay on the upper decks, and back to the line on gas. The hull and sand below 40 m are not the dive.",
      fitTone: "demanding",
      fitNote:
        "A big ship with nothing below her but deep water. Depth discipline is the whole dive.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["great-barracuda", "gray-snapper", "cobia", "lionfish", "greater-amberjack"],
    },
  },
  // Denominator row: "Joseph E. Brown Liberty Ship (J. Brown Liberty Ship)"
  {
    slug: "joseph-e-brown-liberty-ship",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27J.%20Brown-Liberty%20Ship%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "Joseph E. Brown Liberty Ship",
      locationName: "off Navarre, Florida",
      forecastLatitude: 30.213,
      forecastLongitude: -86.8058,
      description:
        "A 134 m World War II Liberty Ship sunk as a reef off Santa Rosa County around 1980. She stands about 5 m off the sand, a long, low wreck with plenty of hull to follow.",
      marineLife: "Snapper · grouper · amberjack · barracuda",
      difficultyLevel: "advanced",
      depthMinMeters: 25,
      maxDepthMeters: 30,
      currentNote:
        "Open Gulf, a long ride from either Destin or Pensacola. Sources put the sand at 28–30 m; stay outside the structure.",
      fitTone: "demanding",
      // Advanced Open Water for depth near 30 m: the top of the wreck is at 25 m
      // and the sand at up to 30 m.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "gray-snapper",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Denominator row: "Underwater Museum of Art (UMA, Grayton Beach)"
  {
    slug: "underwater-museum-of-art-grayton",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Description%20LIKE%20%27%25Art%20Sculptures%25%27%20OR%20Name%20LIKE%20%27%25UMA%25%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://umafl.org/",
      "https://www.divedestin.net/underwater-museum-of-arts",
    ],
    briefing: {
      name: "Underwater Museum of Art",
      locationName: "off Grayton Beach, Florida",
      forecastLatitude: 30.3125,
      forecastLongitude: -86.1593,
      description:
        "The first permanent underwater sculpture garden in the United States, about 1.5 km off Grayton Beach State Park. New juried sculptures have gone down every year or two since 2018, and sponges and coral are slowly turning each piece into reef.",
      marineLife: "Snapper · spadefish · small reef fish",
      marineLifeDescription:
        "Every sculpture is its own small reef, and the fish move between them.",
      difficultyLevel: "intermediate",
      depthMinMeters: 13,
      maxDepthMeters: 18,
      currentNote:
        "Usually a calm, shallow Gulf site, but more than fifty sculptures spread over open sand make navigation the real challenge; go with a guide or a compass plan. From Destin it is an hour or more each way by boat.",
      divePlan:
        "Descend on the line, take a heading, and move sculpture to sculpture, turning back with enough gas to find the line again.",
      fitTone: "welcoming",
      fitNote: "Shallow and gentle, with a navigation puzzle built in.",
      creatureSlugs: ["gray-snapper", "sergeant-major", "atlantic-spadefish", "lionfish"],
    },
  },
  // Black Bart
  {
    slug: "black-bart-wreck",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/BlackBart",
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27The%20Black%20Bart%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_96/",
    ],
    briefing: {
      name: "Black Bart",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0606,
      forecastLongitude: -85.8232,
      description:
        "A 56 m oilfield supply ship sunk in 1993 and named for Captain Charles Bartholomew, the Navy's supervisor of salvage. She sits upright about 6.5 nautical miles from St. Andrew Bay Pass, and her upright hull and open holds make her the town's favorite training wreck.",
      marineLife: "Spadefish · snapper · grouper · flounder · turtles (sometimes)",
      difficultyLevel: "intermediate",
      depthMinMeters: 15,
      maxDepthMeters: 26,
      currentNote:
        "The bottom is silty and visibility near the deck often runs 6–8 m, worse after rain or a blow. Hurricane Michael opened up the wheelhouse in 2018, so expect loose and changed structure.",
      divePlan:
        "Down the line to the bow, along the main deck at about 20 m, a look into the open holds from above, and back up the line. Bring a light.",
      fitTone: "welcoming",
      fitNote:
        "Upright, intact and close to the pass. A good first wreck for a diver comfortable at 20 m and in murky water.",
      landmarks: [
        {
          name: "The bow",
          kind: "wreckFeature",
          note: "The high point of the hull itself, at about 18 m, and the usual place to start.",
        },
        {
          name: "The cargo holds",
          kind: "wreckFeature",
          note: "Open from above, down toward the sand at about 24 m. Look in with a light; going inside is a penetration dive.",
        },
      ],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "lionfish",
        "sergeant-major",
        "loggerhead-turtle",
      ],
    },
  },
  // USS Strength
  {
    slug: "uss-strength",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/Strength",
      "https://reefsmartguides.com/wp-content/uploads/2021/05/Northwest-Florida-sample-guidebook.pdf",
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27USS%20Strength%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "USS Strength",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0324,
      forecastLongitude: -85.7085,
      description:
        "A 56 m Second World War minesweeper that cleared mines ahead of the Iwo Jima and Okinawa landings, then served Navy salvage divers as a training hulk. Sunk for good in 1987, she was rolled upright by Hurricane Opal in 1995, and her bow has since broken away from the rest of the ship.",
      marineLife: "Spadefish · jacks · snapper · gag grouper · bait balls",
      marineLifeDescription:
        "Bait balls over the wreck can be thick enough to hide it, with jacks and snapper working them.",
      difficultyLevel: "intermediate",
      depthMinMeters: 16,
      maxDepthMeters: 23,
      currentNote:
        "No mooring buoys: boats tie in to the bow or anchor in the sand. Fine sediment can drop the visibility to almost nothing near the bottom, and hanging wires around the collapsed superstructure are an entanglement risk.",
      divePlan:
        "Drop onto the detached bow and circle it, cross the debris between the two sections, then circle the stern and finish on the main deck.",
      fitTone: "welcoming",
      fitNote:
        "Shallow and open enough for most divers, with time to see the whole wreck on one tank.",
      landmarks: [
        {
          name: "The detached bow",
          kind: "wreckFeature",
          note: "Lying apart from the main hull on its port side. Boats often tie in here.",
        },
        {
          name: "The gap between the sections",
          kind: "wreckFeature",
          note: "Sheltered, debris-filled ground between bow and stern where the reef fish hide.",
        },
      ],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "horse-eye-jack",
        "lionfish",
        "sergeant-major",
      ],
    },
  },
  // USS Chippewa
  {
    slug: "uss-chippewa",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/Chippewa",
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Chippewa%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.visitpanamacitybeach.com/things-to-do/diving/",
    ],
    briefing: {
      name: "USS Chippewa",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 29.9613,
      forecastLongitude: -85.8077,
      description:
        "A 62 m Navy fleet tug launched in 1942 that towed and salvaged from the Caribbean to Newfoundland. She was sunk in 1990 as a training platform for the Navy's dive unit in Panama City and now sits upright on the sand, one of the bigger wrecks on the offshore run.",
      marineLife: "Amberjack · snapper · spadefish · grouper",
      difficultyLevel: "advanced",
      depthMinMeters: 17,
      maxDepthMeters: 31,
      currentNote:
        "Open Gulf, about 12 nautical miles from the pass. Current and a summer thermocline vary by the day, and the sand is past 30 m.",
      fitTone: "demanding",
      fitNote: "A deep dive on an offshore run. Plan the turn on the deck, not the sand.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "great-barracuda",
        "lionfish",
        "cobia",
        "greater-amberjack",
      ],
    },
  },
  // USS Accokeek
  {
    slug: "uss-accokeek",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/Accokeek",
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Accokeek%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_163/",
    ],
    briefing: {
      name: "USS Accokeek",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 29.9746,
      forecastLongitude: -85.8652,
      description:
        "A 44 m fleet tug built in 1944 that towed damaged ships away from Okinawa and worked the world's oceans for 26 years. The Navy dive school in Panama City sank and raised her over and over for training before she went down for the last time in 2000.",
      marineLife: "Amberjack · snapper · spadefish · grouper",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 31,
      currentNote:
        "Open Gulf, about 12 nautical miles out. Current, visibility and a summer thermocline change by the day, and the sand sits at about 30 m.",
      fitTone: "demanding",
      fitNote: "A deep offshore wreck. Most of the dive happens on the hull, well above the sand.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "great-barracuda",
        "lionfish",
        "cobia",
        "greater-amberjack",
      ],
    },
  },
  // FAMI Tugs (Twin Tugs)
  {
    slug: "fami-tugs",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/FamiTugs",
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%20LIKE%20%27Fami%20Tug%25%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_144/",
    ],
    briefing: {
      name: "FAMI Tugs",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 29.9687,
      forecastLongitude: -85.8544,
      description:
        "Two derelict harbor tugs, 26 and 29 m long, sunk in 2003 bow to bow on a tether. A storm later lifted one and set it down on top of the other, so the dive is two wrecks stacked in one pile.",
      marineLife: "Amberjack · snapper · spadefish · grouper",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 31,
      currentNote:
        "Open Gulf, about 11 nautical miles from the pass. Current and visibility vary by the day, and the sand is at about 30 m.",
      fitTone: "demanding",
      fitNote:
        "Compact and deep. Easy to see in one dive, so there is no reason to linger at the sand.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The stacked hulls",
          kind: "wreckFeature",
          note: "One tug resting on the other, the result of a storm after the 2003 sinking.",
        },
      ],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "great-barracuda",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // El Dorado
  {
    slug: "el-dorado-wreck",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/ElDorado",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27El%20Dorado%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.visitpanamacitybeach.com/things-to-do/diving/",
    ],
    briefing: {
      name: "El Dorado",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 29.9761,
      forecastLongitude: -85.8415,
      description:
        "An aluminum passenger vessel that Hurricane Ivan drove ashore in Panama City in 2004 and Hurricane Michael tore loose again in 2018. Her owner gave her to the reef program, and she was sunk in May 2019 about 12 nautical miles south of the pass, standing tall off the sand.",
      marineLife: "Amberjack · snapper · spadefish · grouper",
      difficultyLevel: "advanced",
      depthMinMeters: 19,
      maxDepthMeters: 32,
      currentNote:
        "Open Gulf. Current, visibility and a summer thermocline change by the day, and the sand is past 30 m.",
      fitTone: "demanding",
      fitNote:
        "A deep offshore wreck with plenty of height, so most of the dive can stay well above the sand.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "great-barracuda",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // SS Tarpon
  {
    slug: "ss-tarpon",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://museumsinthesea.fpan.us/preserves/ss-tarpon",
      "https://www.nps.gov/articles/sstarpon.htm",
      "https://pcdivecenter.com/popular-dive-sites",
    ],
    briefing: {
      name: "SS Tarpon",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.095,
      forecastLongitude: -85.9426,
      description:
        "A 49 m coastal steamer that ran freight and passengers between Mobile and Carrabelle for more than 30 years under one captain, until she foundered in a gale in September 1937. She lies 7.8 nautical miles offshore and is a State Underwater Archaeological Preserve.",
      marineLife: "Spadefish · jacks · cubbyu · angelfish",
      marineLifeDescription:
        "One of Bay County's oldest reefs, and it shows in how much lives on it.",
      conservationNote:
        "A protected preserve and the grave of the people lost with her. Use the submerged mooring buoys, and take nothing.",
      difficultyLevel: "advanced",
      depthMinMeters: 27,
      maxDepthMeters: 30,
      currentNote:
        "Open Gulf at close to 30 m. Visibility varies widely and drops after heavy rain.",
      fitTone: "demanding",
      fitNote: "The state preserve itself calls this an advanced dive because of its depth.",
      // Advanced Open Water below 30 m: the preserve's own guidance rates it an
      // advanced dive for its depth, which sits at 29–30 m on the sand.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "The mooring buoys",
          kind: "navigationMark",
          note: "Four submerged buoys around the wreck, placed so nobody has to anchor on it.",
        },
      ],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "horse-eye-jack",
        "gray-angelfish",
        "lionfish",
      ],
    },
  },
  // SS Empire Mica
  {
    slug: "empire-mica",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/EmpireMica",
      "https://assets.simpleviewinc.com/sv-panamacitybeach/image/upload/v1/clients/panamacitybeach/Empire_Mica_Flyer_1b99add0-12d0-460a-bc33-444b132b84dc.pdf",
    ],
    briefing: {
      name: "Empire Mica",
      locationName: "off Cape San Blas, Florida",
      forecastLatitude: 29.3114,
      forecastLongitude: -85.3538,
      description:
        "A 142 m British tanker carrying fuel for the Allies, torpedoed by a German U-boat on 29 June 1942 about 21 miles south of Cape San Blas. The Coast Guard later blasted the stern and bridge to clear the shipping lane, so what remains is a broad field of bow, boilers, shaft and hull plating.",
      marineLife: "Snapper · grouper · barracuda · bait fish",
      conservationNote:
        "Thirty-three of her crew died in the attack. A historic wreck and a grave: look, and leave everything.",
      difficultyLevel: "advanced",
      depthMinMeters: 33,
      maxDepthMeters: 35,
      currentNote:
        "A long open-Gulf run with nothing near it. Current and a strong summer thermocline are both common, and the low, scattered wreck gives little to hide behind.",
      fitTone: "demanding",
      fitNote:
        "Deep, remote and spread out. A dive for a diver who plans gas and turn time carefully.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["gray-snapper", "great-barracuda", "atlantic-spadefish", "lionfish", "cobia"],
    },
  },
  // Red Sea Tugboat
  {
    slug: "red-sea-tug",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Red%20Sea%20Tugboat%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_32/",
      "https://reefsmartguides.com/wp-content/uploads/2021/05/Northwest-Florida-sample-guidebook.pdf",
    ],
    briefing: {
      name: "Red Sea Tug",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.016,
      forecastLongitude: -85.7,
      description:
        "A 38 m steel ocean tug sunk in June 2009, about 6.6 nautical miles from St. Andrew Bay Pass and not far from the Strength. She stands tall for her depth, rising about 11 m off the sand.",
      marineLife: "Spadefish · snapper · barracuda · grouper",
      difficultyLevel: "intermediate",
      depthMinMeters: 12,
      maxDepthMeters: 23,
      currentNote:
        "Nearshore Gulf water: visibility swings with rain and wind, and is often poorer near the sand than up on the hull.",
      creatureSlugs: ["atlantic-spadefish", "gray-snapper", "great-barracuda", "lionfish"],
    },
  },
  // Jeff-A Hovercraft (Hovercraft LLCAT)
  {
    slug: "jeff-a-hovercraft",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Hovercraft-Llcat%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_78/",
    ],
    briefing: {
      name: "Jeff-A Hovercraft",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0708,
      forecastLongitude: -85.8121,
      description:
        "A 30 m prototype Navy amphibious assault hovercraft, sunk as a reef in 1995. An unusual shape to find on the bottom, and a short ride from the pass.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "intermediate",
      depthMinMeters: 20,
      maxDepthMeters: 23,
      currentNote:
        "Low relief on sand and rubble, so visibility near the bottom decides the dive. Watch for fishing line, as on every public reef here.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Chickasaw Tug
  {
    slug: "chickasaw-tug",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Chickasaw%20Tug%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Chickasaw Tug",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0821,
      forecastLongitude: -85.7794,
      description:
        "A 33 m tugboat that has been on the bottom since about 1970, one of the oldest wrecks off Panama City. Decades have flattened her to a low pile of steel close to the pass.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "intermediate",
      depthMinMeters: 19,
      maxDepthMeters: 21,
      currentNote:
        "Little relief left, so the dive happens close to the sand where visibility is at its worst. Boat traffic from the pass and fishing line are the usual hazards.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // B.J. Putnam
  {
    slug: "bj-putnam",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27BJ%20Putnam%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_95/",
    ],
    briefing: {
      name: "B.J. Putnam",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 29.9302,
      forecastLongitude: -85.8349,
      description:
        "An oilfield supply boat, about 55 m long, that was converted into a fish processor and later renamed for a local charter captain. She was sunk in November 1993 on the offshore run, about 13 nautical miles from the pass.",
      marineLife: "Amberjack · snapper · spadefish · grouper",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 33,
      currentNote:
        "Open Gulf with the sand past 30 m. Current and a summer thermocline vary by the day.",
      fitTone: "demanding",
      fitNote: "A deep offshore wreck. Plan the dive on the hull and leave the sand alone.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "great-barracuda",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Grey Ghost
  {
    slug: "grey-ghost-tug",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Grey%20Ghost%20Ship%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Grey Ghost",
      locationName: "off western Panama City Beach, Florida",
      forecastLatitude: 30.0471,
      forecastLongitude: -86.0926,
      description:
        "A 32 m Navy tug sunk in 1978, with loads of tires and later debris around her. One of the oldest wrecks in Bay County, reached on a long run west of the pass.",
      marineLife: "Amberjack · snapper · grouper · spadefish",
      difficultyLevel: "advanced",
      depthMinMeters: 26,
      maxDepthMeters: 33,
      currentNote:
        "Open Gulf, well offshore, with the sand past 30 m. Current, visibility and a summer thermocline vary by the day.",
      fitTone: "demanding",
      fitNote: "Deep from the first breath: the top of the wreck is already at about 26 m.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "great-barracuda",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // B&B Barge (B & B Reef)
  {
    slug: "b-and-b-reef",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27B%20%26%20B%20Reef%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_107/",
    ],
    briefing: {
      name: "B&B Reef",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0821,
      forecastLongitude: -85.7146,
      description:
        "A steel barge sunk in 1990 together with bridge spans. One of the shallowest dives on the Panama City list, about 2.5 nautical miles from the pass.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 14,
      currentNote:
        "Close to St. Andrew Bay Pass, so watch for boat traffic on the way down and up. Nearshore visibility swings with rain and wind, and fishing line is common on the public reefs.",
      fitTone: "welcoming",
      fitNote: "Shallow and short to reach: a good checkout or second dive.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // PCMI Barge
  {
    slug: "pcmi-barge",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27PCMI%20Barge%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "PCMI Barge",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.1138,
      forecastLongitude: -85.8255,
      description:
        "A steel barge and scrap steel placed around 1980, with bundled tires laid around it the following year. A low, nearshore reef that has had more than 40 years to grow over.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 23,
      currentNote:
        "Low relief, so visibility near the sand decides the dive. Fishing line is common on the public reefs.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Dan Barge
  {
    slug: "dan-barge",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Dan%20Barge%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Dan Barge",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0806,
      forecastLongitude: -85.7307,
      description:
        "A 30 m barge sunk in 2000 a short run from St. Andrew Bay Pass. Low and compact, an easy site to cover on one tank.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "beginner",
      depthMinMeters: 15,
      maxDepthMeters: 18,
      currentNote:
        "Close to St. Andrew Bay Pass, so watch for boat traffic on the way down and up. Nearshore visibility swings with rain and wind, and fishing line is common on the public reefs.",
      fitTone: "welcoming",
      fitNote: "Shallow and compact, close to the pass.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Century Barge (Century/Cobia Barge)
  {
    slug: "century-barge",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Century%2FCobia%20Barge%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_172/",
    ],
    briefing: {
      name: "Century Barge",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 29.9736,
      forecastLongitude: -85.8265,
      description:
        "A 32 m steel barge sunk in 1999 on the offshore run, also called the Cobia Barge. It stands only a few meters off the sand.",
      marineLife: "Amberjack · snapper · grouper · cobia (seasonal)",
      difficultyLevel: "advanced",
      depthMinMeters: 28,
      maxDepthMeters: 31,
      currentNote:
        "Open Gulf, about 11 nautical miles from the pass, with the sand at about 30 m. Current, visibility and a summer thermocline vary by the day.",
      fitTone: "demanding",
      fitNote: "Low structure at full depth: the whole dive happens close to 30 m.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "cobia",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Navy Barge (Panama City)
  {
    slug: "navy-barge-panama-city",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27BA0102%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_94/",
    ],
    briefing: {
      name: "Navy Barge",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0833,
      forecastLongitude: -85.7323,
      description:
        "A steel barge donated by the Navy and sunk in 1994, about 2 nautical miles south of St. Andrew Bay Pass. A short, shallow dive among a cluster of nearshore reefs.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "beginner",
      depthMinMeters: 14,
      maxDepthMeters: 17,
      currentNote:
        "Close to St. Andrew Bay Pass, so watch for boat traffic on the way down and up. Nearshore visibility swings with rain and wind, and fishing line is common on the public reefs.",
      fitTone: "welcoming",
      fitNote: "Shallow and close in: an easy first Gulf dive.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Loss Pontoon
  {
    slug: "loss-pontoon",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Loss%20Pontoon%20Site%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_113/",
    ],
    briefing: {
      name: "Loss Pontoon",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0828,
      forecastLongitude: -85.7353,
      description:
        "One of the first reef sites off Panama City: a steel tank, tires and concrete rubble from 1978, with scrap, more rubble and slabs of the old Hathaway Bridge added through the 1980s. A sprawling, low site close to the pass.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "intermediate",
      depthMinMeters: 14,
      maxDepthMeters: 20,
      currentNote:
        "Close to St. Andrew Bay Pass, so watch for boat traffic on the way down and up. Nearshore visibility swings with rain and wind, and fishing line is common on the public reefs.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Wet & Wild Spot (Wet and Wild Site)
  {
    slug: "wet-and-wild-reef",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Wet%20And%20Wild%20Site%20-%20331%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_104/",
    ],
    briefing: {
      name: "Wet & Wild",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0895,
      forecastLongitude: -85.7367,
      description:
        "Concrete deck sections from an old US 331 bridge, dropped in 1991 less than 2 nautical miles from the pass. Shallow slabs and rubble that make an easy nearshore dive.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 15,
      currentNote:
        "Close to St. Andrew Bay Pass, so watch for boat traffic on the way down and up. Nearshore visibility swings with rain and wind, and fishing line is common on the public reefs.",
      fitTone: "welcoming",
      fitNote: "Shallow, flat and close to the pass.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // DuPont Bridge Span #1
  {
    slug: "dupont-bridge-span-1",
    version: 2,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Dupont%20Bridge%20Span%20%231%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_36/",
    ],
    briefing: {
      name: "DuPont Bridge Span #1",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 29.9819,
      forecastLongitude: -85.8519,
      description:
        "A 55 m section of the old DuPont Bridge, sunk intact in October 2008 as the first of three spans on the offshore run. It stands about 11 m off the sand.",
      marineLife: "Amberjack · snapper · spadefish · grouper",
      difficultyLevel: "advanced",
      depthMinMeters: 17,
      maxDepthMeters: 30,
      currentNote:
        "Open Gulf, about 11 nautical miles from the pass. Current, visibility and a summer thermocline vary by the day.",
      fitTone: "demanding",
      fitNote: "Close to 30 m on the sand, on an offshore run.",
      // Advanced Open Water below 30 m: the sand is at 27 m, past an Open Water
      // diver's depth, on an open-Gulf site 11 nautical miles out.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "great-barracuda",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // DuPont Bridge Span #3
  {
    slug: "dupont-bridge-span-3",
    version: 2,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Dupont%20Bridge%20Span%20%233%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_34/",
      "https://reefsmartguides.com/wp-content/uploads/2021/05/Northwest-Florida-sample-guidebook.pdf",
    ],
    briefing: {
      name: "DuPont Bridge Span #3",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 29.9753,
      forecastLongitude: -85.8416,
      description:
        "The last of three 55 m DuPont Bridge spans sunk intact in December 2008. It stands about 11 m tall on the sand, close to where the El Dorado was later placed.",
      marineLife: "Amberjack · snapper · spadefish · grouper",
      difficultyLevel: "advanced",
      depthMinMeters: 17,
      maxDepthMeters: 30,
      currentNote:
        "Open Gulf, about 11 nautical miles from the pass. Current, visibility and a summer thermocline vary by the day.",
      fitTone: "demanding",
      fitNote: "Close to 30 m on the sand, on an offshore run.",
      // Advanced Open Water below 30 m: the sand is at 27 m, past an Open Water
      // diver's depth, on an open-Gulf site 11 nautical miles out.
      minimumCertificationLevel: "advanced_open_water",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "great-barracuda",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Hathaway Bridge Span #5 (Fontainbleau)
  {
    slug: "hathaway-span-5",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Hathaway%20Span%20%235%20-Fontainbleau%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_124/",
    ],
    briefing: {
      name: "Hathaway Bridge Span #5",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.1641,
      forecastLongitude: -85.8969,
      description:
        "A steel truss span from the old Hathaway Bridge, sunk in May 1988 at the Fontainebleau site off Panama City Beach. The truss stands tall off the sand and gathers fish through every opening.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "intermediate",
      depthMinMeters: 14,
      maxDepthMeters: 23,
      currentNote:
        "Nearshore Gulf water: visibility swings with rain and wind, and fishing line snags easily on the steel truss.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Hathaway Bridge Span #12 (Midway Site)
  {
    slug: "hathaway-span-12",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Hathaway%20Span%20%2312%20-Midway%20Site%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_118/",
    ],
    briefing: {
      name: "Hathaway Bridge Span #12",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0347,
      forecastLongitude: -85.7315,
      description:
        "A steel truss span from the old Hathaway Bridge, sunk in May 1988 at the Midway site about 5 nautical miles south of the pass. Other spans, boxcars, culverts and tires were dropped around the same area over the years.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "intermediate",
      depthMinMeters: 14,
      maxDepthMeters: 22,
      currentNote:
        "Nearshore Gulf water: visibility swings with rain and wind, and fishing line snags easily on the steel truss.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Hathaway Bridge Span #14 (Warsaw Site)
  {
    slug: "hathaway-span-14",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://pcdivecenter.com/popular-dive-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Hathaway%20Span%20%2314%20Warsaw%20Site%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blogs.ifas.ufl.edu/bayco/reef_117/",
    ],
    briefing: {
      name: "Hathaway Bridge Span #14",
      locationName: "off Panama City Beach, Florida",
      forecastLatitude: 30.0715,
      forecastLongitude: -85.8146,
      description:
        "A steel truss span from the old Hathaway Bridge, sunk in May 1988 at the Warsaw site, close to the Black Bart and the Jeff-A Hovercraft. Concrete rubble and tire reefs lie nearby.",
      marineLife: "Snapper · spadefish · triggerfish · grouper",
      difficultyLevel: "intermediate",
      depthMinMeters: 14,
      maxDepthMeters: 23,
      currentNote:
        "Nearshore Gulf water: visibility swings with rain and wind, and fishing line snags easily on the steel truss.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // USS Massachusetts
  {
    slug: "uss-massachusetts",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://museumsinthesea.fpan.us/preserves/uss-massachusetts",
      "https://mbtdivers.com/dive-sites/inshore-sites",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
      "https://www.nps.gov/guis/planyourvisit/diving.htm",
    ],
    briefing: {
      name: "USS Massachusetts",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.2969,
      forecastLongitude: -87.3115,
      description:
        "One of the Navy's first battleships, commissioned in 1896 and scuttled just outside Pensacola Pass in 1921, where Army guns at Fort Pickens used her for target practice. She is now one of Florida's Underwater Archaeological Preserves, a big armored hull in water shallow enough that her turrets break the surface.",
      marineLife: "Barracuda · spadefish · jacks · grunts · moray eels",
      marineLifeDescription:
        "Pass water brings a bit of everything: schooling spadefish over the hull, barracuda that shadow divers, and morays tucked into the armor plate.",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      maxDepthMeters: 9,
      currentNote:
        "Tide runs hard through the pass close by, so dive her at slack water, ideally slack high for the best visibility. Fishing boats anchor on her often, and monofilament is common.",
      divePlan:
        "Find the turrets first, then work along the hull from bow to stern and back. Turn before slack ends rather than on gas.",
      fitTone: "welcoming",
      fitNote:
        "Shallow enough for a newer diver, provided the timing is right and someone on the boat watches the tide.",
      landmarks: [
        {
          name: "The main gun turrets",
          kind: "wreckFeature",
          note: "The two turrets sit at or near the surface and mark the wreck from the boat.",
        },
        {
          name: "Stern and rudder",
          kind: "wreckFeature",
          note: "One of the points on the preserve's own underwater tour, with the bow and the fighting tops.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "atlantic-spadefish",
        "remora",
        "spotfin-butterflyfish",
        "white-grunt",
        "green-moray",
      ],
    },
  },
  // Three Coal Barges (Three Barges)
  {
    slug: "three-coal-barges",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/ThreeBarges",
      "https://niuhidivecharters.com/three-coal-barges",
      "https://mbtdivers.com/dive-sites/inshore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0002%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "Three Coal Barges",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.2912,
      forecastLongitude: -87.2213,
      description:
        "Three steel coal barges that broke loose under tow in 1974 and were sunk where they lay by Navy demolition divers. Storms have broken them into pieces among a field of bridge rubble, and they are the first stop on the Florida Panhandle Shipwreck Trail.",
      marineLife: "Snapper · spadefish · triggerfish · shells in the sand",
      difficultyLevel: "beginner",
      depthMinMeters: 12,
      maxDepthMeters: 18,
      currentNote:
        "Close to the pass, so the tide and outflow from the bay set the visibility. Fifty years and many hurricanes have left the barges broken and partly buried; the county rates their condition very poor.",
      fitTone: "welcoming",
      fitNote: "Shallow, close in and forgiving. A common first Gulf wreck for new divers.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "sergeant-major",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Joe Patti Barge (Joe Patti Memorial Reef)
  {
    slug: "joe-patti-barge",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://niuhidivecharters.com/joe-patti-barge",
      "https://mbtdivers.com/dive-sites/inshore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0189%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
      "https://www.visitpensacola.com/things-to-do/outdoors/scuba-diving/types-of-diving-in-pensacola/",
    ],
    briefing: {
      name: "Joe Patti Memorial Reef",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.2888,
      forecastLongitude: -87.2293,
      description:
        "A deck barge sunk in 2013 in memory of Joe Patti, whose Pensacola seafood market opened in 1935. Steel sculptures of all things Pensacola are welded to the deck, including a bar with stools you can sit at.",
      marineLife: "Spadefish · baitfish schools · snapper · sand dollars",
      marineLifeDescription:
        "Baitfish often hang so thick over the barge that it is hard to see from the surface.",
      difficultyLevel: "beginner",
      depthMinMeters: 11,
      maxDepthMeters: 15,
      currentNote:
        "Usually an easy dive, but visibility follows the tide out of the pass. Watch for fishing line on the sculptures.",
      divePlan:
        "Down the line to the deck at about 11 m, a slow lap of the sculptures, then the sand around the barge for shells and sand dollars.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, compact and full of things to look at. A good dive for new divers; a Junior Open Water diver under 12 stays on the deck at 11 m, not the sand.",
      landmarks: [
        {
          name: "The sculpture deck",
          kind: "underwaterMonument",
          note: "Metal artwork welded along the deck, with a mock bar, stools and beer mugs.",
        },
      ],
      creatureSlugs: ["atlantic-spadefish", "gray-snapper", "sergeant-major", "lionfish"],
    },
  },
  // Tex Edwards Barge
  {
    slug: "tex-edwards-barge",
    version: 1,
    area: "florida-panhandle",
    // MBT's published coordinates for this barge repeat the Three Barges' position; FWC and the county agree on this one.
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0005%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
      "https://mbtdivers.com/dive-sites/mid-shore-sites",
    ],
    briefing: {
      name: "Tex Edwards Barge",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.269,
      forecastLongitude: -87.1693,
      description:
        "A large steel barge sunk on New Year's Eve 1982 east of Pensacola Pass. It is still intact and holds a lot of fish for its size.",
      marineLife: "Snapper · triggerfish · spadefish · reef fish",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 23,
      currentNote:
        "Open Gulf, about seven miles out east of the pass, so the sea state decides the day. Fishing line is common on the barge.",
      creatureSlugs: [
        "gray-snapper",
        "atlantic-spadefish",
        "lionfish",
        "great-barracuda",
        "gray-triggerfish",
      ],
    },
  },
  // Joseph L. Meek Liberty Ship (Pensacola Liberty Ship)
  {
    slug: "joseph-l-meek-liberty-ship",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://niuhidivecharters.com/liberty-ship-joseph-l-meek",
      "https://mbtdivers.com/dive-sites/mid-shore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0003%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "Liberty Ship Joseph L. Meek",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.2731,
      forecastLongitude: -87.1596,
      description:
        "A Second World War Liberty ship built in Oregon in 1942 to carry troops and cargo, then sunk as a reef in 1976. Her low hull sits about 6 m proud of the sand, and fishermen and spearos have worked her for decades.",
      marineLife: "Snapper · spadefish · barracuda · sharks",
      marineLifeDescription: "Long fished, and resident sharks know it.",
      difficultyLevel: "advanced",
      fitTone: "demanding",
      depthMinMeters: 23,
      maxDepthMeters: 29,
      // The sand is at 29 m, a few feet off the 30 m line: Advanced Open Water, without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "Open Gulf, seven miles out. Sharks that follow fishing boats are part of the dive, and fishing line is everywhere on an old reef like this one.",
      creatureSlugs: ["gray-snapper", "atlantic-spadefish", "great-barracuda", "cobia", "lionfish"],
    },
  },
  // San Pablo (Russian Freighter)
  {
    slug: "san-pablo-russian-freighter",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/SanPablo",
      "https://niuhidivecharters.com/russian-freighter-aka-s-s-san-pablo",
      "https://mbtdivers.com/dive-sites/mid-shore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0001%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "San Pablo (Russian Freighter)",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.1889,
      forecastLongitude: -87.2176,
      description:
        "A banana boat torpedoed by a U-boat in Costa Rica in 1942, raised, and blown apart off Pensacola in 1944 in a secret weapons test. The secrecy gave her the local nickname Russian Freighter. Today she is a field of twisted steel with her boilers still standing.",
      marineLife: "Spadefish · snapper · barracuda · lionfish",
      difficultyLevel: "intermediate",
      depthMinMeters: 18,
      maxDepthMeters: 26,
      currentNote:
        "Nine miles out in open Gulf. The wreckage is broken and sharp, so keep clear of loose plate and watch for fishing line.",
      divePlan:
        "Start at the boilers, then work the debris field around them; it covers an area about 90 m long.",
      landmarks: [
        {
          name: "The boilers",
          kind: "wreckFeature",
          note: "The tallest part of the wreck and the easiest place to start.",
        },
        {
          name: "Refrigeration coils",
          kind: "wreckFeature",
          note: "Remains of the cargo cooling from her years carrying fruit.",
        },
      ],
      creatureSlugs: ["atlantic-spadefish", "gray-snapper", "great-barracuda", "lionfish"],
    },
  },
  // Tug Ocean Wind (Ocean Winds)
  {
    slug: "tug-ocean-wind",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://mbtdivers.com/dive-sites/mid-shore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0048%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
      "https://www.visitpensacola.com/things-to-do/outdoors/scuba-diving/types-of-diving-in-pensacola/",
    ],
    briefing: {
      name: "Tug Ocean Wind",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.1832,
      forecastLongitude: -87.2003,
      description:
        "A 26 m tug that towed many of Escambia County's reefs out to sea, then joined them in January 2016. She sits intact near the wrecks she once delivered.",
      marineLife: "Spadefish · snapper · barracuda · reef fish",
      difficultyLevel: "intermediate",
      depthMinMeters: 16,
      maxDepthMeters: 25,
      currentNote:
        "Ten miles out in open Gulf; sea state and visibility vary day to day. Stay outside the hull.",
      creatureSlugs: ["atlantic-spadefish", "gray-snapper", "great-barracuda", "lionfish"],
    },
  },
  // Pete Tide II
  {
    slug: "pete-tide-ii",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/PeteTide",
      "https://reefsmartguides.com/wp-content/uploads/2021/05/Northwest-Florida-sample-guidebook.pdf",
      "https://niuhidivecharters.com/pete-tide-ii",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0049%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "Pete Tide II",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.146,
      forecastLongitude: -87.2337,
      description:
        "A 50 m oilfield anchor-handling tug sunk as a reef in May 1993. She sits upright and intact with three deck levels and an open wheelhouse, and she is a stop on the Florida Panhandle Shipwreck Trail.",
      marineLife: "Spadefish · red snapper · barracuda · king mackerel · angelfish",
      marineLifeDescription:
        "Schools of spadefish around the wheelhouse are close to guaranteed; snapper and barracuda work the hull.",
      difficultyLevel: "advanced",
      depthMinMeters: 19,
      maxDepthMeters: 32,
      currentNote:
        "Twelve miles out with no mooring buoy; boats tie into the wreck or anchor nearby. Monofilament and old netting cover parts of the wreck, and wires hang inside the wheelhouse.",
      divePlan:
        "Down to the wheelhouse at about 19 m, then along the main deck, looking into the open holds from above, staying above the sand at about 31 m.",
      fitTone: "demanding",
      fitNote:
        "The top is in reach of a newer diver, but the sand is past 30 m. Carry a cutting tool for the line.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The wheelhouse",
          kind: "wreckFeature",
          note: "The top of the wreck at about 19 m, open enough to look into. Mind the hanging wires.",
        },
        {
          name: "The aft holds",
          kind: "wreckFeature",
          note: "Three large holds open to the main deck toward the stern.",
        },
      ],
      creatureSlugs: [
        "atlantic-spadefish",
        "great-barracuda",
        "gray-snapper",
        "spotfin-butterflyfish",
        "sharpnose-puffer",
        "lionfish",
      ],
    },
  },
  // Chevron Rig (Chevron Platform)
  {
    slug: "chevron-rig-pensacola",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://mbtdivers.com/dive-sites/off-shore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0053%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "Chevron Rig",
      locationName: "off Pensacola, Florida",
      forecastLatitude: 30.0707,
      forecastLongitude: -87.0353,
      description:
        "Two oil platform jackets laid side by side on the sand in 1993, donated by Chevron to the Rigs to Reefs program. The steel lattice draws big schools of fish and usually clearer water than the wrecks closer in.",
      marineLife: "Amberjack · barracuda · snapper · spadefish",
      difficultyLevel: "advanced",
      depthMinMeters: 23,
      maxDepthMeters: 40,
      currentNote:
        "Eighteen miles out in open Gulf. The sand is at about 42 m, below recreational limits, so plan the dive on the upper structure and keep clear of the inside of the jackets.",
      fitTone: "demanding",
      fitNote: "A deep, open-water dive for an experienced diver with a firm turn depth.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "great-barracuda",
        "atlantic-spadefish",
        "gray-snapper",
        "cobia",
        "horse-eye-jack",
        "greater-amberjack",
      ],
    },
  },
  // YDT-14 (USS Phoebus)
  {
    slug: "ydt-14",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://floridapanhandledivetrail.com/Ships/Ydt14",
      "https://niuhidivecharters.com/ydt-14",
      "https://mbtdivers.com/dive-sites/off-shore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0083%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "YDT-14",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.0885,
      forecastLongitude: -87.1604,
      description:
        "A 40 m Navy dive tender built in 1942 and sunk in April 2000 beside her sister YDT-15. She is mostly intact, with decking removed fore and aft of the bridge to make her safer for divers, and she is a stop on the Florida Panhandle Shipwreck Trail.",
      marineLife: "Barracuda · spadefish · snapper · reef fish",
      marineLifeDescription: "Resident barracuda hang around the upper structure.",
      difficultyLevel: "advanced",
      depthMinMeters: 20,
      maxDepthMeters: 31,
      currentNote:
        "Eighteen miles out in open Gulf. The sand is just past 30 m. Fishing line is common on the bridge.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The wheelhouse",
          kind: "wreckFeature",
          note: "The top of the wreck at about 20 to 21 m, and the barracuda's usual spot.",
        },
      ],
      creatureSlugs: ["great-barracuda", "atlantic-spadefish", "gray-snapper", "lionfish"],
    },
  },
  // YDT-15 (USS Suitland)
  {
    slug: "ydt-15",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://niuhidivecharters.com/ydt-15",
      "https://mbtdivers.com/dive-sites/off-shore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0082%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "YDT-15",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.0878,
      forecastLongitude: -87.1592,
      description:
        "The sister of YDT-14, a 40 m Navy covered lighter from 1942 that became a dive tender and was sunk beside her in April 2000. She has settled and broken up more than her sister, with most of the bridge gone and debris spread around her.",
      marineLife: "Snapper · spadefish · barracuda · reef fish",
      difficultyLevel: "advanced",
      depthMinMeters: 23,
      maxDepthMeters: 31,
      currentNote:
        "Eighteen miles out in open Gulf. The county notes loose wires in the pilot house, and storms have buried much of the hull, so stay outside and off the debris.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["gray-snapper", "atlantic-spadefish", "great-barracuda", "lionfish"],
    },
  },
  // Avocet
  {
    slug: "avocet-dredge",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://niuhidivecharters.com/avocet",
      "https://mbtdivers.com/dive-sites/off-shore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0040%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
      "https://www.visitpensacola.com/things-to-do/outdoors/scuba-diving/types-of-diving-in-pensacola/",
    ],
    briefing: {
      name: "Avocet",
      locationName: "off Pensacola, Florida",
      forecastLatitude: 29.9728,
      forecastLongitude: -87.2101,
      description:
        "A 75 m clamshell dredge built in 1943 and sunk as a reef in May 1991. Her hull has since cracked across the beam into two sections a couple of meters apart, and her height makes her a magnet for big fish.",
      marineLife: "Red snapper · cobia · triggerfish · African pompano",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 36,
      currentNote:
        "Twenty miles out in open Gulf, so the boat ride and the sea state decide the day. A popular spearfishing wreck; expect fishing line and other divers' spear lines.",
      fitTone: "demanding",
      fitNote: "Deep and far out. Plan the dive on the upper structure and hold a turn depth.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The break",
          kind: "wreckFeature",
          note: "The crack across the hull that splits the ship into bow and stern sections.",
        },
      ],
      creatureSlugs: [
        "cobia",
        "gray-snapper",
        "great-barracuda",
        "atlantic-spadefish",
        "lionfish",
        "gray-triggerfish",
      ],
    },
  },
  // Antares
  {
    slug: "antares-freighter",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://niuhidivecharters.com/antares",
      "https://mbtdivers.com/dive-sites/off-shore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0073%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
      "https://www.visitpensacola.com/things-to-do/outdoors/scuba-diving/types-of-diving-in-pensacola/",
    ],
    briefing: {
      name: "Antares",
      locationName: "off Pensacola, Florida",
      forecastLatitude: 30.0098,
      forecastLongitude: -87.1296,
      description:
        "A 118 m freighter sunk on 27 September 1995, then the largest artificial reef in Florida. Hurricanes have since broken most of her apart, but the stern and the tall stack still stand above a wide field of hull and ribs.",
      marineLife: "Amberjack · snapper · barracuda · spadefish",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 40,
      currentNote:
        "Twenty-one miles out in open Gulf. The sand lies at about 40 to 43 m, so stay on the stack and the stern. The broken structure is unstable and is not a penetration dive.",
      divePlan:
        "Down to the stack, across to the intact stern at about 27 m, and back up the line before reaching the sand.",
      fitTone: "demanding",
      fitNote: "Deep, broken and far offshore. For an experienced diver on a conservative plan.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The stack",
          kind: "wreckFeature",
          note: "Still standing, and the shallowest part of the wreck at about 21 m.",
        },
        {
          name: "The stern",
          kind: "wreckFeature",
          note: "The one section still intact, from about 27 m.",
        },
      ],
      creatureSlugs: [
        "great-barracuda",
        "gray-snapper",
        "atlantic-spadefish",
        "cobia",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Tenneco Rig (Tenneco Platform)
  {
    slug: "tenneco-rig",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://niuhidivecharters.com/wreck-diving-locations-tenneco-rig",
      "https://mbtdivers.com/dive-sites/off-shore-sites",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0004%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "Tenneco Rig",
      locationName: "off Pensacola, Florida",
      forecastLatitude: 29.9952,
      forecastLongitude: -87.0853,
      description:
        "Two pieces of a retired Tenneco oil platform, barged in and sunk in 1982 as the first complete platform reefed under Rigs to Reefs. The upper lattice is full of fish, and the rest drops far below recreational depth.",
      marineLife: "Amberjack · barracuda · snapper · spadefish",
      difficultyLevel: "advanced",
      depthMinMeters: 27,
      maxDepthMeters: 40,
      currentNote:
        "About 22 nautical miles out in open Gulf. The sand is at about 53 m, well past recreational limits; dive the top of the structure only and stay outside the lattice.",
      fitTone: "demanding",
      fitNote:
        "Starts deep and keeps going. A dive for an experienced deep diver; the lower structure is for technical divers.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "great-barracuda",
        "atlantic-spadefish",
        "gray-snapper",
        "cobia",
        "horse-eye-jack",
        "greater-amberjack",
      ],
    },
  },
  // Knicklebine Barge (Nicklebein Barge)
  {
    slug: "knicklebine-barge",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0088%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
      "https://www.visitpensacola.com/things-to-do/outdoors/scuba-diving/types-of-diving-in-pensacola/",
    ],
    briefing: {
      name: "Knicklebine Barge",
      locationName: "off Pensacola, Florida",
      forecastLatitude: 30.0328,
      forecastLongitude: -87.1916,
      description:
        "A 36 m steel barge sunk in February 2003 with fourteen large pieces of concrete ballast. It has since collapsed, and it is known as a good place to hunt lionfish.",
      marineLife: "Lionfish · snapper · triggerfish · reef fish",
      difficultyLevel: "advanced",
      depthMinMeters: 34,
      maxDepthMeters: 37,
      currentNote:
        "About 17 miles out in deep open Gulf with little relief, so the whole dive is spent near the bottom; gas and no-stop time go quickly. A collapsed barge has sharp edges.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: ["lionfish", "gray-snapper", "great-barracuda", "gray-triggerfish"],
    },
  },
  // Tug Born Again (Born Again Tugboat)
  {
    slug: "tug-born-again",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://niuhidivecharters.com/tug-born-again",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0039%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "Tug Born Again",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.1368,
      forecastLongitude: -87.2368,
      description:
        "A 20 m tug sunk as a reef on 24 January 1991 with twenty-one steel pipes loaded across her deck. The tug is partly broken now, and the pipes make a maze of hiding places.",
      marineLife: "Lobster · snapper · spadefish · reef fish",
      marineLifeDescription: "Look into the ends of the pipes for lobster.",
      difficultyLevel: "advanced",
      fitTone: "demanding",
      depthMinMeters: 20,
      maxDepthMeters: 30,
      // The sand is at 29 m, a few feet off the 30 m line: Advanced Open Water, without the Deep specialty.
      minimumCertificationLevel: "advanced_open_water",
      currentNote:
        "Open Gulf about twelve miles out. The tug is breaking down, so keep off the loose structure and out of the pipes.",
      landmarks: [
        {
          name: "The pipe stack",
          kind: "wreckFeature",
          note: "Twenty-one steel pipes, each about 6 m long, lying across the deck.",
        },
      ],
      creatureSlugs: ["slipper-lobster", "gray-snapper", "atlantic-spadefish", "lionfish"],
    },
  },
  // PC Barge (P.C. Barge)
  {
    slug: "pc-barge",
    version: 1,
    area: "florida-panhandle",
    // FWC dates the deployment 20 June 1990; Niuhi's page says 1995. The description gives no year.
    sources: [
      "https://niuhidivecharters.com/pc-barge",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0028%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "PC Barge",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.1869,
      forecastLongitude: -87.2344,
      description:
        "A 34 m steel barge whose deck now stands a couple of meters off the sand on its hollowed-out frame, with two sets of radio tower sections lying on either side. Easy to navigate and busy with fish around the towers.",
      marineLife: "Snapper · spadefish · reef fish · lionfish",
      difficultyLevel: "intermediate",
      depthMinMeters: 21,
      maxDepthMeters: 25,
      currentNote:
        "Open Gulf about nine miles out. Stay out of the space under the deck; it is an overhead environment.",
      divePlan: "Circle the barge, then out to each set of towers and back.",
      landmarks: [
        {
          name: "The radio towers",
          kind: "pointOfInterest",
          note: "Galvanized tower sections in the sand on both sides of the barge, where most of the fish are.",
        },
      ],
      creatureSlugs: ["gray-snapper", "atlantic-spadefish", "lionfish", "sergeant-major"],
    },
  },
  // Oops Barge
  {
    slug: "oops-barge",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://niuhidivecharters.com/oops-barge",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0074%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "Oops Barge",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.2205,
      forecastLongitude: -87.2332,
      description:
        "A 20 m steel barge that sank on its own on 2 October 1995 while being towed out to its permitted reef site, about two miles short. It sits low on the sand but holds a lot of fish for its size.",
      marineLife: "Snapper · triggerfish · reef fish",
      difficultyLevel: "intermediate",
      depthMinMeters: 21,
      maxDepthMeters: 23,
      currentNote:
        "Open Gulf about eight miles out. With only about 1.5 m of relief the barge is easy to lose in poor visibility; stay close to the line.",
      creatureSlugs: ["gray-snapper", "lionfish", "sergeant-major", "gray-triggerfish"],
    },
  },
  // Navy Barge (Navy Camel Barge, Pensacola)
  {
    slug: "navy-barge-pensacola",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://niuhidivecharters.com/navy-barge",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0050%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0055%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
    ],
    briefing: {
      name: "Navy Barge",
      locationName: "off Pensacola Pass, Florida",
      forecastLatitude: 30.1863,
      forecastLongitude: -87.2458,
      description:
        "A Navy steel barge sunk as a reef in 1993, with a Navy camel float added about 12 m north of it the following year. Two low structures close together on the sand.",
      marineLife: "Snapper · spadefish · reef fish",
      difficultyLevel: "intermediate",
      maxDepthMeters: 25,
      currentNote:
        "Open Gulf about nine miles out. Both pieces have partly subsided into the sand; watch for fishing line.",
      landmarks: [
        {
          name: "The camel",
          kind: "wreckFeature",
          note: "A Navy camel float about 12 m north of the barge.",
        },
      ],
      creatureSlugs: ["gray-snapper", "atlantic-spadefish", "lionfish"],
    },
  },
  // LuLu
  {
    slug: "lulu-wreck",
    version: 1,
    area: "florida-panhandle",
    // In Alabama state waters off Orange Beach; counted with the Panhandle because Pensacola operators run it.
    sources: [
      "https://conservationgis.alabama.gov/adcnrweb/rest/services/ArtificialReefs/MapServer/0/query?where=Reef_Name%3D%27LuLu%27&outFields=Reef_Name,GPS_Latitu,GPS_Longit,Depth,Year,Material&returnGeometry=false&f=json",
      "https://www.gulfshores.com/blog/an-in-depth-look-at-the-lulu",
      "https://www.outdooralabama.com/node/2265",
      "https://mbtdivers.com/dive-sites/specialty-offshore-dives",
    ],
    briefing: {
      name: "LuLu",
      locationName: "off Orange Beach, Alabama",
      forecastLatitude: 29.992,
      forecastLongitude: -87.5506,
      description:
        "An 83 m coastal freighter built in the Netherlands in 1972 and scuttled without explosives in May 2013. She sits upright and whole about 17 nautical miles south of Perdido Pass, and most of the ship can be seen from her upper decks.",
      marineLife: "Snapper · spadefish · barracuda · amberjack",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 35,
      currentNote:
        "Open Gulf, a long run from either pass. Winter usually brings the best visibility and summer the warmest water. Stay outside the hull.",
      divePlan:
        "Down to the wheelhouse at about 18 m, then along the upper decks around 27 m, where most of the ship is in view. The sand is a deep dive.",
      fitTone: "demanding",
      fitNote:
        "The top is a reasonable depth, but the sand is well past 30 m and the run out is long.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The wheelhouse",
          kind: "wreckFeature",
          note: "The top of the wreck at about 18 m.",
        },
      ],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "great-barracuda",
        "lionfish",
        "cobia",
        "greater-amberjack",
      ],
    },
  },
  // New Venture (Fairfield New Venture)
  {
    slug: "new-venture-wreck",
    version: 1,
    area: "florida-panhandle",
    // In Alabama state waters off Orange Beach; counted with the Panhandle because Pensacola operators run it.
    sources: [
      "https://conservationgis.alabama.gov/adcnrweb/rest/services/ArtificialReefs/MapServer/0/query?where=Reef_Name%3D%27New%20Venture%27&outFields=Reef_Name,GPS_Latitu,GPS_Longit,Depth,Year,Material&returnGeometry=false&f=json",
      "https://www.outdooralabama.com/node/2265",
      "https://reefsmartguides.com/?p=8254",
      "https://mbtdivers.com/dive-sites/specialty-offshore-dives",
    ],
    briefing: {
      name: "New Venture",
      locationName: "off Orange Beach, Alabama",
      forecastLatitude: 29.9009,
      forecastLongitude: -87.5483,
      description:
        "A 76 m survey and research ship built in 1986, cleaned and sunk by Alabama as a reef in June 2018 with oil-spill restoration money. She lies about 20 nautical miles south of Orange Beach, with large holes cut in her sides and interior.",
      marineLife: "Snapper · spadefish · barracuda · amberjack",
      difficultyLevel: "advanced",
      depthMinMeters: 18,
      maxDepthMeters: 39,
      currentNote:
        "Far out in open Gulf with the sand near 39 m. The cut-outs were made for trained penetration divers; everyone else stays outside.",
      fitTone: "demanding",
      fitNote: "A deep wreck on a long boat ride, built for advanced and technical divers.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      creatureSlugs: [
        "atlantic-spadefish",
        "gray-snapper",
        "great-barracuda",
        "lionfish",
        "greater-amberjack",
      ],
    },
  },
  // Fort Pickens Jetty
  {
    slug: "fort-pickens-jetty",
    version: 1,
    area: "florida-panhandle",
    // Position: Fort Pickens' published point (Wikipedia); the jetty runs off the fort's northwest seawall within a few hundred meters. A shop should move the pin to its entry stairs.
    sources: [
      "https://www.nps.gov/guis/planyourvisit/diving.htm",
      "https://niuhidivecharters.com/ft-pickens-jetty",
      "https://mbtdivers.com/dive-sites/shore-dive-sites",
      "https://en.wikipedia.org/wiki/Fort_Pickens",
    ],
    briefing: {
      name: "Fort Pickens Jetty",
      locationName: "Fort Pickens, Gulf Islands National Seashore, Florida",
      forecastLatitude: 30.327,
      forecastLongitude: -87.2907,
      description:
        "A rock jetty off the northwest corner of the Fort Pickens seawall, at the mouth of Pensacola Pass. It looks small from shore, but it drops off quickly and the area around it holds culverts, old vehicles and other dumped habitat.",
      marineLife: "Sheepshead · flounder · spadefish · stingrays · porcupinefish",
      marineLifeDescription: "Good by day and better at night, when the jetty rocks come alive.",
      difficultyLevel: "intermediate",
      depthMinMeters: 3,
      maxDepthMeters: 15,
      currentNote:
        "Tide dependent: the pass current can be dangerous, so dive only around slack water. Boat traffic runs through the pass, a dive flag is required, monofilament is everywhere, and diving is not allowed within about 60 m (200 ft) of the Fort Pickens fishing pier.",
      divePlan:
        "Enter from the seawall stairs, follow the rocks down the slope and back, and be out of the water before the tide turns.",
      fitTone: "demanding",
      fitNote: "An easy entry but a serious site: the tide table matters more than the depth.",
      creatureSlugs: [
        "atlantic-spadefish",
        "southern-stingray",
        "porcupinefish",
        "sergeant-major",
        "gray-snapper",
      ],
    },
  },
  // Park East Gulf-Side Reef (Portofino Reef, Park East Snorkel Reef)
  {
    slug: "park-east-snorkel-reef",
    version: 1,
    area: "florida-panhandle",
    // Position: Visit Pensacola's point for the Park East beach access; the reef lies about 150 m (500 ft) straight off it. No surveyed reef position is published.
    sources: [
      "https://www.visitpensacola.com/things-to-do/outdoors/snorkeling/",
      "https://niuhidivecharters.com/portofino-reef",
      "https://mbtdivers.com/dive-sites/shore-dive-sites",
    ],
    briefing: {
      name: "Park East Reef",
      locationName: "Pensacola Beach, Florida",
      forecastLatitude: 30.3468,
      forecastLongitude: -87.0568,
      description:
        "About a dozen tall reef modules set in shallow Gulf water roughly 150 m off the Park East beach access, east of the Portofino towers on Pensacola Beach. A shore dive or snorkel among small reef fish.",
      marineLife: "Small reef fish · sergeant majors · baitfish",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 4,
      currentNote:
        "Not tide dependent, but surf, surge and longshore current can be strong; check the beach flags before going in. There are no lifeguards at the reef, and a dive flag is required.",
      fitTone: "welcoming",
      creatureSlugs: ["sergeant-major", "atlantic-spadefish", "sheepshead"],
    },
  },
  // Park West and Captain Bob Quarles Reefs
  {
    slug: "park-west-quarles-reef",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0186%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/docs/default-source/upload/natural-resources-management/mrd-artificial-reefs/20261005_gisartificialreeflist.xlsx",
      "https://myescambia.com/news/news-article/2013/04/18/expansion-of-bay-snorkeling-reef-",
      "https://mbtdivers.com/dive-sites/shore-dive-sites",
    ],
    briefing: {
      name: "Park West Bay Reef",
      locationName: "Pensacola Beach, Florida",
      forecastLatitude: 30.329,
      forecastLongitude: -87.1812,
      description:
        "A sound-side snorkel and training reef about 90 m north of Park West, built from concrete modules, 270 tons of rubble for the Captain Bob Quarles Reef in 2011, and faux ballast rock laid as a mock old shipwreck. Four pilings mark its corners.",
      marineLife: "Pinfish · pipefish · small reef fish · crabs",
      difficultyLevel: "beginner",
      depthMinMeters: 2,
      maxDepthMeters: 4,
      currentNote:
        "Sheltered bay water, but visibility is often poor. Boats use the sound, so fly a dive flag and stay inside the pilings.",
      fitTone: "welcoming",
      fitNote: "A calm, shallow place for training dives and first snorkels.",
      landmarks: [
        {
          name: "Corner pilings",
          kind: "navigationMark",
          note: "Four pilings about 45 m off the beach mark the reef's corners.",
        },
      ],
      creatureSlugs: ["gray-snapper", "sergeant-major", "moon-jelly"],
    },
  },
  // Casino Beach Snorkel Reef
  {
    slug: "casino-beach-snorkel-reef",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27ES0642%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://myescambia.com/news/news-article/2020/06/22/charles-fennell-gonzalez-iv-casino-beach-reef-construction-completed",
      "https://mbtdivers.com/dive-sites/shore-dive-sites",
    ],
    briefing: {
      name: "Casino Beach Snorkel Reef",
      locationName: "Pensacola Beach, Florida",
      forecastLatitude: 30.3288,
      forecastLongitude: -87.1386,
      description:
        "Seventeen concrete reef modules set on pilings in June 2020, about 210 m off the Gulf beach just east of the Casino Beach swimming area. It is named the Charles Fennell Gonzalez IV reef, and the tops sit about 2 m below the surface.",
      marineLife: "Small reef fish · sergeant majors · baitfish",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 5,
      currentNote:
        "Outside the lifeguarded swimming area, and surf here can be high; check the beach flags. A dive flag is required, and a small white buoy marks the northernmost module.",
      fitTone: "welcoming",
      landmarks: [
        {
          name: "White marker buoy",
          kind: "navigationMark",
          note: "On the northernmost module, closest to shore.",
        },
      ],
      creatureSlugs: ["sergeant-major", "atlantic-spadefish", "sheepshead"],
    },
  },
  // Perdido Key Reef (Perdido Key Snorkel Reef)
  {
    slug: "perdido-key-snorkel-reef",
    version: 1,
    area: "florida-panhandle",
    // Position: Visit Pensacola's point for Perdido Key Beach Access #1; the reef starts about 90 m (300 ft) offshore. No surveyed reef position is published.
    sources: [
      "https://www.visitpensacola.com/things-to-do/outdoors/snorkeling/",
      "https://myescambia.com/news/news-article/2014/03/01/perdido-key-snorkel-reef-under-construction",
      "https://mbtdivers.com/dive-sites/shore-dive-sites",
    ],
    briefing: {
      name: "Perdido Key Snorkel Reef",
      locationName: "Perdido Key, Florida",
      forecastLatitude: 30.2972,
      forecastLongitude: -87.4271,
      description:
        "Three rows of eight reef modules built by Escambia County in 2014, running about 150 m out from the beach off Sandy Key Drive. A shore dive or snorkel in shallow Gulf water.",
      marineLife: "Small reef fish · sergeant majors · baitfish",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 5,
      currentNote:
        "Surf and longshore current decide the day; there are no lifeguards at the reef and a dive flag is required. Parking at the beach access is very limited.",
      fitTone: "welcoming",
      creatureSlugs: ["sergeant-major", "atlantic-spadefish", "sheepshead"],
    },
  },
  // Navarre Gulf-Side Reef (Navarre Beach Marine Sanctuary)
  {
    slug: "navarre-gulf-side-reef",
    version: 1,
    area: "florida-panhandle",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=DeployID%3D%27SR0018%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://blog.beachguide.com/northwest-florida/navarre-beach-diving-reefs",
      "https://mbtdivers.com/dive-sites/shore-dive-sites",
    ],
    briefing: {
      name: "Navarre Gulf-Side Reef",
      locationName: "Navarre Beach, Florida",
      forecastLatitude: 30.3791,
      forecastLongitude: -86.8538,
      description:
        "Stacked-disc reef modules set by Santa Rosa County from 2012, about 90 m off the beach and roughly 600 m east of the Navarre Beach Fishing Pier. Part of the Navarre Beach Marine Sanctuary, and an easy swim from the sand.",
      marineLife: "Reef fish · baitfish · octopus · sea turtles (sometimes)",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 6,
      currentNote:
        "Depth changes with the tide, and surf and longshore current can be strong. A dive flag is required; stay well clear of the fishing pier.",
      fitTone: "welcoming",
      creatureSlugs: ["sergeant-major", "atlantic-spadefish", "gray-snapper", "loggerhead-turtle"],
    },
  },
];
