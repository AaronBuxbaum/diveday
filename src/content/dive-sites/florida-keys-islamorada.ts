// i18n-exempt-file: shop-editable starter briefing content, not app UI copy — see src/content/dive-site-templates.ts
import type { DiveSiteTemplate } from "./types";

/** Islamorada. */
export const FLORIDA_KEYS_ISLAMORADA: DiveSiteTemplate[] = [
  {
    slug: "alligator-reef",
    version: 2,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/alligator.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Alligator%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://archives.uslhs.org/places/alligator-reef",
    ],
    briefing: {
      name: "Alligator Reef",
      locationName: "Islamorada, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.8472,
      forecastLongitude: -80.6197,
      description:
        "A big reef under an 1873 skeletal lighthouse, named for a US schooner wrecked here in 1822. Shallow, busy with fish, and famous for how much of it you can see at once.",
      marineLife: "Tarpon · barracuda · schooling grunts · nurse sharks",
      marineLifeDescription:
        "Enormous schools sit in the cuts between the spurs, and tarpon patrol the deeper edge in summer.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 20,
      currentNote: "Runs with the tide through the cuts — an easy drift when it does.",
      divePlan:
        "Start at the deeper sand edge, work up through a cut into the shallow coral, and finish under the boat. Some moorings sit deeper, near 20 m, so check which one the boat is on.",
      fitTone: "welcoming",
      fitNote:
        "Shallow, bright and full of fish. If the current is running, the crew will make it a drift rather than a swim.",
      landmarks: [
        {
          name: "Alligator Reef Light",
          kind: "navigationMark",
          note: "The 41 m iron skeleton tower overhead — the reference point for the whole site.",
        },
        {
          name: "The cuts",
          kind: "reefFormation",
          note: "Sand channels between the coral spurs, where the fish stack up and the current does the swimming.",
        },
      ],
      creatureSlugs: [
        "tarpon",
        "great-barracuda",
        "french-grunt",
        "nurse-shark",
        "queen-angelfish",
      ],
    },
  },
  {
    slug: "eagle-wreck",
    version: 2,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/shipwrecktrail/eagle.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/ShipwreckTrail_FKNMS/FeatureServer/4/query?where=1%3D1&outFields=*&f=json",
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Eagle%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
    ],
    briefing: {
      name: "Eagle Wreck",
      locationName: "Islamorada, Florida",
      forecastLatitude: 24.87,
      forecastLongitude: -80.5702,
      description:
        "An 87 m freighter sunk in 1985 and broken into two clean sections by Hurricane Georges — which made it a better dive: two open halves, both swimmable, both full of fish.",
      marineLife: "Goliath grouper · barracuda · jacks · glassy sweepers",
      marineLifeDescription:
        "The broken ends are the best of it — open, lit, and thick with schooling fish holding out of the current.",
      difficultyLevel: "advanced",
      depthMinMeters: 21,
      maxDepthMeters: 34,
      currentNote: "Open water, and often a real current — a line dive when it is running.",
      divePlan:
        "Descend the mooring to the shallower section, work the length of one half, and turn on gas rather than on time.",
      fitTone: "demanding",
      fitNote:
        "Deep, exposed and worth nitrox. Two dives here are the best way to see the whole ship.",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "The break",
          kind: "wreckFeature",
          note: "Where the hurricane split her. The open cross-section is the most photographed thing on the wreck.",
        },
        {
          name: "Wheelhouse and mast",
          kind: "wreckFeature",
          note: "Close to the shallowest steel, a deck railing at about 21 m. A lot of the fish life sits here.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "great-barracuda",
        "horse-eye-jack",
        "glassy-sweeper",
        "spotted-moray",
        "yellow-tube-sponge",
      ],
    },
  },
  {
    slug: "cheeca-rocks",
    version: 2,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/cheecarocks.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Cheeca%20Rocks%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://en.wikipedia.org/wiki/Cheeca_Rocks",
      "https://snorkelaroundtheworld.com/islamorada-snorkeling/",
    ],
    briefing: {
      name: "Cheeca Rocks",
      locationName: "Islamorada, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.8975,
      forecastLongitude: -80.6183,
      description:
        "A patch reef inshore of the reef line, in barely 6 m of water. For years its coral held up better than most in the Keys. The 2023 heat wave hit it too, so expect it to look different from older photos. A sanctuary preservation area, and a snorkel site as much as a dive.",
      marineLife: "Brain coral · star coral · parrotfish · yellowtail snapper",
      marineLifeDescription:
        "Big mounding coral heads, and dense fish life because the structure is dense.",
      difficultyLevel: "beginner",
      depthMinMeters: 2,
      maxDepthMeters: 6,
      currentNote: "Inshore and sheltered — the reliable call when the outer reef is unworkable.",
      divePlan:
        "A slow circuit of the patch heads; at this depth the tank outlasts anyone's patience.",
      fitTone: "welcoming",
      fitNote:
        "Barely deeper than a pool, with big coral heads close enough to study. A gentle first reef.",
      landmarks: [
        {
          name: "The mounding heads",
          kind: "reefFormation",
          note: "Boulder corals meters across, each one its own small city.",
        },
      ],
      creatureSlugs: [
        "great-star-coral",
        "grooved-brain-coral",
        "stoplight-parrotfish",
        "yellowtail-snapper",
        "foureye-butterflyfish",
        "flamingo-tongue",
      ],
    },
  },
  // Denominator row: Crocker Reef (Crocker Wall)
  {
    slug: "crocker-reef",
    version: 1,
    area: "florida-keys-islamorada",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Crocker%20Reef%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://visitfloridakeys.com/sites/default/files/2025-10/Reef-Explorer-Guide.pdf",
      "https://www.islamoradadivecenter.com/florida-keys-dive-sites",
    ],
    briefing: {
      name: "Crocker Reef and Wall",
      locationName: "Islamorada, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.9085,
      forecastLongitude: -80.5217,
      description:
        "An outer reef off Islamorada whose south end becomes Crocker Wall, a spur-and-groove slope more than 120 m long that runs from mounding coral heads near 9 m down toward 24 m. Big barrel sponges line the slope, and the bigger fish follow it.",
      marineLife: "Spotted eagle rays · sea turtles · green morays · barrel sponges",
      marineLifeDescription:
        "Grunts, yellowtail and grouper on the reef top, and rays and turtles cruising the face of the slope.",
      difficultyLevel: "intermediate",
      depthMinMeters: 5,
      maxDepthMeters: 24,
      currentNote:
        "Outer-reef current is common along the wall, and the slope keeps going deeper than the dive should. Agree a floor before descending.",
      divePlan:
        "Drop onto the wall moorings, work along the slope at your planned depth with the current, and climb the spurs to the coral heads for the end of the dive.",
      fitTone: "demanding",
      fitNote:
        "Comfortable for a diver who watches a gauge on a slope. The shallow moorings suit everyone else.",
      landmarks: [
        {
          name: "Crocker Wall",
          kind: "reefFormation",
          note: "The sea slope on the reef’s south end, cut by spurs, grooves and small canyons.",
        },
      ],
      creatureSlugs: [
        "spotted-eagle-ray",
        "hawksbill-turtle",
        "green-moray",
        "giant-barrel-sponge",
        "yellowtail-snapper",
        "black-grouper",
      ],
    },
  },
  // Denominator row: Davis Reef (Davis Ledge)
  {
    slug: "davis-reef",
    version: 1,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/davisreef.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Davis%20Ledge%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://visitfloridakeys.com/experiences/what-were-famous-for/diving-snorkeling/explore-islamorada-most-amazing-dives",
      "https://www.islamoradadivecenter.com/florida-keys-dive-sites",
    ],
    briefing: {
      name: "Davis Reef",
      locationName: "Islamorada, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.9222,
      forecastLongitude: -80.5044,
      description:
        "A long reef ledge off Plantation Key, protected as a Sanctuary Preservation Area for its sea fans, sea rods and sea plumes. Grunts and schoolmaster snapper gather in the gullies, and a few very relaxed green morays live along the ledge.",
      marineLife: "Schoolmaster snapper · grunts · green morays · grouper",
      marineLifeDescription:
        "Dense soft coral on the reef top, and big schools sheltering in the cuts below it.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 17,
      currentNote:
        "Easy navigation along the ledge. A preservation area, so no fishing or collecting and no touching the coral; boats use the mooring buoys. Some moorings on the seaward side sit near 17 m, so check which one the boat is on.",
      divePlan:
        "Follow the ledge from the mooring, look into the gullies and archways, and come back over the soft-coral reef top.",
      fitTone: "welcoming",
      fitNote: "Shallow, easy to follow and busy with fish. Good for any certified diver.",
      landmarks: [
        {
          name: "The ledge",
          kind: "reefFormation",
          note: "The north-to-south ledge the site is built around, with canyons and archways cut into it.",
        },
      ],
      creatureSlugs: [
        "schoolmaster-snapper",
        "french-grunt",
        "green-moray",
        "black-grouper",
        "common-sea-fan",
        "sea-plume",
      ],
    },
  },
  // Denominator row: Hen and Chickens (Hens & Chickens)
  {
    slug: "hen-and-chickens",
    version: 1,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/henchickens.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Hens%20%26%20Chickens%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.islamoradadivecenter.com/florida-keys-dive-sites",
      "https://visitfloridakeys.com/experiences/what-were-famous-for/diving-snorkeling/explore-islamorada-most-amazing-dives",
    ],
    briefing: {
      name: "Hen and Chickens",
      locationName: "Plantation Key, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.9348,
      forecastLongitude: -80.5492,
      description:
        "A patch reef in the middle of Hawk Channel, its coral clustered like chicks around a mother hen. The big star and brain coral mounds are why it is a Sanctuary Preservation Area, and some stand taller than a diver.",
      marineLife: "Bluestriped grunts · grouper · nurse sharks · sea fans",
      marineLifeDescription:
        "Grunt schools around the mounds and a forest of purple sea fans between them.",
      difficultyLevel: "beginner",
      depthMinMeters: 3,
      maxDepthMeters: 7,
      currentNote:
        "Inshore and shallow, the place to go when the outer reef is blown out, though visibility is usually lower than offshore. It sits in Hawk Channel, so boat traffic passes close: fly the dive flag and come up by the boat. No fishing or collecting inside the preservation area.",
      divePlan:
        "Circle from mound to mound around the mooring and back. At this depth, gas lasts longer than most people’s attention.",
      fitTone: "welcoming",
      fitNote: "Shallow, sheltered and easy. A gentle first reef.",
      landmarks: [
        {
          name: "The coral mounds",
          kind: "reefFormation",
          note: "Clusters of star and brain coral that give the reef its name, some several meters tall.",
        },
      ],
      creatureSlugs: [
        "bluestriped-grunt",
        "nurse-shark",
        "great-star-coral",
        "grooved-brain-coral",
        "common-sea-fan",
        "green-moray",
      ],
    },
  },
  // Denominator row: Conch Reef (Conch Wall)
  {
    slug: "conch-reef",
    version: 1,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/zones/spas/conchreef.html",
      "https://floridakeys.noaa.gov/zones/special/conchreef.html",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Conch%20Wall%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.rainbowreef.com/dive-locations-in-key-largo/conch-reef-and-wall",
    ],
    briefing: {
      name: "Conch Reef and Wall",
      locationName: "Tavernier, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.9544,
      forecastLongitude: -80.4581,
      description:
        "A shallow reef with one of the best-developed reef walls in the Keys on its seaward side. The wall’s top lies around 14–17 m and it slopes away past 30 m, lined with barrel sponges and sea fans, with the Aquarius undersea laboratory working next door.",
      marineLife: "Giant barrel sponges · sea fans · spotted eagle rays · grouper",
      marineLifeDescription:
        "Sponges and gorgonians crowd the slope, and big animals pass along it on the current.",
      difficultyLevel: "advanced",
      depthMinMeters: 5,
      maxDepthMeters: 30,
      currentNote:
        "The wall is run as a drift, and the slope continues below recreational depth, so the floor is the diver’s to hold. The reef top is a Sanctuary Preservation Area (no fishing or collecting), and the Research Only area beside it, marked by yellow buoys, is closed to all entry.",
      divePlan:
        "Drop onto the top of the wall, drift along it no deeper than 30 m (100 ft), and ascend over the reef with the boat following your bubbles.",
      fitTone: "demanding",
      fitNote:
        "A deep drift along a wall that does not end where you should. For divers confident with both.",
      // The wall drops past 30 m; the plan holds a hard floor at 30 m, so the gate is Advanced
      // Open Water without the Deep specialty. The shallow reef-top moorings are an
      // Open Water dive a shop can open by lowering this.
      minimumCertificationLevel: "advanced_open_water",
      landmarks: [
        {
          name: "Conch Wall",
          kind: "reefFormation",
          note: "The sloping wall on the reef’s seaward edge, top near 15 m.",
        },
        {
          name: "Research Only area",
          kind: "pointOfInterest",
          note: "Yellow buoys marked “Research Only” around the Aquarius laboratory. Closed to entry.",
        },
      ],
      creatureSlugs: [
        "giant-barrel-sponge",
        "common-sea-fan",
        "spotted-eagle-ray",
        "black-grouper",
      ],
    },
  },
  // Denominator row: Rocky Top
  {
    slug: "rocky-top",
    version: 1,
    area: "florida-keys-islamorada",
    sources: [
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27Rocky%20Top%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
      "https://www.islamoradadivecenter.com/florida-keys-dive-sites",
    ],
    briefing: {
      name: "Rocky Top",
      locationName: "Islamorada, Florida Keys National Marine Sanctuary",
      forecastLatitude: 24.8951,
      forecastLongitude: -80.574,
      description:
        "A patch reef of large coral heads and purple gorgonians off Islamorada, with resident turtles and schools of fish thick enough to shade the bottom.",
      marineLife: "Sea turtles · schooling grunts · purple sea fans · parrotfish",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 9,
      currentNote: "Usually easy. Moor on the buoys and keep fins off the coral heads.",
      divePlan:
        "Work around the coral heads from the mooring, then circle back through the gorgonians.",
      fitTone: "welcoming",
      creatureSlugs: [
        "green-sea-turtle",
        "french-grunt",
        "common-sea-fan",
        "stoplight-parrotfish",
        "yellowtail-snapper",
      ],
    },
  },
  // Denominator row: San Pedro (1733 Spanish Plate Fleet)
  {
    slug: "san-pedro",
    version: 1,
    area: "florida-keys-islamorada",
    sources: [
      "https://floridakeys.noaa.gov/shipwrecktrail/sanpedro.html",
      "https://www.floridastateparks.org/parks-and-trails/san-pedro-underwater-archaeological-preserve-state-park",
      "https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/PubFKNMSBuoy2025/FeatureServer/0/query?where=Location%3D%27The%20San%20Pedro%27&outFields=Location,BuoyType,Depth__ft_&outSR=4326&f=json",
    ],
    briefing: {
      name: "San Pedro",
      locationName: "Indian Key, Islamorada, Florida",
      forecastLatitude: 24.8633,
      forecastLongitude: -80.6797,
      description:
        "A ship of the 1733 Spanish fleet, sunk in a hurricane a mile south of Indian Key and the oldest wreck on the Florida Keys Shipwreck Trail. What remains is her mound of river-stone ballast, with replica cannons, an anchor from another ship of the fleet and a bronze plaque set beside it.",
      marineLife: "Grunts · snapper · parrotfish · turtle grass",
      marineLifeDescription:
        "The ballast pile is a reef of its own in the middle of the seagrass, and it is full of small fish.",
      difficultyLevel: "beginner",
      depthMinMeters: 5,
      maxDepthMeters: 6,
      currentNote:
        "Shallow and in Hawk Channel, so watch for boat traffic and fly a dive flag. A state Underwater Archaeological Preserve: every stone and brick stays exactly where it lies.",
      divePlan:
        "Circle the ballast mound slowly, find the plaque, then the cannons and anchor. An easy dive and a good snorkel.",
      fitTone: "welcoming",
      fitNote: "Shallow, calm and full of history. Anyone certified can enjoy it.",
      landmarks: [
        {
          name: "The ballast mound",
          kind: "reefHistory",
          note: "Smooth European river stones from her hold, with red galley bricks mixed in.",
        },
        {
          name: "Replica cannons and anchor",
          kind: "underwaterMonument",
          note: "Set on the site when it became a preserve. The anchor is a real one, from another ship of the same fleet.",
        },
        {
          name: "Bronze plaque",
          kind: "underwaterMonument",
          note: "On a concrete base on the sand, telling the ship’s story.",
        },
      ],
      creatureSlugs: [
        "french-grunt",
        "gray-snapper",
        "stoplight-parrotfish",
        "turtle-grass",
        "sergeant-major",
      ],
    },
  },
  // Denominator row: Alexander Barge
  {
    slug: "alexander-barge",
    version: 1,
    area: "florida-keys-islamorada",
    sources: [
      "https://gis.myfwc.com/mapping/rest/services/Open_Data/Artificial_Reef_Locations_in_Florida/MapServer/12/query?where=Name%3D%27Alexander%20Barge%27&outFields=Name,Depth,Relief,Lat_DD,Long_DD,DeployDate&returnGeometry=false&f=json",
      "https://www.islamoradadivecenter.com/florida-keys-dive-sites",
    ],
    briefing: {
      name: "Alexander Barge",
      locationName: "Islamorada, Florida",
      forecastLatitude: 24.8617,
      forecastLongitude: -80.5683,
      description:
        "A 37 m steel barge sunk off Islamorada in 1984 with a field of bridge rubble around it. Plain to look at, it draws big animals well beyond its size.",
      marineLife: "Goliath grouper · sea turtles · sharks · reef fish",
      difficultyLevel: "advanced",
      depthMinMeters: 24,
      maxDepthMeters: 32,
      currentNote: "Deep and in open water, with current possible. Stay outside the structure.",
      divePlan:
        "Down the line to the barge, around it and the nearest rubble, and back to the line on a short, planned bottom time.",
      fitTone: "demanding",
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: ["deep"],
      landmarks: [
        {
          name: "Bridge rubble",
          kind: "pointOfInterest",
          note: "Concrete placed around the barge when it went down, now part of the reef.",
        },
      ],
      creatureSlugs: [
        "goliath-grouper",
        "green-sea-turtle",
        "nurse-shark",
        "great-barracuda",
        "gray-snapper",
      ],
    },
  },
];
